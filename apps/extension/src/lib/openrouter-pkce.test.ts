import { createHash } from "node:crypto";
import { assert, describe, expect, it } from "vite-plus/test";
import {
  buildOpenRouterAuthUrl,
  buildOpenRouterKeyLinks,
  deriveCodeChallengeS256,
  encodeCodeVerifier,
  parseOpenRouterCallbackUrl,
  toLowerHex,
} from "./openrouter-pkce.ts";

const nodeSha256 = (bytes: Uint8Array): Promise<Uint8Array> =>
  Promise.resolve(new Uint8Array(createHash("sha256").update(bytes).digest()));

describe("openrouter-pkce pure helpers", () => {
  it("matches the RFC 7636 Appendix B S256 test vector", async () => {
    const challenge = await deriveCodeChallengeS256(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      nodeSha256,
    );
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("enforces RFC 7636 verifier byte bounds (32..96 bytes -> 43..128 base64url chars)", () => {
    expect(encodeCodeVerifier(new Uint8Array(31))).toEqual({
      ok: false,
      error: { type: "invalid_verifier_length" },
    });
    expect(encodeCodeVerifier(new Uint8Array(97))).toEqual({
      ok: false,
      error: { type: "invalid_verifier_length" },
    });
    const valid = encodeCodeVerifier(new Uint8Array(32).fill(7));
    assert(valid.ok);
    expect(valid.value.length).toBe(43);
    expect(valid.value).not.toMatch(/[+/=]/);
  });

  it("builds a headless OpenRouter PKCE URL (omitting callback_url) for zero Detour server hits", () => {
    const built = buildOpenRouterAuthUrl({
      codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      keyLabel: "Detour",
      limitUsd: 5,
      expiration: "90-days",
    });
    assert(built.ok);
    const parsed = new URL(built.value);
    expect(parsed.origin + parsed.pathname).toBe("https://openrouter.ai/auth");
    expect(parsed.searchParams.get("callback_url")).toBeNull();
    expect(parsed.searchParams.get("code_challenge")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("key_label")).toBe("Detour");
    expect(parsed.searchParams.get("limit")).toBe("5");
    expect(parsed.searchParams.get("expiration")).toBe("90-days");
  });

  it("accepts https and loopback callback URLs and rejects plain http or custom extension schemes", () => {
    const httpsUrl = buildOpenRouterAuthUrl({
      codeChallenge: "challenge",
      callbackUrl: "https://detour.app/openrouter/callback",
      state: "csrf-123",
    });
    expect(httpsUrl.ok).toBe(true);

    const localhostUrl = buildOpenRouterAuthUrl({
      codeChallenge: "challenge",
      callbackUrl: "http://localhost:5173/openrouter/callback",
    });
    expect(localhostUrl.ok).toBe(true);

    expect(
      buildOpenRouterAuthUrl({
        codeChallenge: "challenge",
        callbackUrl: "http://detour.app/callback",
      }),
    ).toEqual({
      ok: false,
      error: { type: "unsupported_callback_scheme", protocol: "http:" },
    });

    expect(
      buildOpenRouterAuthUrl({
        codeChallenge: "challenge",
        callbackUrl: "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/callback.html",
      }),
    ).toEqual({
      ok: false,
      error: { type: "unsupported_callback_scheme", protocol: "chrome-extension:" },
    });

    expect(
      buildOpenRouterAuthUrl({
        codeChallenge: "challenge",
        callbackUrl: "moz-extension://12345678-1234-1234-1234-1234567890ab/callback.html",
      }),
    ).toEqual({
      ok: false,
      error: { type: "unsupported_callback_scheme", protocol: "moz-extension:" },
    });
  });

  it("parses callback codes and guards against CSRF state mismatch and user denial", () => {
    expect(
      parseOpenRouterCallbackUrl(
        "https://detour.app/openrouter/callback?code=or_code_123&state=s1",
        "s1",
      ),
    ).toEqual({ ok: true, value: { code: "or_code_123", state: "s1" } });

    expect(
      parseOpenRouterCallbackUrl(
        "https://detour.app/openrouter/callback?code=or_code_123&state=wrong",
        "s1",
      ),
    ).toEqual({ ok: false, error: { type: "state_mismatch" } });

    expect(
      parseOpenRouterCallbackUrl(
        "https://detour.app/openrouter/callback?error=access_denied&error_description=Cancelled",
        "s1",
      ),
    ).toEqual({ ok: false, error: { type: "access_denied", description: "Cancelled" } });
  });

  it("builds OpenRouter activity and settings deep links from lowercase SHA-256 hex", () => {
    const hex = toLowerHex(new Uint8Array([0x0a, 0xff]));
    expect(hex).toBe("0aff");
    expect(buildOpenRouterKeyLinks(hex)).toEqual({
      activityUrl: "https://openrouter.ai/logs?api_key_hash=0aff",
      settingsUrl: "https://openrouter.ai/keys/0aff",
    });
  });
});
