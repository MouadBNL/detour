import { err, ok } from "@detour/result";
import { assert, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { syncDynamicRules } from "./dnr.adapter.ts";
import { handleBackgroundMessage } from "./background-controller.ts";
import {
  addGuardedSite,
  consumeWrapupGrant,
  grantDomainAccess,
  removeGuardedSite,
  setPausedState,
} from "./guard-mutations.ts";
import { removeDomainPermission } from "./permissions.adapter.ts";
import { readExtensionStatus, reconcile } from "./reconcile.ts";
import { readGuardState } from "./storage.adapter.ts";

type MockState = {
  dynamicRules: Browser.declarativeNetRequest.Rule[];
  sessionRules: Browser.declarativeNetRequest.Rule[];
  grantedOrigins: Set<string>;
  alarmWhenMs: number | null;
  openTabs: { readonly id: number; readonly url: string }[];
  injectedTabIds: number[];
  redirectedTabs: { readonly tabId: number; readonly url: string }[];
  failInjection: boolean;
  failRedirect: boolean;
  failQuery: boolean;
  failSessionSync: boolean;
  sessionGate: Promise<void> | null;
};

const mockState = vi.hoisted((): MockState => ({
  dynamicRules: [],
  sessionRules: [],
  grantedOrigins: new Set<string>(),
  alarmWhenMs: null,
  openTabs: [],
  injectedTabIds: [],
  redirectedTabs: [],
  failInjection: false,
  failRedirect: false,
  failQuery: false,
  failSessionSync: false,
  sessionGate: null,
}));

const tabsFailure = (operation: string) =>
  err({ type: "tabs_scripting_failed", operation, cause: "blocked" });

vi.mock("./dnr.adapter.ts", () => ({
  getBlockedPageUrl: () => "chrome-extension://test-id/blocked.html",
  syncDynamicRules: vi.fn<
    (rules: readonly Browser.declarativeNetRequest.Rule[]) => Promise<unknown>
  >(async (rules) => {
    mockState.dynamicRules = [...rules];
    return ok(rules.length);
  }),
  syncSessionRules: vi.fn<
    (rules: readonly Browser.declarativeNetRequest.Rule[]) => Promise<unknown>
  >(async (rules) => {
    await mockState.sessionGate;
    if (mockState.failSessionSync) {
      return err({ type: "dnr_failed", operation: "updateSessionRules", cause: "quota" });
    }
    mockState.sessionRules = [...rules];
    return ok(rules.length);
  }),
  getDynamicRuleCount: vi.fn<() => Promise<unknown>>(async () => ok(mockState.dynamicRules.length)),
  getSessionRuleCount: vi.fn<() => Promise<unknown>>(async () => ok(mockState.sessionRules.length)),
}));

vi.mock("./permissions.adapter.ts", () => ({
  auditSitePermissions: vi.fn<(sites: readonly { readonly domain: string }[]) => Promise<unknown>>(
    async (sites) =>
      ok(
        sites.map((site) => ({
          domain: site.domain,
          hostAccess: mockState.grantedOrigins.has(site.domain) ? "granted" : "revoked",
        })),
      ),
  ),
  removeDomainPermission: vi.fn<(domain: string) => Promise<unknown>>(async () => ok(true)),
}));

vi.mock("./alarms.adapter.ts", () => ({
  RECONCILE_ALARM_NAME: "detour:grant-expiry",
  syncReconcileAlarm: vi.fn<(whenMs: number | null) => Promise<unknown>>(async (whenMs) => {
    mockState.alarmWhenMs = whenMs;
    return ok(whenMs);
  }),
  getReconcileAlarmWhenMs: vi.fn<() => Promise<unknown>>(async () => ok(mockState.alarmWhenMs)),
}));

vi.mock("./tabs-scripting.adapter.ts", () => ({
  queryOpenTabs: vi.fn<() => Promise<unknown>>(async () =>
    mockState.failQuery ? tabsFailure("tabs.query") : ok(mockState.openTabs),
  ),
  injectExpiryOverlay: vi.fn<(tabId: number) => Promise<unknown>>(async (tabId) => {
    if (mockState.failInjection) return tabsFailure("scripting.executeScript");
    mockState.injectedTabIds.push(tabId);
    return ok(undefined);
  }),
  redirectTab: vi.fn<(tabId: number, url: string) => Promise<unknown>>(async (tabId, url) => {
    if (mockState.failRedirect) return tabsFailure("tabs.update");
    mockState.redirectedTabs.push({ tabId, url });
    return ok(undefined);
  }),
}));

function extensionSender(): Browser.runtime.MessageSender {
  return { id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL("/popup.html") };
}

function contentSender(tabId: number, url: string): Browser.runtime.MessageSender {
  const tab: Browser.tabs.Tab = {
    id: tabId,
    url,
    index: 0,
    windowId: 1,
    pinned: false,
    highlighted: false,
    active: true,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    frozen: false,
    lastAccessed: 0,
  };
  return { id: fakeBrowser.runtime.id, url, tab };
}

async function storedState() {
  const stored = await readGuardState();
  assert(stored.ok);
  return stored.value;
}

/** Adds example.com, grants a pass at `grantedAtMs`, and opens a matching tab. */
async function seedExpiringGrant(grantedAtMs: number, minutes = 2) {
  await addGuardedSite("example.com", grantedAtMs - 1);
  const granted = await grantDomainAccess({
    domain: "example.com",
    durationMinutes: minutes,
    reason: "quick lookup",
    nowMs: grantedAtMs,
  });
  assert(granted.ok);
  mockState.openTabs = [
    { id: 42, url: "https://sub.example.com/feed" },
    { id: 99, url: "https://other.org/home" },
  ];
  return granted.value.extra.expiresAtMs;
}

describe("reconcile & background controller", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    Object.defineProperty(fakeBrowser.storage.local, "setAccessLevel", {
      value: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
    Object.assign(mockState, {
      dynamicRules: [],
      sessionRules: [],
      grantedOrigins: new Set(["example.com"]),
      alarmWhenMs: null,
      openTabs: [],
      injectedTabIds: [],
      redirectedTabs: [],
      failInjection: false,
      failRedirect: false,
      failQuery: false,
      failSessionSync: false,
      sessionGate: null,
    });
  });

  it("projects block rules, installs session allow rules on grant, and schedules expiry", async () => {
    const added = await addGuardedSite("example.com", 10_000);
    assert(added.ok);
    expect(added.value.status.sites).toEqual([{ domain: "example.com", hostAccess: "granted" }]);
    expect(mockState.dynamicRules).toHaveLength(1);
    expect(mockState.alarmWhenMs).toBeNull();

    const expiresAtMs = await seedExpiringGrant(20_000, 5);
    expect(expiresAtMs).toBe(320_000);
    expect(mockState.sessionRules).toHaveLength(1);
    expect(mockState.sessionRules[0]?.priority).toBe(10);
    expect(mockState.alarmWhenMs).toBe(320_000);
  });

  it("sweeps tabs with the overlay on expiry and falls back to redirect", async () => {
    await seedExpiringGrant(20_000);
    const overlaid = await reconcile({ nowMs: 150_000 });
    assert(overlaid.ok);
    expect(overlaid.value.expiredDomains).toEqual(["example.com"]);
    expect(mockState.sessionRules).toHaveLength(0);
    expect(mockState.injectedTabIds).toEqual([42]);
    expect((await storedState()).pendingSweepDomains).toEqual([]);

    await grantDomainAccess({
      domain: "example.com",
      durationMinutes: 1,
      reason: "again",
      nowMs: 160_000,
    });
    mockState.failInjection = true;
    const redirected = await reconcile({ nowMs: 250_000 });
    assert(redirected.ok);
    expect(mockState.redirectedTabs).toEqual([
      {
        tabId: 42,
        url: "chrome-extension://test-id/blocked.html?url=https%3A%2F%2Fsub.example.com%2Ffeed",
      },
    ]);
  });

  it("serializes concurrent grant and reconcile so no grant is lost", async () => {
    await addGuardedSite("example.com", 10_000);
    const gate = Promise.withResolvers<void>();
    mockState.sessionGate = gate.promise;

    const granting = grantDomainAccess({
      domain: "example.com",
      durationMinutes: 5,
      reason: "held",
      nowMs: 20_000,
    });
    const reconciling = reconcile({ nowMs: 21_000 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The grant step is parked in syncSessionRules; reconcile has not started its DNR sync.
    expect(vi.mocked(syncDynamicRules)).toHaveBeenCalledTimes(2);

    gate.resolve();
    const [granted, reconciled] = await Promise.all([granting, reconciling]);
    assert(granted.ok);
    assert(reconciled.ok);
    expect(vi.mocked(syncDynamicRules)).toHaveBeenCalledTimes(3);
    expect(reconciled.value.status.state.grants).toHaveLength(1);
    expect((await storedState()).grants.map((grant) => grant.reason)).toEqual(["held"]);
    expect(mockState.sessionRules).toHaveLength(1);
  });

  it("keeps an expired grant in storage and schedules a retry when session sync fails", async () => {
    await seedExpiringGrant(20_000);
    mockState.failSessionSync = true;
    const failed = await reconcile({ nowMs: 200_000 });
    expect(failed).toMatchObject({ ok: false, error: { type: "dnr_failed" } });
    expect((await storedState()).grants).toHaveLength(1);
    expect(mockState.alarmWhenMs).toBe(230_000);
    expect(mockState.injectedTabIds).toEqual([]);

    mockState.failSessionSync = false;
    const retried = await reconcile({ nowMs: 230_000 });
    assert(retried.ok);
    expect(retried.value.expiredDomains).toEqual(["example.com"]);
    expect(mockState.injectedTabIds).toEqual([42]);
    expect((await storedState()).lastExpired[0]).toMatchObject({
      domain: "example.com",
      wrapupUsed: false,
    });
  });

  it("retains pending sweeps when tabs.query fails and retries them on the next reconcile", async () => {
    await seedExpiringGrant(20_000);
    mockState.failQuery = true;
    const failed = await reconcile({ nowMs: 200_000 });
    expect(failed).toMatchObject({ ok: false, error: { type: "tabs_scripting_failed" } });
    const pending = await storedState();
    expect(pending.grants).toEqual([]);
    expect(pending.pendingSweepDomains).toEqual(["example.com"]);
    expect(mockState.alarmWhenMs).toBe(230_000);

    mockState.failQuery = false;
    const retried = await reconcile({ nowMs: 230_000 });
    assert(retried.ok);
    expect(retried.value.expiredDomains).toEqual([]);
    expect(retried.value.sweptTabIds).toEqual([42]);
    expect((await storedState()).pendingSweepDomains).toEqual([]);
    expect(mockState.alarmWhenMs).toBeNull();
  });

  it("retains a domain whose tab fails both overlay and redirect", async () => {
    await seedExpiringGrant(20_000);
    mockState.failInjection = true;
    mockState.failRedirect = true;
    const partial = await reconcile({ nowMs: 200_000 });
    assert(partial.ok);
    expect(partial.value.status.state.pendingSweepDomains).toEqual(["example.com"]);
    expect(mockState.alarmWhenMs).toBe(230_000);

    mockState.failInjection = false;
    mockState.failRedirect = false;
    const retried = await reconcile({ nowMs: 230_000 });
    assert(retried.ok);
    expect(mockState.injectedTabIds).toEqual([42]);
    expect(retried.value.status.state.pendingSweepDomains).toEqual([]);
  });

  it("get_status is read-only: no grant expiry, DNR writes, or tab sweeps", async () => {
    await seedExpiringGrant(20_000);
    vi.clearAllMocks();
    const reply = await handleBackgroundMessage({ type: "get_status" }, extensionSender());
    assert(reply.ok && reply.type === "status");
    expect(reply.status.state.grants).toHaveLength(1);
    expect(reply.status.sessionRuleCount).toBe(1);
    expect(reply.status.nextAlarmAtMs).toBe(140_000);
    expect(vi.mocked(syncDynamicRules)).not.toHaveBeenCalled();
    expect(mockState.injectedTabIds).toEqual([]);
    expect((await storedState()).grants).toHaveLength(1);

    const status = await readExtensionStatus();
    assert(status.ok);
    expect(status.value.dynamicRuleCount).toBe(1);
  });

  it("scopes subdomain grants to the guarded site and rejects unguarded or invalid input", async () => {
    await addGuardedSite("reddit.com", 10_000);
    const scoped = await grantDomainAccess({
      domain: "old.reddit.com",
      durationMinutes: 5,
      reason: "one thread",
      nowMs: 20_000,
    });
    assert(scoped.ok);
    expect(scoped.value.extra.domain).toBe("reddit.com");
    expect((await storedState()).grants.map((grant) => grant.domain)).toEqual(["reddit.com"]);

    const base = { reason: "r", nowMs: 20_000 };
    expect(await grantDomainAccess({ ...base, domain: "example.org", durationMinutes: 5 })).toEqual(
      { ok: false, error: { type: "site_not_guarded", domain: "example.org" } },
    );
    expect(
      await grantDomainAccess({ ...base, domain: "reddit.com", durationMinutes: Number.NaN }),
    ).toMatchObject({ ok: false, error: { type: "invalid_duration" } });
    expect(
      await grantDomainAccess({ ...base, domain: "reddit.com", durationMinutes: 0.1 }),
    ).toMatchObject({ ok: false, error: { type: "invalid_duration" } });
    expect(
      await grantDomainAccess({
        domain: "reddit.com",
        durationMinutes: 5,
        reason: "x".repeat(301),
      }),
    ).toEqual({ ok: false, error: { type: "reason_too_long", maxLength: 300 } });
  });

  it("allows the 2-minute wrap-up exactly once per expired pass", async () => {
    await seedExpiringGrant(20_000);
    expect(await consumeWrapupGrant("sub.example.com", 100_000)).toMatchObject({
      ok: false,
      error: { type: "wrapup_unavailable", domain: "sub.example.com" },
    });
    await reconcile({ nowMs: 150_000 });

    const first = await consumeWrapupGrant("sub.example.com", 160_000);
    assert(first.ok);
    expect(first.value.extra).toEqual({ domain: "example.com", expiresAtMs: 280_000 });
    expect(mockState.sessionRules).toHaveLength(1);
    expect((await storedState()).lastExpired[0]?.wrapupUsed).toBe(true);

    expect(await consumeWrapupGrant("example.com", 170_000)).toMatchObject({
      ok: false,
      error: { type: "wrapup_unavailable" },
    });
    await reconcile({ nowMs: 300_000 });
    const afterExpiry = await storedState();
    expect(afterExpiry.lastExpired[0]).toMatchObject({ reason: "quick lookup", wrapupUsed: true });
    expect(await consumeWrapupGrant("example.com", 310_000)).toMatchObject({
      ok: false,
      error: { type: "wrapup_unavailable" },
    });
    expect(await consumeWrapupGrant("other.org", 310_000)).toMatchObject({
      ok: false,
      error: { type: "wrapup_unavailable" },
    });
  });

  it("removes the host permission with the site and pauses enforcement", async () => {
    mockState.grantedOrigins.clear();
    const added = await addGuardedSite("example.com", 10_000);
    assert(added.ok);
    expect(added.value.status.sites).toEqual([{ domain: "example.com", hostAccess: "revoked" }]);

    const paused = await setPausedState(true, 11_000);
    assert(paused.ok);
    expect(mockState.dynamicRules).toHaveLength(0);

    await addGuardedSite("sub.example.org", 12_000);
    await addGuardedSite("example.org", 12_000);
    const removed = await removeGuardedSite("example.com", 13_000);
    assert(removed.ok);
    expect(removed.value.status.state.sites.map((site) => site.domain)).toEqual([
      "sub.example.org",
      "example.org",
    ]);
    expect(vi.mocked(removeDomainPermission)).toHaveBeenCalledWith("example.com");

    // example.org's patterns also cover sub.example.org, so its permission is kept.
    await removeGuardedSite("example.org", 14_000);
    expect(vi.mocked(removeDomainPermission)).toHaveBeenCalledTimes(1);
  });
});

describe("background message authorization", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    mockState.failRedirect = false;
    mockState.redirectedTabs = [];
  });

  it("rejects privileged messages from content scripts and foreign senders", async () => {
    const unauthorized = { ok: false, errorType: "unauthorized_sender" };
    const tab = contentSender(7, "https://example.com/page");
    for (const message of [
      { type: "get_status" },
      { type: "set_paused", paused: true },
      { type: "add_site", domain: "example.com" },
      { type: "remove_site", domain: "example.com" },
      { type: "grant_access", domain: "example.com", durationMinutes: 5, reason: "" },
      { type: "reconcile_now" },
    ]) {
      expect(await handleBackgroundMessage(message, tab)).toMatchObject(unauthorized);
    }
    const foreign = { id: "other-extension", url: fakeBrowser.runtime.getURL("/popup.html") };
    expect(await handleBackgroundMessage({ type: "get_status" }, foreign)).toMatchObject(
      unauthorized,
    );
    expect(
      await handleBackgroundMessage({ type: "get_status" }, { url: "https://example.com/" }),
    ).toMatchObject(unauthorized);
  });

  it("serves expiry context to content scripts", async () => {
    const reply = await handleBackgroundMessage(
      { type: "get_expiry_context" },
      contentSender(7, "https://example.com/page"),
    );
    expect(reply).toEqual({ ok: true, type: "expiry_context", context: null });
  });

  it("derives the follow-up domain from the sender tab and redirects it", async () => {
    const reply = await handleBackgroundMessage(
      { type: "submit_followup", domain: "evil.com", verdict: "drifted" },
      contentSender(7, "https://www.example.com/page"),
    );
    expect(reply).toEqual({
      ok: true,
      type: "followup_recorded",
      domain: "www.example.com",
      verdict: "drifted",
    });
    expect(mockState.redirectedTabs).toEqual([
      {
        tabId: 7,
        url: "chrome-extension://test-id/blocked.html?url=https%3A%2F%2Fwww.example.com%2Fpage",
      },
    ]);
  });

  it("propagates redirect failure and requires a tab URL", async () => {
    mockState.failRedirect = true;
    expect(
      await handleBackgroundMessage(
        { type: "submit_followup", verdict: "worth_it" },
        contentSender(7, "https://example.com/"),
      ),
    ).toMatchObject({ ok: false, errorType: "tabs_scripting_failed" });
    expect(
      await handleBackgroundMessage(
        { type: "submit_followup", verdict: "worth_it" },
        extensionSender(),
      ),
    ).toMatchObject({ ok: false, errorType: "invalid_sender" });
  });

  it("routes wrap-up follow-ups through the one-time wrap-up grant", async () => {
    const reply = await handleBackgroundMessage(
      { type: "submit_followup", verdict: "wrapup_2m" },
      contentSender(7, "https://example.com/"),
    );
    expect(reply).toMatchObject({ ok: false, errorType: "wrapup_unavailable" });
  });
});
