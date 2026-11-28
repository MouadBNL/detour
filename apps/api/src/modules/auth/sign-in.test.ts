import { unreachableDb } from "@detour/db/testing";
import { isDefinedError, safe } from "@orpc/client";
import { assert, describe, expect, it } from "vite-plus/test";
import type { AuthUser } from "../../auth/types.ts";
import { createTestApp, type TestApp } from "../../testing/test-app.ts";

const ALICE: AuthUser = { id: "user_01workos_alice", email: "alice@detour.test", name: "Alice" };

/** The `name=value` pair a response sets for `name`, if any. */
function setCookiePair(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .find((pair) => pair.startsWith(`${name}=`) && pair.length > name.length + 1);
}

/** Runs `/api/auth/sign-in` and returns what the browser would carry to the callback. */
async function startSignIn(t: TestApp, returnTo: string) {
  const response = await t.fetch(`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  expect(response.status).toBe(302);
  const state = new URL(response.headers.get("location") ?? "").searchParams.get("state");
  const flowCookie = setCookiePair(response, "detour_sign_in");
  assert(state !== null && flowCookie !== undefined);
  expect(response.headers.getSetCookie().join("\n")).toMatch(/HttpOnly/);
  return { state, flowCookie };
}

async function completeSignIn(t: TestApp, user: AuthUser, returnTo: string) {
  const { state, flowCookie } = await startSignIn(t, returnTo);
  const code = `wos_code_${crypto.randomUUID()}`;
  t.registerAuthCode(code, user);
  return t.fetch(`/api/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, {
    headers: { cookie: flowCookie },
  });
}

describe("WorkOS AuthKit sign-in", () => {
  it("signs in through state + PKCE, upserts the user, and authenticates auth.me", async () => {
    const t = await createTestApp();
    const callback = await completeSignIn(t, ALICE, "/pair?code=ABCD-EFGH");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/pair?code=ABCD-EFGH");

    const session = setCookiePair(callback, "wos-session");
    assert(session !== undefined);
    const [error, viewer] = await safe(t.clientWithCookie(session).auth.me());
    expect(error).toBeNull();
    expect(viewer?.user).toEqual(ALICE);

    const signOut = await t.fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: session },
    });
    expect(signOut.status).toBe(200);
    expect(signOut.headers.get("set-cookie")).toContain("wos-session=;");
  });

  it("refuses a callback this browser did not start (login CSRF) or whose state differs", async () => {
    const t = await createTestApp();
    t.registerAuthCode("attacker_code", ALICE);
    const forged = await t.fetch("/api/auth/callback?code=attacker_code&state=%2Fpair");
    expect(forged.status).toBe(400);
    expect(setCookiePair(forged, "wos-session")).toBeUndefined();

    const { flowCookie } = await startSignIn(t, "/");
    const mismatched = await t.fetch("/api/auth/callback?code=attacker_code&state=other", {
      headers: { cookie: flowCookie },
    });
    expect(mismatched.status).toBe(400);
    expect(setCookiePair(mismatched, "wos-session")).toBeUndefined();
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/\t/evil.example/phish",
    "/\n/evil.example",
  ])("returns to / instead of the off-site %j", async (returnTo) => {
    const t = await createTestApp();
    const callback = await completeSignIn(t, ALICE, returnTo);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
  });

  it("signs in a user WorkOS recreated with the same email (new id)", async () => {
    const t = await createTestApp();
    expect((await completeSignIn(t, ALICE, "/")).status).toBe(302);
    const recreated = { ...ALICE, id: "user_01workos_alice_again" };
    expect((await completeSignIn(t, recreated, "/")).status).toBe(302);
  });

  it("refuses a cross-site sign-out", async () => {
    const t = await createTestApp();
    const signedUp = await t.signUp();
    const response = await t.fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: signedUp.cookieHeader, "sec-fetch-site": "same-site" },
    });
    expect(response.status).toBe(403);
  });
});

describe("request sessions", () => {
  it("refreshes an expired access token and re-sets the cookie", async () => {
    const t = await createTestApp();
    const signedUp = await t.signUp({ expiredAccessToken: true });
    const response = await t.fetch("/rpc/auth/me", {
      method: "POST",
      headers: { cookie: signedUp.cookieHeader, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const refreshed = setCookiePair(response, "wos-session");
    assert(refreshed !== undefined);
    expect(refreshed).not.toBe(signedUp.cookieHeader);
  });

  it("answers SERVICE_UNAVAILABLE, not UNAUTHORIZED, when WorkOS cannot verify the cookie", async () => {
    const t = await createTestApp();
    const signedUp = await t.signUp();
    t.setAuthUnavailable(true);
    const [error] = await safe(signedUp.client.auth.me());
    assert(isDefinedError(error) && error.code === "SERVICE_UNAVAILABLE");
    expect(error.data).toEqual({ reason: "auth_unavailable" });
  });

  it("answers SERVICE_UNAVAILABLE, not UNAUTHORIZED, when D1 cannot check a bearer token", async () => {
    const t = await createTestApp({ db: unreachableDb() });
    const [error] = await safe(t.clientWithToken("dtr_anything").auth.me());
    assert(isDefinedError(error) && error.code === "SERVICE_UNAVAILABLE");
    expect(error.data).toEqual({ reason: "database_unavailable" });
  });

  it("ignores the session cookie on a request that is not same-origin", async () => {
    const t = await createTestApp();
    const signedUp = await t.signUp();
    for (const headers of [
      { cookie: signedUp.cookieHeader, "sec-fetch-site": "same-site" },
      { cookie: signedUp.cookieHeader, origin: "https://sibling.example" },
    ]) {
      const [error] = await safe(t.clientWithHeaders(headers).auth.me());
      assert(isDefinedError(error));
      expect(error.code).toBe("UNAUTHORIZED");
    }
    const [sameOriginError] = await safe(
      t
        .clientWithHeaders({ cookie: signedUp.cookieHeader, "sec-fetch-site": "same-origin" })
        .auth.me(),
    );
    expect(sameOriginError).toBeNull();
  });

  it("treats a malformed cookie as signed out instead of failing the request", async () => {
    const t = await createTestApp();
    const [error, health] = await safe(t.clientWithCookie("wos-session=%ZZ").system.health());
    expect(error).toBeNull();
    expect(health?.status).toBe("ok");
  });
});
