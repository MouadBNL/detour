import { describe, expect, it } from "vite-plus/test";
import { buildPairingVerificationUrl } from "./pairing.ts";

describe("buildPairingVerificationUrl", () => {
  it("resolves the API's path on the web origin", () => {
    expect(buildPairingVerificationUrl("https://detour.app", "/pair?code=ABCD-EFGH")).toEqual({
      ok: true,
      value: "https://detour.app/pair?code=ABCD-EFGH",
    });
  });

  it.each(["https://evil.example/pair", "//evil.example/pair", "/\\evil.example/pair", "pair"])(
    "refuses %j, which would open a tab off the web origin",
    (path) => {
      expect(buildPairingVerificationUrl("https://detour.app", path)).toEqual({
        ok: false,
        error: { type: "invalid_origin" },
      });
    },
  );
});
