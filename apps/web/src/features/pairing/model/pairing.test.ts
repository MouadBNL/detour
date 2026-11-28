import { describe, expect, it } from "vite-plus/test";
import {
  describeBrowser,
  describeDecisionFailure,
  describeLookupFailure,
  normalizePairingCode,
  validatePairingCode,
} from "./pairing.ts";

describe("pairing web model", () => {
  it("normalizes and validates pairing codes", () => {
    expect(normalizePairingCode(" abcd-efgh ")).toBe("ABCD-EFGH");
    expect(validatePairingCode("ABCD-EFGH")).toBeNull();
    expect(validatePairingCode("bad")).not.toBeNull();
  });

  it("maps browser kinds and contract failures to readable messages", () => {
    expect(describeBrowser("firefox")).toBe("Firefox extension");
    expect(describeBrowser("chrome")).toBe("Chrome extension");
    expect(describeLookupFailure({ type: "not_found" })).toContain("could not find");
    expect(describeDecisionFailure({ type: "conflict", reason: "expired" })).toContain("expired");
    expect(describeDecisionFailure({ type: "conflict", reason: "already_decided" })).toContain(
      "already approved or denied",
    );
  });
});
