/**
 * WorkOS AuthKit adapter. Wraps `@workos-inc/node` (which ships a native Cloudflare Workers
 * `workerd` build) so throwing SDK calls become `Result` values and tests can plug in an
 * in-process provider without hitting `api.workos.com`.
 */
import { err, ok, type Result } from "@detour/result";
import { AuthenticateWithSessionCookieFailureReason, WorkOS } from "@workos-inc/node";
import type { AuthUser, VerifiedWebSession } from "./types.ts";

export const SESSION_COOKIE_NAME = "wos-session";

export type WorkosConfig = {
  readonly apiKey: string;
  readonly clientId: string;
  readonly cookiePassword: string;
  readonly redirectUri: string;
};

export type AuthProviderError = {
  readonly type: "auth_provider_error";
  readonly cause: unknown;
};

/** What `/api/auth/sign-in` keeps (in an HttpOnly cookie) to verify the callback with. */
export type SignInStart = {
  readonly url: string;
  readonly state: string;
  readonly codeVerifier: string;
};

export type WebAuthProvider = {
  /** An AuthKit authorization URL with a fresh random `state` and PKCE (S256) verifier. */
  readonly startSignIn: () => Promise<Result<SignInStart, AuthProviderError>>;
  readonly authenticateCode: (input: {
    readonly code: string;
    readonly codeVerifier: string;
  }) => Promise<
    Result<{ readonly user: AuthUser; readonly sealedSession: string }, AuthProviderError>
  >;
  /**
   * `ok(null)`: not (or no longer) signed in. `err`: WorkOS could not answer (JWKS fetch, a
   * retryable refresh failure), so the caller is not known to be signed out.
   */
  readonly verifySealedSession: (
    sealedSession: string,
  ) => Promise<Result<VerifiedWebSession | null, AuthProviderError>>;
  /** Where to send the browser to end the WorkOS session; it returns to the web app's root. */
  readonly getLogoutUrl: (sealedSession: string) => Promise<string>;
};

type WorkosUser = {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string;
};

function toAuthUser(user: WorkosUser): AuthUser {
  const full = [user.firstName, user.lastName]
    .filter((part): part is string => part !== null && part.trim().length > 0)
    .join(" ")
    .trim();
  return { id: user.id, email: user.email, name: full.length > 0 ? full : user.email };
}

/** The `sub` claim of an access token whose signature WorkOS already verified. */
function accessTokenSubject(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (payload === undefined) return null;
  try {
    // `atob` decodes base64 without padding (forgiving-base64), in workerd as in Node.
    const claims: unknown = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    if (typeof claims !== "object" || claims === null || !("sub" in claims)) return null;
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

async function startWorkosSignIn(
  workos: WorkOS,
  config: WorkosConfig,
): Promise<Result<SignInStart, AuthProviderError>> {
  try {
    const started = await workos.userManagement.getAuthorizationUrlWithPKCE({
      provider: "authkit",
      clientId: config.clientId,
      redirectUri: config.redirectUri,
    });
    return ok({ url: started.url, state: started.state, codeVerifier: started.codeVerifier });
  } catch (cause) {
    return err({ type: "auth_provider_error", cause });
  }
}

async function authenticateWorkosCode(
  workos: WorkOS,
  config: WorkosConfig,
  input: { readonly code: string; readonly codeVerifier: string },
): Promise<Result<{ readonly user: AuthUser; readonly sealedSession: string }, AuthProviderError>> {
  try {
    const response = await workos.userManagement.authenticateWithCode({
      clientId: config.clientId,
      code: input.code,
      codeVerifier: input.codeVerifier,
      session: { sealSession: true, cookiePassword: config.cookiePassword },
    });
    if (response.sealedSession === undefined) {
      return err({
        type: "auth_provider_error",
        cause: new Error("WorkOS did not return a sealed session"),
      });
    }
    return ok({ user: toAuthUser(response.user), sealedSession: response.sealedSession });
  } catch (cause) {
    return err({ type: "auth_provider_error", cause });
  }
}

async function verifyWorkosSession(
  workos: WorkOS,
  cookiePassword: string,
  sealedSession: string,
): Promise<Result<VerifiedWebSession | null, AuthProviderError>> {
  try {
    const cookie = workos.userManagement.loadSealedSession({
      sessionData: sealedSession,
      cookiePassword,
    });
    const result = await cookie.authenticate();
    if (result.authenticated) {
      // The user object is read from the sealed payload, not from the verified JWT: bind them.
      if (accessTokenSubject(result.accessToken) !== result.user.id) return ok(null);
      const session = {
        kind: "web_session",
        sessionId: result.sessionId,
        user: toAuthUser(result.user),
      } as const;
      return ok({ session, refreshedSealedSession: null });
    }
    // An expired access token is the normal case after a few minutes: refresh it.
    if (result.reason !== AuthenticateWithSessionCookieFailureReason.INVALID_JWT) return ok(null);
    const refreshed = await cookie.refresh({ cookiePassword });
    if (!refreshed.authenticated) {
      return "retryable" in refreshed && refreshed.retryable
        ? err({ type: "auth_provider_error", cause: refreshed.reason })
        : ok(null);
    }
    if (refreshed.sealedSession === undefined) return ok(null);
    return ok({
      session: {
        kind: "web_session",
        sessionId: refreshed.sessionId,
        user: toAuthUser(refreshed.user),
      },
      refreshedSealedSession: refreshed.sealedSession,
    });
  } catch (cause) {
    return err({ type: "auth_provider_error", cause });
  }
}

async function logoutWorkosSession(
  workos: WorkOS,
  config: WorkosConfig,
  sealedSession: string,
): Promise<string> {
  // WorkOS wants an absolute URL registered as a sign-out redirect: the web app's root.
  const returnTo = new URL("/", config.redirectUri).href;
  try {
    const cookie = workos.userManagement.loadSealedSession({
      sessionData: sealedSession,
      cookiePassword: config.cookiePassword,
    });
    return await cookie.getLogoutUrl({ returnTo });
  } catch {
    return returnTo;
  }
}

export function createWorkosAuthProvider(config: WorkosConfig): WebAuthProvider {
  const workos = new WorkOS(config.apiKey, { clientId: config.clientId });

  return {
    startSignIn: () => startWorkosSignIn(workos, config),
    authenticateCode: (input) => authenticateWorkosCode(workos, config, input),
    verifySealedSession: (sealed) => verifyWorkosSession(workos, config.cookiePassword, sealed),
    getLogoutUrl: (sealed) => logoutWorkosSession(workos, config, sealed),
  };
}
