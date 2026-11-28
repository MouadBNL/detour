/**
 * The API's only runtime: a Cloudflare Worker (`wrangler dev` locally, `wrangler deploy` in
 * production; config in wrangler.jsonc). `Bindings` is generated from wrangler.jsonc by
 * `wrangler types` (worker-configuration.d.ts): `DB` is the D1 binding, the WorkOS settings are
 * secrets, validated by `loadEnv` on every request (parsing a handful of strings is cheap, and a
 * Worker isolate has no startup hook to fail in).
 */
import { createD1Db } from "@detour/db";
import { createApp } from "./app.ts";
import {
  createWorkosAuthProvider,
  type WebAuthProvider,
  type WorkosConfig,
} from "./auth/workos.adapter.ts";
import { loadEnv } from "./env.ts";

/**
 * One WorkOS client per isolate and config, not per request: the SDK caches the JWKS it verifies
 * access tokens with on the client, so a fresh one would fetch the keys on every signed-in call.
 */
let cachedAuth: { readonly key: string; readonly provider: WebAuthProvider } | undefined;

function webAuthFor(config: WorkosConfig): WebAuthProvider {
  const key = JSON.stringify(config);
  if (cachedAuth?.key !== key) cachedAuth = { key, provider: createWorkosAuthProvider(config) };
  return cachedAuth.provider;
}

/** Dev without `WORKOS_COOKIE_PASSWORD`: random per isolate (never a committed value). */
let isolateCookiePassword: string | undefined;

function cookiePasswordFor(configured: string | undefined): string {
  if (configured !== undefined) return configured;
  if (isolateCookiePassword === undefined) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    isolateCookiePassword = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
    console.warn("WORKOS_COOKIE_PASSWORD is not set: using a random one until this isolate exits.");
  }
  return isolateCookiePassword;
}

const worker = {
  fetch(request: Request, bindings: Bindings): Response | Promise<Response> {
    const env = loadEnv(bindings);
    if (!env.ok) {
      console.error(`Invalid environment:\n${env.error.issues}`);
      return Response.json({ error: "Service misconfigured" }, { status: 500 });
    }
    const app = createApp({
      // Workers have no SIGTERM to drain on: an isolate is never "shutting down" mid-request.
      lifecycle: { isShuttingDown: () => false },
      now: () => new Date(),
      db: createD1Db(bindings.DB),
      webAuth: webAuthFor({
        apiKey: env.value.WORKOS_API_KEY,
        clientId: env.value.WORKOS_CLIENT_ID,
        cookiePassword: cookiePasswordFor(env.value.WORKOS_COOKIE_PASSWORD),
        redirectUri: env.value.WORKOS_REDIRECT_URI,
      }),
    });
    return app.fetch(request);
  },
};

export default worker;
