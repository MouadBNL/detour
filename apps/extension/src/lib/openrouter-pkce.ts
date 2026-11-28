import { err, ok, type Result } from "@detour/result";

export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_KEYS_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";

export type OpenRouterKeyExpiration =
  | "1-hour"
  | "1-day"
  | "7-days"
  | "30-days"
  | "90-days"
  | "180-days"
  | "1-year"
  | "never";

export type PkceVerifierError = { readonly type: "invalid_verifier_length" };

export type InvalidCallbackUrlError =
  | { readonly type: "invalid_callback_url" }
  | { readonly type: "unsupported_callback_scheme"; readonly protocol: string };

export type OpenRouterCallbackError =
  | { readonly type: "invalid_callback_url" }
  | { readonly type: "access_denied"; readonly description: string | undefined }
  | { readonly type: "missing_code" }
  | { readonly type: "state_mismatch" };

export type OpenRouterAuthUrlOptions = {
  readonly codeChallenge: string;
  /** Omit to use OpenRouter's headless PKCE flow (zero requests to Detour servers). */
  readonly callbackUrl?: string | undefined;
  readonly state?: string | undefined;
  readonly keyLabel?: string | undefined;
  readonly limitUsd?: number | undefined;
  readonly expiration?: OpenRouterKeyExpiration | undefined;
};

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function toLowerHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * RFC 7636 requires 43..128 characters. 32..96 random bytes encode to 43..128 base64url chars.
 */
export function encodeCodeVerifier(bytes: Uint8Array): Result<string, PkceVerifierError> {
  if (bytes.length < 32 || bytes.length > 96) {
    return err({ type: "invalid_verifier_length" });
  }
  return ok(base64UrlEncode(bytes));
}

export async function deriveCodeChallengeS256(
  codeVerifier: string,
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(digest);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateOpenRouterCallbackUrl(
  rawUrl: string,
): Result<string, InvalidCallbackUrlError> {
  if (!URL.canParse(rawUrl)) return err({ type: "invalid_callback_url" });
  const parsed = new URL(rawUrl);
  if (parsed.protocol === "https:") return ok(parsed.href);
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) return ok(parsed.href);
  return err({ type: "unsupported_callback_scheme", protocol: parsed.protocol });
}

export function buildOpenRouterAuthUrl(
  options: OpenRouterAuthUrlOptions,
): Result<string, InvalidCallbackUrlError> {
  const url = new URL(OPENROUTER_AUTH_URL);
  if (options.callbackUrl !== undefined) {
    const valid = validateOpenRouterCallbackUrl(options.callbackUrl);
    if (!valid.ok) return valid;
    url.searchParams.set("callback_url", valid.value);
  }
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (options.state !== undefined) url.searchParams.set("state", options.state);
  if (options.keyLabel !== undefined) url.searchParams.set("key_label", options.keyLabel);
  if (options.limitUsd !== undefined && options.limitUsd > 0 && options.limitUsd < 1_000_000) {
    url.searchParams.set("limit", String(options.limitUsd));
  }
  if (options.expiration !== undefined) url.searchParams.set("expiration", options.expiration);
  return ok(url.href);
}

export function parseOpenRouterCallbackUrl(
  rawUrl: string,
  expectedState?: string,
): Result<{ readonly code: string; readonly state: string | undefined }, OpenRouterCallbackError> {
  if (!URL.canParse(rawUrl)) return err({ type: "invalid_callback_url" });
  const params = new URL(rawUrl).searchParams;
  const errorParam = params.get("error");
  if (errorParam !== null) {
    return err({
      type: "access_denied",
      description: params.get("error_description") ?? undefined,
    });
  }
  const state = params.get("state") ?? undefined;
  if (expectedState !== undefined && state !== expectedState) {
    return err({ type: "state_mismatch" });
  }
  const code = params.get("code")?.trim();
  if (code === undefined || code.length === 0) return err({ type: "missing_code" });
  return ok({ code, state });
}

export function buildOpenRouterKeyLinks(keySha256Hex: string): {
  readonly activityUrl: string;
  readonly settingsUrl: string;
} {
  return {
    activityUrl: `https://openrouter.ai/logs?api_key_hash=${keySha256Hex}`,
    settingsUrl: `https://openrouter.ai/keys/${keySha256Hex}`,
  };
}
