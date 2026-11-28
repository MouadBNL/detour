/**
 * `respond`, which turns a service's `Result` into the procedure's output or its declared error,
 * plus procedure bases (middlewares requiring a signed-in session or a web session).
 */
import type { NOT_FOUND } from "@detour/contracts";
import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  UNAUTHORIZED,
  UNAVAILABLE_REASONS,
} from "@detour/contracts";
import { err, ok, type Result, type TaggedError } from "@detour/result";
import { ORPCError, os as orpcOs, type ORPCErrorConstructorMap } from "@orpc/server";
import * as z from "zod";
import type { RequestSession } from "../auth/types.ts";
import type { Context } from "../context.ts";
import type { NotFound, SharedError, Unavailable } from "../errors.ts";
import { orThrow } from "./result.adapter.ts";

type SharedErrorMap = ORPCErrorConstructorMap<{
  SERVICE_UNAVAILABLE: typeof SERVICE_UNAVAILABLE;
  NOT_FOUND: typeof NOT_FOUND;
}>;

/** The constructor of `S` when `E` can hold `Error` (a procedure that never returns it needs none). */
type IfHolds<E, Error, S extends keyof SharedErrorMap> = [Extract<E, Error>] extends [never]
  ? unknown
  : Pick<SharedErrorMap, S>;

/** The constructors `respond` needs for the shared errors `E` can hold. */
type ErrorsFor<E> = IfHolds<E, Unavailable, "SERVICE_UNAVAILABLE"> &
  IfHolds<E, NotFound, "NOT_FOUND">;

/** The errors a router maps itself: those of `E` that are not shared. */
type Own<E> = Exclude<E, SharedError>;
type OwnMapper<E> = [Own<E>] extends [never]
  ? []
  : [own: (error: Own<E>) => ORPCError<string, unknown>];

const SharedErrorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unexpected"), detail: z.string() }),
  z.object({ type: z.literal("unavailable"), reason: z.enum(UNAVAILABLE_REASONS) }),
  z.object({ type: z.literal("not_found") }),
]);

/**
 * An error the procedure does not declare: a bug, not something the caller can act on. An
 * undeclared 500, which `app.ts` logs as a defect.
 */
const defect = (error: TaggedError) => new ORPCError("INTERNAL_SERVER_ERROR", { cause: error });

/** The declared error for a shared one; a branch per variant of `SharedErrorSchema`. */
function sharedError(
  errors: Partial<SharedErrorMap>,
  error: z.infer<typeof SharedErrorSchema>,
): ORPCError<string, unknown> {
  if (error.type === "unexpected") return defect(error);
  if (error.type === "unavailable") {
    return errors.SERVICE_UNAVAILABLE === undefined
      ? defect(error)
      : errors.SERVICE_UNAVAILABLE({ data: { reason: error.reason } });
  }
  return errors.NOT_FOUND === undefined ? defect(error) : errors.NOT_FOUND();
}

/**
 * The service's value, or its error as the procedure's declared error: `Unavailable` ->
 * `SERVICE_UNAVAILABLE { reason }`, `NotFound` -> `NOT_FOUND`, `Unexpected` -> undeclared 500.
 * Every other error goes to `own`, which the type checker requires exactly when there is one.
 */
export function respond<T, E extends TaggedError>(
  result: Result<T, E>,
  errors: ErrorsFor<E>,
  ...own: OwnMapper<E>
): T;
export function respond<T>(
  result: Result<T, TaggedError>,
  errors: Partial<SharedErrorMap>,
  own?: (error: TaggedError) => ORPCError<string, unknown>,
): T {
  return orThrow(result, (error) => {
    const shared = SharedErrorSchema.safeParse(error);
    if (shared.success) return sharedError(errors, shared.data);
    return own === undefined ? defect(error) : own(error);
  });
}

const base = orpcOs.$context<Context>();

type Unauthorized = { readonly type: "unauthorized" };

/** The caller's session; an outage while checking it is `Unavailable`, never "signed out". */
function requireSession(context: Context): Result<RequestSession, Unauthorized | Unavailable> {
  if (context.sessionUnavailable !== null) {
    return err({ type: "unavailable", reason: context.sessionUnavailable });
  }
  return context.session === null ? err({ type: "unauthorized" }) : ok(context.session);
}

/** Requires any valid session (web cookie or scoped extension bearer token). */
export const authenticated = base
  .errors({ UNAUTHORIZED, SERVICE_UNAVAILABLE })
  .middleware(({ context, errors, next }) => {
    const session = orThrow(requireSession(context), (error) =>
      error.type === "unavailable"
        ? errors.SERVICE_UNAVAILABLE({ data: { reason: error.reason } })
        : errors.UNAUTHORIZED(),
    );
    return next({ context: { session, user: session.user } });
  });

/** Requires a first-party WorkOS web session (rejects scoped extension bearer tokens). */
export const webAuthenticated = base
  .errors({ UNAUTHORIZED, FORBIDDEN, SERVICE_UNAVAILABLE })
  .middleware(({ context, errors, next }) => {
    const session = orThrow(requireSession(context), (error) =>
      error.type === "unavailable"
        ? errors.SERVICE_UNAVAILABLE({ data: { reason: error.reason } })
        : errors.UNAUTHORIZED(),
    );
    const webSession = orThrow(
      session.kind === "web_session" ? ok(session) : err({ type: "web_session_required" }),
      (error) => errors.FORBIDDEN({ data: { reason: error.type } }),
    );
    return next({ context: { session: webSession, user: webSession.user } });
  });
