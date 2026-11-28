import { tryQuery, users } from "@detour/db";
import { fromThrowable } from "@detour/result";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono, type Context as HonoContext } from "hono";
import { deleteCookie, generateCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import * as z from "zod";
import { isSameOriginRequest, resolveRequestSession } from "./auth/session.ts";
import { secretsEqual } from "./auth/token-crypto.ts";
import { SESSION_COOKIE_NAME } from "./auth/workos.adapter.ts";
import type { Deps } from "./context.ts";
import { router } from "./router.ts";

/** Path prefix the RPC handler is mounted on. The web dev server proxies it. */
export const RPC_PREFIX = "/rpc";

/** Path prefix WorkOS AuthKit redirect/callback routes are mounted on. */
export const AUTH_PREFIX = "/api/auth";

/** The sign-in attempt in flight: `state`, PKCE verifier and where to return, for ten minutes. */
const SIGN_IN_FLOW_COOKIE = "detour_sign_in";
const SIGN_IN_FLOW_MAX_AGE_SECONDS = 600;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SignInFlowSchema = z.object({
  state: z.string().min(16),
  codeVerifier: z.string().min(43),
  returnTo: z.string(),
});

/** Declared errors are expected, and so are oRPC's own 4xx; anything else is a defect. */
const isDefect = (error: unknown): boolean =>
  !(error instanceof ORPCError) || (!error.defined && error.status >= 500);

const isExtensionOrigin = (origin: string): boolean =>
  origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");

const RETURN_BASE = "https://return.invalid";

/** A backslash (a browser reads it as `/`) or an ASCII control character (a browser drops them). */
function hasUnsafePathCharacter(raw: string): boolean {
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\" || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A same-origin path to send the browser to after sign-in, or `/`. Browsers read a backslash as
 * `/` and drop tabs and newlines, so "/" + backslash + "evil.example" would leave the site:
 * resolve it the way a browser does and keep it only if it stays on our origin.
 */
function safeReturnPath(raw: string | undefined): string {
  if (raw === undefined || !raw.startsWith("/") || hasUnsafePathCharacter(raw)) return "/";
  const resolved = URL.parse(raw, RETURN_BASE);
  if (resolved === null || resolved.origin !== RETURN_BASE) return "/";
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

const isHttps = (url: string): boolean => new URL(url).protocol === "https:";

/** The flow cookie holds JSON (Hono percent-encodes cookie values). Anything else: no flow. */
function readSignInFlow(c: HonoContext): z.infer<typeof SignInFlowSchema> | null {
  const raw = getCookie(c, SIGN_IN_FLOW_COOKIE);
  if (raw === undefined) return null;
  const json = fromThrowable(
    (): unknown => JSON.parse(raw),
    () => ({ type: "invalid_flow_cookie" }),
  );
  if (!json.ok) return null;
  const parsed = SignInFlowSchema.safeParse(json.value);
  return parsed.success ? parsed.data : null;
}

function sessionCookie(sealedSession: string, secure: boolean): string {
  return generateCookie(SESSION_COOKIE_NAME, sealedSession, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

function registerAuthRoutes(app: Hono, deps: Deps): void {
  app.get(`${AUTH_PREFIX}/sign-in`, async (c) => {
    const started = await deps.webAuth.startSignIn();
    if (!started.ok) return c.json({ error: "Sign-in is unavailable" }, 503);
    const flow = {
      state: started.value.state,
      codeVerifier: started.value.codeVerifier,
      returnTo: safeReturnPath(c.req.query("returnTo")),
    };
    setCookie(c, SIGN_IN_FLOW_COOKIE, JSON.stringify(flow), {
      path: AUTH_PREFIX,
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttps(c.req.url),
      maxAge: SIGN_IN_FLOW_MAX_AGE_SECONDS,
    });
    return c.redirect(started.value.url, 302);
  });

  app.get(`${AUTH_PREFIX}/callback`, async (c) => {
    // Only the browser that started this sign-in may finish it (no login CSRF): its cookie holds
    // the `state` WorkOS echoes back and the PKCE verifier the code is bound to.
    const flow = readSignInFlow(c);
    deleteCookie(c, SIGN_IN_FLOW_COOKIE, { path: AUTH_PREFIX });
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (flow === null || state === undefined || !secretsEqual(state, flow.state)) {
      return c.json({ error: "Sign-in expired or was started elsewhere. Sign in again." }, 400);
    }
    if (code === undefined || code.trim().length === 0) {
      return c.json({ error: "Missing authorization code" }, 400);
    }
    const authenticated = await deps.webAuth.authenticateCode({
      code,
      codeVerifier: flow.codeVerifier,
    });
    if (!authenticated.ok) return c.json({ error: "Authentication failed" }, 401);

    const { user, sealedSession } = authenticated.value;
    const now = deps.now();
    const upserted = await tryQuery(() =>
      deps.db
        .insert(users)
        .values({ id: user.id, email: user.email, name: user.name, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: users.id,
          set: { email: user.email, name: user.name, updatedAt: now },
        }),
    );
    if (!upserted.ok) return c.json({ error: "Service unavailable" }, 503);

    c.header("set-cookie", sessionCookie(sealedSession, isHttps(c.req.url)), { append: true });
    return c.redirect(safeReturnPath(flow.returnTo), 302);
  });

  app.post(`${AUTH_PREFIX}/sign-out`, async (c) => {
    if (!isSameOriginRequest(c.req.raw.headers, c.req.url))
      return c.json({ error: "Forbidden" }, 403);
    const sealed = getCookie(c, SESSION_COOKIE_NAME);
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    const logoutUrl = sealed === undefined ? "/" : await deps.webAuth.getLogoutUrl(sealed);
    return c.json({ logoutUrl });
  });
}

/**
 * The HTTP app: WorkOS AuthKit routes on `/api/auth/*` and oRPC on `/rpc/*`.
 */
export function createApp(deps: Deps): Hono {
  const handler = new RPCHandler(router, {
    clientInterceptors: [
      onError((error) => {
        if (isDefect(error)) console.error(error);
      }),
    ],
  });
  const app = new Hono();

  registerAuthRoutes(app, deps);

  // Extension origins call `/rpc/*` with `Authorization: Bearer dtr_...` (no cookies).
  app.use(
    `${RPC_PREFIX}/*`,
    cors({
      origin: (origin) => (isExtensionOrigin(origin) ? origin : null),
      allowMethods: ["POST", "GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: false,
    }),
  );

  app.use(`${RPC_PREFIX}/*`, async (c, next) => {
    const resolved = await resolveRequestSession(deps, c.req.raw);
    const { matched, response } = await handler.handle(c.req.raw, {
      prefix: RPC_PREFIX,
      context: {
        ...deps,
        session: resolved.ok ? resolved.value.session : null,
        sessionUnavailable: resolved.ok ? null : resolved.error.reason,
      },
    });
    if (!matched) return next();
    const refreshed = resolved.ok ? resolved.value.refreshedSealedSession : null;
    if (refreshed !== null)
      c.header("set-cookie", sessionCookie(refreshed, isHttps(c.req.url)), { append: true });
    return c.newResponse(response.body, response);
  });

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}
