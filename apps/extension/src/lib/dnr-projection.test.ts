import { describe, expect, it } from "vite-plus/test";
import {
  BLOCK_REGEX_FILTER,
  buildBlockedRedirectUrl,
  DYNAMIC_BLOCK_PRIORITY,
  DYNAMIC_BLOCK_RULE_BASE_ID,
  projectDnrRules,
  SESSION_ALLOW_PRIORITY,
  SESSION_ALLOW_RULE_BASE_ID,
} from "./dnr-projection.ts";
import { DEFAULT_GUARD_STATE, normalizeDomain, type GuardState } from "./guard-state.ts";

describe("projectDnrRules", () => {
  it("projects dynamic redirect rules and higher-priority session allow rules for chrome and firefox", () => {
    const state: GuardState = {
      paused: false,
      sites: [{ domain: "example.com" }, { domain: "news.ycombinator.com" }],
      grants: [
        {
          domain: "example.com",
          reason: "check one doc",
          grantedAtMs: 1_000,
          expiresAtMs: 301_000,
        },
        {
          domain: "news.ycombinator.com",
          reason: "expired grant",
          grantedAtMs: 1_000,
          expiresAtMs: 2_000,
        },
      ],
      lastExpired: [],
      pendingSweepDomains: [],
    };

    const chromeProjection = projectDnrRules(
      state,
      "chrome-extension://abcdef/blocked.html",
      10_000,
    );
    expect(chromeProjection.dynamicRules).toEqual([
      {
        id: DYNAMIC_BLOCK_RULE_BASE_ID,
        priority: DYNAMIC_BLOCK_PRIORITY,
        action: {
          type: "redirect",
          redirect: { regexSubstitution: "chrome-extension://abcdef/blocked.html?url=\\1" },
        },
        condition: {
          requestDomains: ["example.com"],
          regexFilter: BLOCK_REGEX_FILTER,
          resourceTypes: ["main_frame"],
        },
      },
      {
        id: DYNAMIC_BLOCK_RULE_BASE_ID + 1,
        priority: DYNAMIC_BLOCK_PRIORITY,
        action: {
          type: "redirect",
          redirect: { regexSubstitution: "chrome-extension://abcdef/blocked.html?url=\\1" },
        },
        condition: {
          requestDomains: ["news.ycombinator.com"],
          regexFilter: BLOCK_REGEX_FILTER,
          resourceTypes: ["main_frame"],
        },
      },
    ]);

    expect(chromeProjection.sessionRules).toEqual([
      {
        id: SESSION_ALLOW_RULE_BASE_ID,
        priority: SESSION_ALLOW_PRIORITY,
        action: { type: "allow" },
        condition: {
          requestDomains: ["example.com"],
          resourceTypes: ["main_frame"],
        },
      },
    ]);
    expect(SESSION_ALLOW_PRIORITY).toBeGreaterThan(DYNAMIC_BLOCK_PRIORITY);

    const firefoxProjection = projectDnrRules(
      state,
      "moz-extension://11111111-2222-3333-4444-555555555555/blocked.html",
      10_000,
    );
    expect(firefoxProjection.dynamicRules[0]?.action.redirect?.regexSubstitution).toBe(
      "moz-extension://11111111-2222-3333-4444-555555555555/blocked.html?url=\\1",
    );
  });

  it("removes dynamic redirect rules when paused", () => {
    const pausedState: GuardState = {
      ...DEFAULT_GUARD_STATE,
      paused: true,
      sites: [{ domain: "example.com" }],
    };
    const projection = projectDnrRules(
      pausedState,
      "chrome-extension://abcdef/blocked.html",
      10_000,
    );
    expect(projection.dynamicRules).toEqual([]);
  });

  it("builds encoded fallback redirect urls and normalizes domains", () => {
    expect(
      buildBlockedRedirectUrl(
        "moz-extension://uuid/blocked.html",
        "https://example.com/path?a=1&b=2",
      ),
    ).toBe(
      "moz-extension://uuid/blocked.html?url=https%3A%2F%2Fexample.com%2Fpath%3Fa%3D1%26b%3D2",
    );
    expect(normalizeDomain("  https://News.YCombinator.com/newest ")).toEqual({
      ok: true,
      value: "news.ycombinator.com",
    });
    expect(normalizeDomain("not a domain")).toEqual({
      ok: false,
      error: { type: "invalid_domain", raw: "not a domain" },
    });
  });
});
