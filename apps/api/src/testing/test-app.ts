/**
 * The whole API, in process, on a fresh in-memory SQLite/D1-compatible database.
 * Uses an in-process WorkOS AuthKit test provider so tests exercise real sealed cookies,
 * `/api/auth/*` routes, user upserts, and oRPC without outbound network calls.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { ApiClient } from "@detour/contracts";
import { users } from "@detour/db";
import { createTestDb } from "@detour/db/testing";
import { err, ok } from "@detour/result";
import { createORPCClient, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import * as z from "zod";
import { createApp, RPC_PREFIX } from "../app.ts";
import type { AuthUser } from "../auth/types.ts";
import { SESSION_COOKIE_NAME, type WebAuthProvider } from "../auth/workos.adapter.ts";
import type { Deps } from "../context.ts";

/** Origin of every test request. */
const TEST_ORIGIN = "http://app.test";
const TEST_SIGNING_SECRET = "test-only-workos-sealed-session-secret";

const SealedPayloadSchema = z.object({
  sessionId: z.string(),
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  /** Simulates the WorkOS access token's `exp`: past it, verification must refresh. */
  accessTokenExpired: z.boolean(),
});

type SealedPayload = z.infer<typeof SealedPayloadSchema>;

function signPayload(payload: SealedPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", TEST_SIGNING_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function verifyPayload(sealed: string): SealedPayload | null {
  const [encoded, sig] = sealed.split(".");
  if (encoded === undefined || sig === undefined) return null;
  const expected = createHmac("sha256", TEST_SIGNING_SECRET).update(encoded).digest("base64url");
  if (sig !== expected) return null;
  const parsed = SealedPayloadSchema.safeParse(
    JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
  );
  return parsed.success ? parsed.data : null;
}

type TestWebAuth = {
  readonly provider: WebAuthProvider;
  readonly registerCode: (code: string, user: AuthUser) => void;
  readonly sealUser: (user: AuthUser, options?: { readonly expired?: boolean }) => string;
  readonly setUnavailable: (unavailable: boolean) => void;
};

/**
 * AuthKit in process: `startSignIn` issues a random state and PKCE verifier, and a code only
 * exchanges with a verifier this provider issued. A sealed session marked `accessTokenExpired`
 * refreshes into a new one, as WorkOS does; `setUnavailable(true)` makes verification fail as a
 * WorkOS outage would.
 */
function createTestWebAuthProvider(): TestWebAuth {
  const codes = new Map<string, AuthUser>();
  const verifiers = new Set<string>();
  let sessionSeq = 0;
  let unavailable = false;

  const sealUser = (user: AuthUser, options: { readonly expired?: boolean } = {}): string => {
    sessionSeq += 1;
    return signPayload({
      sessionId: `sess_test_${String(sessionSeq)}`,
      user,
      accessTokenExpired: options.expired ?? false,
    });
  };

  const provider: WebAuthProvider = {
    startSignIn: () => {
      const state = randomBytes(16).toString("base64url");
      const codeVerifier = randomBytes(32).toString("base64url");
      verifiers.add(codeVerifier);
      const url = new URL("https://authkit.workos.test/authorize");
      url.searchParams.set("state", state);
      return Promise.resolve(ok({ url: url.href, state, codeVerifier }));
    },
    authenticateCode: ({ code, codeVerifier }) => {
      const user = codes.get(code);
      if (user === undefined || !verifiers.has(codeVerifier)) {
        return Promise.resolve(err({ type: "auth_provider_error", cause: "invalid_grant" }));
      }
      codes.delete(code);
      verifiers.delete(codeVerifier);
      return Promise.resolve(ok({ user, sealedSession: sealUser(user) }));
    },
    verifySealedSession: (sealedSession) => {
      if (unavailable) {
        return Promise.resolve(err({ type: "auth_provider_error", cause: "jwks_unreachable" }));
      }
      const verified = verifyPayload(sealedSession);
      if (verified === null) return Promise.resolve(ok(null));
      const refreshed = verified.accessTokenExpired ? sealUser(verified.user) : null;
      return Promise.resolve(
        ok({
          session: { kind: "web_session", sessionId: verified.sessionId, user: verified.user },
          refreshedSealedSession: refreshed,
        }),
      );
    },
    getLogoutUrl: () => Promise.resolve("https://authkit.workos.test/logout"),
  };

  return {
    provider,
    registerCode: (code, user) => {
      codes.set(code, user);
    },
    sealUser,
    setUnavailable: (value) => {
      unavailable = value;
    },
  };
}

export type SignedUpUser = {
  readonly user: AuthUser;
  readonly cookieHeader: string;
  readonly client: ApiClient;
};

export type TestApp = {
  /** Unauthenticated client of the whole API, typed from the contract. */
  readonly client: ApiClient;
  /** Client authenticated with a scoped extension bearer token. */
  readonly clientWithToken: (token: string) => ApiClient;
  /** Client authenticated with a raw `Cookie` header (e.g. from `/api/auth/callback`). */
  readonly clientWithCookie: (cookieHeader: string) => ApiClient;
  /** Client sending exactly these headers (cookies plus fetch metadata, say). */
  readonly clientWithHeaders: (headers: Readonly<Record<string, string>>) => ApiClient;
  /** Seeds a WorkOS user in SQLite and returns a sealed-cookie-authenticated oRPC client. */
  readonly signUp: (input?: {
    readonly email?: string;
    readonly name?: string;
    /** Seal the session with an expired access token, so the first request refreshes it. */
    readonly expiredAccessToken?: boolean;
  }) => Promise<SignedUpUser>;
  /** Simulates a WorkOS outage (JWKS or refresh unreachable) for cookie verification. */
  readonly setAuthUnavailable: (unavailable: boolean) => void;
  /** Registers a one-time AuthKit callback code for testing `/api/auth/callback`. */
  readonly registerAuthCode: (code: string, user: AuthUser) => void;
  /** Direct HTTP access to the Hono app (e.g. for `/api/auth/*` and CORS checks). */
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
};

let userCounter = 0;

function makeClient(
  appFetch: (request: Request) => Response | Promise<Response>,
  headers?: Readonly<Record<string, string>>,
): ApiClient {
  return createORPCClient(
    new RPCLink({
      url: new URL(RPC_PREFIX, TEST_ORIGIN).href,
      headers: () => (headers === undefined ? {} : { ...headers }),
      fetch: async (request) => appFetch(request),
    }),
  );
}

export async function createTestApp(overrides: Partial<Deps> = {}): Promise<TestApp> {
  const db = overrides.db ?? (await createTestDb());
  const now = overrides.now ?? (() => new Date());
  const testAuth = createTestWebAuthProvider();
  const app = createApp({
    lifecycle: { isShuttingDown: () => false },
    now,
    ...overrides,
    db,
    webAuth: overrides.webAuth ?? testAuth.provider,
  });

  const appFetch = (request: Request) => app.fetch(request);

  return {
    client: makeClient(appFetch),
    clientWithToken: (token) => makeClient(appFetch, { authorization: `Bearer ${token}` }),
    clientWithCookie: (cookieHeader) => makeClient(appFetch, { cookie: cookieHeader }),
    clientWithHeaders: (headers) => makeClient(appFetch, headers),
    signUp: async (input = {}) => {
      userCounter += 1;
      const user: AuthUser = {
        id: `user_01test_${String(userCounter)}`,
        email: input.email ?? `user-${String(userCounter)}@detour.test`,
        name: input.name ?? `User ${String(userCounter)}`,
      };
      const timestamp = now();
      await db.insert(users).values({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const sealed = testAuth.sealUser(user, { expired: input.expiredAccessToken ?? false });
      const cookieHeader = `${SESSION_COOKIE_NAME}=${sealed}`;
      return {
        user,
        cookieHeader,
        client: makeClient(appFetch, { cookie: cookieHeader }),
      };
    },
    registerAuthCode: testAuth.registerCode,
    setAuthUnavailable: testAuth.setUnavailable,
    fetch: (path, init) =>
      Promise.resolve(app.fetch(new Request(new URL(path, TEST_ORIGIN), init))),
  };
}

let warmed: Promise<void> | undefined;

export async function warmUpTestApp(): Promise<void> {
  warmed ??= (async () => {
    const t = await createTestApp();
    await safe(t.client.system.health());
  })();
  await warmed;
}
