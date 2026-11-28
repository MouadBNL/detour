import { assert, describe, expect, it } from "vite-plus/test";
import {
  createOpenRouterPkceSession,
  exchangeOpenRouterCode,
  type HttpTransport,
} from "./openrouter-pkce.adapter.ts";

const invalidCodeTransport: HttpTransport = () =>
  Promise.resolve(
    new Response(JSON.stringify({ error: { message: "Invalid code", code: 400 } }), {
      status: 400,
    }),
  );

const expiredCodeTransport: HttpTransport = () =>
  Promise.resolve(
    new Response(JSON.stringify({ message: "Authorization code expired" }), { status: 403 }),
  );

const offlineTransport: HttpTransport = () => Promise.reject(new TypeError("offline"));

describe("openrouter-pkce.adapter", () => {
  it("generates an S256 PKCE session with Web Crypto", async () => {
    const session = await createOpenRouterPkceSession({
      callbackUrl: "https://detour.app/openrouter/callback",
      keyLabel: "Detour",
    });
    assert(session.ok);
    expect(session.value.codeVerifier.length).toBe(43);
    expect(session.value.codeChallenge.length).toBe(43);
    expect(session.value.codeChallenge).not.toBe(session.value.codeVerifier);

    const parsed = new URL(session.value.authUrl);
    expect(parsed.searchParams.get("code_challenge")).toBe(session.value.codeChallenge);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe(session.value.state);
    expect(parsed.searchParams.get("callback_url")).toBe("https://detour.app/openrouter/callback");
  });

  it("exchanges an authorization code for a user API key and computes key deep links", async () => {
    let sentBody: unknown;
    const transport: HttpTransport = (url, init) => {
      expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
      expect(init.method).toBe("POST");
      sentBody = JSON.parse(typeof init.body === "string" ? init.body : "{}");
      return Promise.resolve(
        new Response(JSON.stringify({ key: "sk-or-v1-test-key", user_id: "user_42" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };

    const result = await exchangeOpenRouterCode(
      { code: " auth_code_123 ", codeVerifier: "verifier_abc" },
      transport,
    );
    assert(result.ok);
    expect(sentBody).toEqual({
      code: "auth_code_123",
      code_verifier: "verifier_abc",
      code_challenge_method: "S256",
    });
    expect(result.value.apiKey).toBe("sk-or-v1-test-key");
    expect(result.value.userId).toBe("user_42");
    expect(result.value.keyLinks.activityUrl).toMatch(
      /^https:\/\/openrouter\.ai\/logs\?api_key_hash=[0-9a-f]{64}$/,
    );
    expect(result.value.keyLinks.settingsUrl).toMatch(
      /^https:\/\/openrouter\.ai\/keys\/[0-9a-f]{64}$/,
    );
  });

  it("maps 400 Invalid code, 403 expired, and network errors to tagged results", async () => {
    expect(
      await exchangeOpenRouterCode({ code: "bad", codeVerifier: "v" }, invalidCodeTransport),
    ).toEqual({
      ok: false,
      error: { type: "invalid_code", status: 400, message: "Invalid code" },
    });

    expect(
      await exchangeOpenRouterCode({ code: "old", codeVerifier: "v" }, expiredCodeTransport),
    ).toEqual({
      ok: false,
      error: { type: "code_expired", message: "Authorization code expired" },
    });

    const offline = await exchangeOpenRouterCode(
      { code: "x", codeVerifier: "v" },
      offlineTransport,
    );
    assert(!offline.ok);
    expect(offline.error.type).toBe("network_error");
  });
});
