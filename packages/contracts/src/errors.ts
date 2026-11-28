/**
 * Errors several procedures can share, declared once. A procedure lists the errors it can return
 * in `.errors({...})`, reusing these definitions; on the client, `isDefinedError(error)` narrows
 * to them with a typed `code` and `data`.
 */
import * as z from "zod";

/**
 * Why the API cannot serve the request right now. `auth_unavailable`: the sign-in provider
 * (WorkOS) could not verify or refresh a session, so the caller is not known to be signed out.
 */
export const UNAVAILABLE_REASONS = [
  "shutting_down",
  "database_unavailable",
  "auth_unavailable",
] as const;

/** Why a signed-in caller is not allowed to perform an action. */
export const FORBIDDEN_REASONS = ["web_session_required"] as const;

/**
 * The server is up but cannot serve: it is draining before a restart, or its database or sign-in
 * provider does not answer. Retrying later can succeed. The API returns it with `unavailable()` (`apps/api`).
 */
export const SERVICE_UNAVAILABLE = {
  status: 503,
  message: "The service is temporarily unavailable",
  data: z.object({ reason: z.enum(UNAVAILABLE_REASONS) }),
};

/** The caller has no valid session (neither web cookie nor extension bearer token). */
export const UNAUTHORIZED = {
  status: 401,
  message: "Sign in to continue",
};

/** The caller is authenticated, but their session kind or scope cannot perform this action. */
export const FORBIDDEN = {
  status: 403,
  message: "You do not have permission to perform this action",
  data: z.object({ reason: z.enum(FORBIDDEN_REASONS) }),
};

/** The requested record does not exist or is not visible to the caller. */
export const NOT_FOUND = {
  status: 404,
  message: "The requested resource was not found",
};
