import { err, ok, type Result } from "@detour/result";

export type ExtensionBrowserKind = "chrome" | "firefox" | "other";

export type PairingStartResult = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly expiresAt: string;
  readonly pollIntervalMs: number;
};

export type PairingPollState =
  | { readonly status: "pending"; readonly expiresAt: string }
  | { readonly status: "expired" }
  | { readonly status: "denied" }
  | {
      readonly status: "approved";
      readonly accessToken: string;
      readonly tokenId: string;
      readonly expiresAt: string;
      readonly scopes: readonly string[];
      readonly user: { readonly id: string; readonly email: string; readonly name: string };
    };

export type PairingOriginError = { readonly type: "invalid_origin" };

export function detectExtensionBrowser(userAgent: string): ExtensionBrowserKind {
  if (/firefox/i.test(userAgent)) return "firefox";
  if (/chrome|chromium|edg/i.test(userAgent)) return "chrome";
  return "other";
}

export function buildPairingVerificationUrl(
  webOrigin: string,
  verificationPath: string,
): Result<string, PairingOriginError> {
  if (!URL.canParse(webOrigin)) return err({ type: "invalid_origin" });
  const base = new URL(webOrigin);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return err({ type: "invalid_origin" });
  }
  // The API answers with a path; anything that would resolve off `webOrigin` (an absolute URL,
  // `//host`, a backslash a browser reads as `/`) is refused rather than opened in a tab.
  if (!verificationPath.startsWith("/") || verificationPath.includes("\\")) {
    return err({ type: "invalid_origin" });
  }
  const resolved = new URL(verificationPath, base);
  return resolved.origin === base.origin ? ok(resolved.href) : err({ type: "invalid_origin" });
}
