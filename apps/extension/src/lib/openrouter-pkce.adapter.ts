/**
 * Web Crypto + HTTP adapter for OpenRouter OAuth PKCE.
 * Keeps `code_verifier` inside the extension and exchanges the code directly with OpenRouter.
 */
import { err, ok, type Result } from "@detour/result";
import {
  base64UrlEncode,
  buildOpenRouterAuthUrl,
  buildOpenRouterKeyLinks,
  deriveCodeChallengeS256,
  encodeCodeVerifier,
  OPENROUTER_KEYS_EXCHANGE_URL,
  toLowerHex,
  type InvalidCallbackUrlError,
  type OpenRouterKeyExpiration,
} from "./openrouter-pkce.ts";

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export type PkceSession = {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  /** Only with a `callbackUrl`: headless mode sends no state, so there is none to check. */
  readonly state: string | undefined;
  readonly authUrl: string;
};

export type PkceSessionError =
  | InvalidCallbackUrlError
  | { readonly type: "crypto_unavailable"; readonly cause: unknown };

export type OpenRouterExchangeError =
  | { readonly type: "network_error"; readonly cause: unknown }
  | { readonly type: "invalid_code"; readonly status: number; readonly message: string }
  | { readonly type: "code_expired"; readonly message: string }
  | { readonly type: "invalid_response"; readonly status: number };

export type OpenRouterKeyResult = {
  readonly apiKey: string;
  readonly userId: string | undefined;
  readonly keyLinks: {
    readonly activityUrl: string;
    readonly settingsUrl: string;
  };
};

const defaultTransport: HttpTransport = (url, init) => globalThis.fetch(url, init);

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return new Uint8Array(digest);
}

export async function createOpenRouterPkceSession(
  options: {
    readonly callbackUrl?: string | undefined;
    readonly keyLabel?: string | undefined;
    readonly limitUsd?: number | undefined;
    readonly expiration?: OpenRouterKeyExpiration | undefined;
  } = {},
): Promise<Result<PkceSession, PkceSessionError>> {
  try {
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const stateBytes = crypto.getRandomValues(new Uint8Array(16));
    const verifier = encodeCodeVerifier(verifierBytes);
    if (!verifier.ok) return err({ type: "crypto_unavailable", cause: verifier.error });

    const codeChallenge = await deriveCodeChallengeS256(verifier.value, sha256Bytes);
    const state = options.callbackUrl === undefined ? undefined : base64UrlEncode(stateBytes);
    const authUrl = buildOpenRouterAuthUrl({
      codeChallenge,
      callbackUrl: options.callbackUrl,
      state,
      keyLabel: options.keyLabel ?? "Detour",
      limitUsd: options.limitUsd,
      expiration: options.expiration,
    });
    if (!authUrl.ok) return authUrl;

    return ok({
      codeVerifier: verifier.value,
      codeChallenge,
      state,
      authUrl: authUrl.value,
    });
  } catch (cause) {
    return err({ type: "crypto_unavailable", cause });
  }
}

function readErrorMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "Authorization code rejected";
  if ("error" in payload && typeof payload.error === "object" && payload.error !== null) {
    const nested = payload.error;
    if ("message" in nested && typeof nested.message === "string") return nested.message;
  }
  if ("message" in payload && typeof payload.message === "string") return payload.message;
  return "Authorization code rejected";
}

function parseKeyPayload(
  payload: unknown,
): { readonly key: string; readonly userId: string | undefined } | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("key" in payload) || typeof payload.key !== "string" || payload.key.length === 0) {
    return null;
  }
  const userId =
    "user_id" in payload && typeof payload.user_id === "string" ? payload.user_id : undefined;
  return { key: payload.key, userId };
}

export async function exchangeOpenRouterCode(
  input: { readonly code: string; readonly codeVerifier: string },
  transport: HttpTransport = defaultTransport,
): Promise<Result<OpenRouterKeyResult, OpenRouterExchangeError>> {
  let response: Response;
  try {
    response = await transport(OPENROUTER_KEYS_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: input.code.trim(),
        code_verifier: input.codeVerifier,
        code_challenge_method: "S256",
      }),
    });
  } catch (cause) {
    return err({ type: "network_error", cause });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return err({ type: "invalid_response", status: response.status });
  }

  if (!response.ok) {
    const message = readErrorMessage(payload);
    if (response.status === 403 && message.toLowerCase().includes("expired")) {
      return err({ type: "code_expired", message });
    }
    if (response.status === 400 || response.status === 403) {
      return err({ type: "invalid_code", status: response.status, message });
    }
    return err({ type: "invalid_response", status: response.status });
  }

  const parsed = parseKeyPayload(payload);
  if (parsed === null) return err({ type: "invalid_response", status: response.status });

  try {
    const keyHash = toLowerHex(await sha256Bytes(new TextEncoder().encode(parsed.key)));
    return ok({
      apiKey: parsed.key,
      userId: parsed.userId,
      keyLinks: buildOpenRouterKeyLinks(keyHash),
    });
  } catch (cause) {
    return err({ type: "network_error", cause });
  }
}
