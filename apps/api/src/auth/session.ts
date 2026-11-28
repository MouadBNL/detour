import { extensionTokens, tryQuery, users, type Db } from "@detour/db";
import { err, ok, type Result } from "@detour/result";
import { and, eq, gt, isNull } from "drizzle-orm";
import { parse as parseCookies } from "hono/utils/cookie";
import type { UnavailableReason } from "../errors.ts";
import { EXTENSION_TOKEN_PREFIX, hashSecret } from "./token-crypto.ts";
import type { ExtensionTokenSession, RequestSession } from "./types.ts";
import { SESSION_COOKIE_NAME, type WebAuthProvider } from "./workos.adapter.ts";

/** `lastUsedAt` is informational ("last seen"): write it at most this often per token. */
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;

type SessionDeps = {
  readonly webAuth: WebAuthProvider;
  readonly db: Db;
  readonly now: () => Date;
};

export type ResolvedSession = {
  readonly session: RequestSession | null;
  /** Set when WorkOS refreshed the access token: the response must re-set the cookie. */
  readonly refreshedSealedSession: string | null;
};

export type SessionUnavailable = {
  readonly type: "unavailable";
  readonly reason: UnavailableReason;
};

const SIGNED_OUT: ResolvedSession = { session: null, refreshedSealedSession: null };

function parseBearerToken(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (raw === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  const token = match?.[1];
  if (token === undefined || !token.startsWith(EXTENSION_TOKEN_PREFIX)) return null;
  return token;
}

/**
 * Whether the browser says this request comes from our own pages. The session cookie is
 * `SameSite=Lax`, which still lets a sibling subdomain (or another localhost port) post a form
 * with it; `Sec-Fetch-Site` tells them apart. Clients that send no fetch metadata (old browsers,
 * tests, server-to-server) fall back to `Origin`, which a browser always sends on a cross-origin
 * POST.
 */
export function isSameOriginRequest(headers: Headers, requestUrl: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = headers.get("origin");
  return origin === null || origin === new URL(requestUrl).origin;
}

async function resolveExtensionToken(
  deps: Pick<SessionDeps, "db" | "now">,
  rawToken: string,
): Promise<Result<ExtensionTokenSession | null, SessionUnavailable>> {
  const currentTime = deps.now();
  const found = await tryQuery(() =>
    deps.db
      .select({
        tokenId: extensionTokens.id.as("token_id"),
        scopes: extensionTokens.scopes,
        lastUsedAt: extensionTokens.lastUsedAt,
        userId: users.id.as("user_id"),
        email: users.email,
        name: users.name,
      })
      .from(extensionTokens)
      .innerJoin(users, eq(extensionTokens.userId, users.id))
      .where(
        and(
          eq(extensionTokens.tokenHash, hashSecret(rawToken)),
          isNull(extensionTokens.revokedAt),
          gt(extensionTokens.expiresAt, currentTime),
        ),
      )
      .limit(1),
  );
  if (!found.ok) return err({ type: "unavailable", reason: "database_unavailable" });
  const [row] = found.value;
  if (row === undefined) return ok(null);

  const stale =
    row.lastUsedAt === null ||
    currentTime.getTime() - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS;
  // Best effort: a failed "last seen" write must not fail an authenticated request.
  if (stale) {
    await tryQuery(() =>
      deps.db
        .update(extensionTokens)
        .set({ lastUsedAt: currentTime })
        .where(eq(extensionTokens.id, row.tokenId)),
    );
  }

  return ok({
    kind: "extension_token",
    tokenId: row.tokenId,
    scopes: row.scopes,
    user: { id: row.userId, email: row.email, name: row.name },
  });
}

/**
 * Resolves the caller's session once per RPC request:
 * 1. Scoped extension bearer token (`Authorization: Bearer dtr_...`), checked against `extension_tokens`.
 * 2. WorkOS AuthKit sealed session cookie (`wos-session`), only on same-origin requests;
 *    refreshed through WorkOS when its access token expired.
 * 3. Neither -> signed out, with zero database queries.
 *
 * An outage (D1, WorkOS) is an `Err`, never "signed out": the caller must not drop its token.
 */
export async function resolveRequestSession(
  deps: SessionDeps,
  request: Request,
): Promise<Result<ResolvedSession, SessionUnavailable>> {
  const bearerToken = parseBearerToken(request.headers);
  if (bearerToken !== null) {
    const token = await resolveExtensionToken(deps, bearerToken);
    return token.ok ? ok({ session: token.value, refreshedSealedSession: null }) : token;
  }

  const sealedSession = parseCookies(request.headers.get("cookie") ?? "", SESSION_COOKIE_NAME)[
    SESSION_COOKIE_NAME
  ];
  if (sealedSession === undefined || sealedSession.length === 0) return ok(SIGNED_OUT);
  if (!isSameOriginRequest(request.headers, request.url)) return ok(SIGNED_OUT);

  const verified = await deps.webAuth.verifySealedSession(sealedSession);
  if (!verified.ok) return err({ type: "unavailable", reason: "auth_unavailable" });
  if (verified.value === null) return ok(SIGNED_OUT);
  return ok({
    session: verified.value.session,
    refreshedSealedSession: verified.value.refreshedSealedSession,
  });
}
