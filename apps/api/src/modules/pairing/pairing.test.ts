import { extensionTokens, pairingSessions } from "@detour/db";
import { createTestDb, unreachableDb } from "@detour/db/testing";
import { isDefinedError, safe } from "@orpc/client";
import { assert, describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../testing/test-app.ts";

const START_TIME = new Date("2026-11-26T12:00:00.000Z");

describe("pairing tab-based cross-browser flow", () => {
  it("pairs a browser extension, issues a single-use scoped bearer token, and enforces web-only separation", async () => {
    let clock = START_TIME;
    const db = await createTestDb();
    const t = await createTestApp({ db, now: () => clock });
    const alice = await t.signUp({ email: "alice@detour.test", name: "Alice" });

    // 1. Extension initiates pairing (no auth needed)
    const [startErr, started] = await safe(
      t.client.pairing.start({ browser: "firefox", deviceName: "Firefox on Linux" }),
    );
    expect(startErr).toBeNull();
    expect(started?.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(started?.verificationPath).toBe(
      `/pair?code=${encodeURIComponent(started?.userCode ?? "")}`,
    );
    expect(started?.pollIntervalMs).toBeGreaterThan(0);

    const deviceCode = started?.deviceCode ?? "";
    const userCode = started?.userCode ?? "";

    // 2. Extension polls before approval -> pending
    const [pendingErr, pending] = await safe(t.client.pairing.poll({ deviceCode }));
    expect(pendingErr).toBeNull();
    expect(pending).toEqual({ status: "pending", expiresAt: started?.expiresAt });

    // 3. Web tab looks up pairing code (case-insensitive)
    const [lookupErr, lookedUp] = await safe(
      alice.client.pairing.lookup({ userCode: userCode.toLowerCase() }),
    );
    expect(lookupErr).toBeNull();
    expect(lookedUp).toMatchObject({
      userCode,
      browser: "firefox",
      deviceName: "Firefox on Linux",
      status: "pending",
    });

    // 4. Signed-in web user approves pairing
    const [approveErr, approved] = await safe(alice.client.pairing.approve({ userCode }));
    expect(approveErr).toBeNull();
    expect(approved).toEqual({ status: "approved" });

    // 5. Extension polls once -> receives scoped bearer token
    clock = new Date(START_TIME.getTime() + 5000);
    const [pollErr, polled] = await safe(t.client.pairing.poll({ deviceCode }));
    expect(pollErr).toBeNull();
    assert(polled?.status === "approved");

    expect(polled.accessToken.startsWith("dtr_")).toBe(true);
    expect(polled.scopes).toEqual(["extension:decide", "extension:profile"]);
    expect(polled.user).toEqual({
      id: alice.user.id,
      email: "alice@detour.test",
      name: "Alice",
    });

    // 6. Secrets are never stored in plaintext in the database
    const storedSessions = await db.select().from(pairingSessions);
    expect(storedSessions).toHaveLength(1);
    expect(storedSessions[0]?.deviceCodeHash).not.toBe(deviceCode);
    const storedTokens = await db.select().from(extensionTokens);
    expect(storedTokens).toHaveLength(1);
    expect(storedTokens[0]?.tokenHash).not.toBe(polled.accessToken);

    // 7. Re-polling after consumption fails with NOT_FOUND (single-use)
    const [replayErr] = await safe(t.client.pairing.poll({ deviceCode }));
    expect(isDefinedError(replayErr)).toBe(true);
    expect(replayErr).toMatchObject({ code: "NOT_FOUND", status: 404 });

    // 8. Extension calls auth.me with its bearer token
    const extensionClient = t.clientWithToken(polled.accessToken);
    clock = new Date(START_TIME.getTime() + 15_000);
    const [meErr, viewer] = await safe(extensionClient.auth.me());
    expect(meErr).toBeNull();
    expect(viewer).toEqual({
      user: { id: alice.user.id, email: "alice@detour.test", name: "Alice" },
      sessionKind: "extension_token",
      scopes: ["extension:decide", "extension:profile"],
    });

    // 9. Privilege separation: extension bearer token cannot approve devices or list/revoke devices
    const [forbidErr] = await safe(extensionClient.pairing.listDevices());
    expect(isDefinedError(forbidErr)).toBe(true);
    expect(forbidErr).toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      data: { reason: "web_session_required" },
    });

    // 10. Web user lists devices (sees updated lastUsedAt) and revokes the extension token
    const [listErr, devices] = await safe(alice.client.pairing.listDevices());
    expect(listErr).toBeNull();
    expect(devices).toHaveLength(1);
    expect(devices?.[0]).toMatchObject({
      id: polled.tokenId,
      browser: "firefox",
      deviceName: "Firefox on Linux",
      lastUsedAt: clock,
    });

    const [revokeErr, revoked] = await safe(
      alice.client.pairing.revokeDevice({ tokenId: polled.tokenId }),
    );
    expect(revokeErr).toBeNull();
    expect(revoked).toEqual({ revoked: true });

    // 11. Revoked extension token is immediately rejected
    const [afterRevokeErr] = await safe(extensionClient.auth.me());
    expect(isDefinedError(afterRevokeErr)).toBe(true);
    expect(afterRevokeErr).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("handles user denial and rejects duplicate decisions with CONFLICT", async () => {
    const t = await createTestApp({ now: () => START_TIME });
    const alice = await t.signUp({ email: "deny@detour.test" });

    const [, started] = await safe(
      t.client.pairing.start({ browser: "chrome", deviceName: "Chrome" }),
    );
    const userCode = started?.userCode ?? "";
    const deviceCode = started?.deviceCode ?? "";

    const [denyErr, denied] = await safe(alice.client.pairing.deny({ userCode }));
    expect(denyErr).toBeNull();
    expect(denied).toEqual({ status: "denied" });

    const [pollErr, polled] = await safe(t.client.pairing.poll({ deviceCode }));
    expect(pollErr).toBeNull();
    expect(polled).toEqual({ status: "denied" });

    const [secondErr] = await safe(alice.client.pairing.approve({ userCode }));
    expect(isDefinedError(secondErr)).toBe(true);
    expect(secondErr).toMatchObject({
      code: "CONFLICT",
      status: 409,
      data: { reason: "already_decided" },
    });
  });

  it("expires pairing sessions after the TTL and refuses late approval", async () => {
    let clock = START_TIME;
    const t = await createTestApp({ now: () => clock });
    const alice = await t.signUp({ email: "expire@detour.test" });

    const [, started] = await safe(
      t.client.pairing.start({ browser: "chrome", deviceName: "Chrome" }),
    );
    const userCode = started?.userCode ?? "";
    const deviceCode = started?.deviceCode ?? "";

    clock = new Date(START_TIME.getTime() + 11 * 60 * 1000);

    const [pollErr, polled] = await safe(t.client.pairing.poll({ deviceCode }));
    expect(pollErr).toBeNull();
    expect(polled).toEqual({ status: "expired" });

    const [approveErr] = await safe(alice.client.pairing.approve({ userCode }));
    expect(isDefinedError(approveErr)).toBe(true);
    expect(approveErr).toMatchObject({
      code: "CONFLICT",
      status: 409,
      data: { reason: "expired" },
    });
  });

  it("rejects malformed user codes with BAD_REQUEST and reports SERVICE_UNAVAILABLE when DB is down", async () => {
    const t = await createTestApp();
    const alice = await t.signUp({ email: "invalid@detour.test" });

    const [badInputErr] = await safe(alice.client.pairing.lookup({ userCode: "not-valid" }));
    expect(badInputErr).toMatchObject({ code: "BAD_REQUEST", status: 400 });

    const down = await createTestApp({ db: unreachableDb() });
    const [downErr] = await safe(
      down.client.pairing.start({ browser: "chrome", deviceName: "Chrome" }),
    );
    expect(isDefinedError(downErr)).toBe(true);
    expect(downErr).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      data: { reason: "database_unavailable" },
    });
  });

  it("never mints a second token for a pairing, even if marking it consumed did not happen", async () => {
    const db = await createTestDb();
    const t = await createTestApp({ db, now: () => START_TIME });
    const alice = await t.signUp({ email: "once@detour.test" });
    const [, started] = await safe(
      t.client.pairing.start({ browser: "chrome", deviceName: "Chrome" }),
    );
    assert(started !== undefined);
    await alice.client.pairing.approve({ userCode: started.userCode });
    const [, first] = await safe(t.client.pairing.poll({ deviceCode: started.deviceCode }));
    expect(first?.status).toBe("approved");

    // The token is the commit point; simulate the bookkeeping write having failed.
    await db.update(pairingSessions).set({ status: "approved", consumedAt: null });
    const [secondErr] = await safe(t.client.pairing.poll({ deviceCode: started.deviceCode }));
    expect(secondErr).toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(extensionTokens)).toHaveLength(1);
  });

  it("does not list devices whose token expired", async () => {
    let clock = START_TIME;
    const t = await createTestApp({ now: () => clock });
    const alice = await t.signUp({ email: "stale@detour.test" });
    const [, started] = await safe(
      t.client.pairing.start({ browser: "firefox", deviceName: "Firefox" }),
    );
    assert(started !== undefined);
    await alice.client.pairing.approve({ userCode: started.userCode });
    await t.client.pairing.poll({ deviceCode: started.deviceCode });
    expect(await alice.client.pairing.listDevices()).toHaveLength(1);

    clock = new Date(START_TIME.getTime() + 91 * 24 * 60 * 60 * 1000);
    expect(await alice.client.pairing.listDevices()).toHaveLength(0);
  });
});
