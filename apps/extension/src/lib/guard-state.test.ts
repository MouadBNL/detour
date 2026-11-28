import { describe, expect, it } from "vite-plus/test";
import { findMatchingGuardedSite, normalizeDomain, parseGuardState } from "./guard-state.ts";

describe("normalizeDomain", () => {
  it.each([
    ["Example.COM", "example.com"],
    ["https://News.YCombinator.com/newest", "news.ycombinator.com"],
    ["Bücher.de", "xn--bcher-kva.de"],
    ["example.com:8080", "example.com"],
    ["example.com.", "example.com"],
    ["*.reddit.com", "reddit.com"],
    ["https://user@example.com/x", "example.com"],
    ["192.168.1.1", "192.168.1.1"],
    ["localhost:3000", "localhost"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeDomain(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "   ", "com", "[::1]", "exa mple.com", "http://", "*.", "-bad-.com"])(
    "rejects %j",
    (input) => {
      expect(normalizeDomain(input)).toEqual({
        ok: false,
        error: { type: "invalid_domain", raw: input },
      });
    },
  );
});

describe("findMatchingGuardedSite", () => {
  const sites = [{ domain: "reddit.com" }, { domain: "old.reddit.com" }, { domain: "example.com" }];

  it("prefers the most specific matching guarded site", () => {
    expect(findMatchingGuardedSite("old.reddit.com", sites)).toEqual({ domain: "old.reddit.com" });
    expect(findMatchingGuardedSite("www.reddit.com", sites)).toEqual({ domain: "reddit.com" });
  });

  it("returns null for unguarded and look-alike hosts", () => {
    expect(findMatchingGuardedSite("notreddit.com", sites)).toBeNull();
    expect(findMatchingGuardedSite("other.org", sites)).toBeNull();
  });
});

describe("parseGuardState", () => {
  it("defaults new fields and dedupes pending sweep domains", () => {
    const parsed = parseGuardState({
      paused: false,
      sites: [{ domain: "example.com" }],
      grants: [
        { domain: "example.com", reason: "r", grantedAtMs: 1, expiresAtMs: 2, wrapup: true },
      ],
      lastExpired: [{ domain: "example.com", reason: "r", durationMinutes: 5, expiredAtMs: 3 }],
      pendingSweepDomains: ["Example.com", "example.com", 42, "not a domain"],
    });
    expect(parsed.grants).toEqual([
      { domain: "example.com", reason: "r", grantedAtMs: 1, expiresAtMs: 2, wrapup: true },
    ]);
    expect(parsed.lastExpired[0]?.wrapupUsed).toBe(false);
    expect(parsed.pendingSweepDomains).toEqual(["example.com"]);
  });

  it("returns defaults for legacy payloads without pending sweeps", () => {
    expect(parseGuardState({ paused: true }).pendingSweepDomains).toEqual([]);
    expect(parseGuardState(null).pendingSweepDomains).toEqual([]);
  });
});
