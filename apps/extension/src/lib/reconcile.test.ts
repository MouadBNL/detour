import { ok } from "@detour/result";
import { assert, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { handleBackgroundMessage } from "./background-controller.ts";
import {
  addGuardedSite,
  grantDomainAccess,
  reconcile,
  removeGuardedSite,
  setPausedState,
} from "./reconcile.ts";

type MockState = {
  dynamicRules: Browser.declarativeNetRequest.Rule[];
  sessionRules: Browser.declarativeNetRequest.Rule[];
  grantedOrigins: Set<string>;
  alarmWhenMs: number | null;
  openTabs: { readonly id: number; readonly url: string }[];
  injectedTabIds: number[];
  redirectedTabs: { readonly tabId: number; readonly url: string }[];
  failInjection: boolean;
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
}));

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
    mockState.sessionRules = [...rules];
    return ok(rules.length);
  }),
}));

vi.mock("./permissions.adapter.ts", () => ({
  auditSitePermissions: vi.fn<(sites: readonly { readonly domain: string }[]) => Promise<unknown>>(
    async (sites) => {
      const grantedDomains: string[] = [];
      const revokedDomains: string[] = [];
      for (const site of sites) {
        if (mockState.grantedOrigins.has(site.domain)) {
          grantedDomains.push(site.domain);
        } else {
          revokedDomains.push(site.domain);
        }
      }
      return ok({ grantedDomains, revokedDomains });
    },
  ),
}));

vi.mock("./alarms.adapter.ts", () => ({
  RECONCILE_ALARM_NAME: "detour:grant-expiry",
  syncReconcileAlarm: vi.fn<(whenMs: number | null) => Promise<unknown>>(async (whenMs) => {
    mockState.alarmWhenMs = whenMs;
    return ok(whenMs);
  }),
}));

vi.mock("./tabs-scripting.adapter.ts", () => ({
  queryOpenTabs: vi.fn<() => Promise<unknown>>(async () => ok(mockState.openTabs)),
  injectExpiryOverlay: vi.fn<(tabId: number) => Promise<unknown>>(async (tabId) => {
    if (mockState.failInjection) {
      return {
        ok: false,
        error: {
          type: "tabs_scripting_failed",
          operation: "scripting.executeScript",
          cause: "blocked",
        },
      };
    }
    mockState.injectedTabIds.push(tabId);
    return ok(undefined);
  }),
  redirectTab: vi.fn<(tabId: number, url: string) => Promise<unknown>>(async (tabId, url) => {
    mockState.redirectedTabs.push({ tabId, url });
    return ok(undefined);
  }),
}));

describe("reconcile & background controller", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    Object.defineProperty(fakeBrowser.storage.local, "setAccessLevel", {
      value: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      configurable: true,
      writable: true,
    });
    mockState.dynamicRules = [];
    mockState.sessionRules = [];
    mockState.grantedOrigins = new Set(["example.com"]);
    mockState.alarmWhenMs = null;
    mockState.openTabs = [];
    mockState.injectedTabIds = [];
    mockState.redirectedTabs = [];
    mockState.failInjection = false;
  });

  it("projects dynamic block rules, installs session allow rules on grant, and schedules expiry alarm", async () => {
    const added = await addGuardedSite("example.com", 10_000);
    expect(added.ok).toBe(true);
    expect(mockState.dynamicRules).toHaveLength(1);
    expect(mockState.sessionRules).toHaveLength(0);
    expect(mockState.alarmWhenMs).toBeNull();

    const granted = await grantDomainAccess({
      domain: "example.com",
      durationMinutes: 5,
      reason: "check one issue",
      nowMs: 20_000,
    });
    expect(granted.ok).toBe(true);
    expect(mockState.dynamicRules).toHaveLength(1);
    expect(mockState.sessionRules).toHaveLength(1);
    expect(mockState.sessionRules[0]?.priority).toBe(10);
    expect(mockState.alarmWhenMs).toBe(320_000);
  });

  it("sweeps open tabs on grant expiry with scripting overlay and falls back to redirect", async () => {
    await addGuardedSite("example.com", 10_000);
    await grantDomainAccess({
      domain: "example.com",
      durationMinutes: 2,
      reason: "quick lookup",
      nowMs: 20_000,
    });
    mockState.openTabs = [
      { id: 42, url: "https://sub.example.com/feed" },
      { id: 99, url: "https://other.org/home" },
    ];

    const expiredOverlay = await reconcile({ nowMs: 150_000, expiredAction: "overlay" });
    expect(expiredOverlay.ok).toBe(true);
    expect(mockState.sessionRules).toHaveLength(0);
    expect(mockState.alarmWhenMs).toBeNull();
    expect(mockState.injectedTabIds).toEqual([42]);
    expect(mockState.redirectedTabs).toEqual([]);

    await grantDomainAccess({
      domain: "example.com",
      durationMinutes: 1,
      reason: "second visit",
      nowMs: 160_000,
    });
    mockState.failInjection = true;
    const expiredFallback = await reconcile({ nowMs: 250_000, expiredAction: "overlay" });
    expect(expiredFallback.ok).toBe(true);
    expect(mockState.redirectedTabs).toEqual([
      {
        tabId: 42,
        url: "chrome-extension://test-id/blocked.html?url=https%3A%2F%2Fsub.example.com%2Ffeed",
      },
    ]);
  });

  it("detects revoked permissions, handles pause/remove, and responds to runtime messages", async () => {
    mockState.grantedOrigins.clear();
    const added = await addGuardedSite("example.com", 10_000);
    assert(added.ok);
    expect(added.value.status.revokedDomains).toEqual(["example.com"]);

    const paused = await setPausedState(true, 11_000);
    expect(paused.ok).toBe(true);
    expect(mockState.dynamicRules).toHaveLength(0);

    const reply = await handleBackgroundMessage(
      { type: "submit_followup", domain: "example.com", verdict: "wrapup_2m" },
      {},
    );
    expect(reply).toEqual({
      ok: true,
      type: "followup_recorded",
      domain: "example.com",
      verdict: "wrapup_2m",
    });
    expect(mockState.sessionRules).toHaveLength(1);

    const removed = await removeGuardedSite("example.com", 12_000);
    expect(removed.ok).toBe(true);
    expect(mockState.sessionRules).toHaveLength(0);
  });
});
