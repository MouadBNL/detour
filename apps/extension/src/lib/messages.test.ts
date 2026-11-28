import { describe, expect, it } from "vite-plus/test";
import { parseExtensionMessage } from "./messages.ts";

const grant = (overrides: Record<string, unknown>) => ({
  type: "grant_access",
  domain: "example.com",
  durationMinutes: 5,
  reason: "check one issue",
  ...overrides,
});

describe("parseExtensionMessage", () => {
  it("accepts a valid grant_access payload", () => {
    expect(parseExtensionMessage(grant({}))).toEqual({
      type: "grant_access",
      domain: "example.com",
      durationMinutes: 5,
      reason: "check one issue",
    });
    expect(parseExtensionMessage(grant({ durationMinutes: 240 }))).not.toBeNull();
    expect(parseExtensionMessage(grant({ durationMinutes: 1 }))).not.toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, 0.1, 241, -5, "5"])(
    "rejects grant_access durationMinutes %s",
    (durationMinutes) => {
      expect(parseExtensionMessage(grant({ durationMinutes }))).toBeNull();
    },
  );

  it("rejects reasons longer than 300 characters after trimming", () => {
    expect(parseExtensionMessage(grant({ reason: "x".repeat(301) }))).toBeNull();
    expect(parseExtensionMessage(grant({ reason: `  ${"x".repeat(300)}  ` }))).not.toBeNull();
  });

  it("parses submit_followup without a client-supplied domain", () => {
    expect(
      parseExtensionMessage({ type: "submit_followup", domain: "evil.com", verdict: "drifted" }),
    ).toEqual({ type: "submit_followup", verdict: "drifted" });
    expect(parseExtensionMessage({ type: "submit_followup", verdict: "maybe" })).toBeNull();
  });

  it.each([
    null,
    "get_status",
    42,
    {},
    { type: "unknown" },
    { type: "set_paused", paused: "yes" },
    { type: "add_site" },
    { type: "remove_site", domain: 7 },
    { type: "grant_access", domain: "example.com", durationMinutes: 5 },
  ])("rejects invalid payload %j", (raw) => {
    expect(parseExtensionMessage(raw)).toBeNull();
  });
});
