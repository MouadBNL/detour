/**
 * The errors every service shares, declared once. A service returns them; the router maps them
 * all with `respond` (`orpc/procedures.ts`) and maps only its own errors by hand.
 *
 *   if (lifecycle.isShuttingDown()) return unavailable("shutting_down");
 */
import type { UNAVAILABLE_REASONS } from "@detour/contracts";
import { err, type Err } from "@detour/result";

export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** The server cannot serve right now, and saying why is safe (the contract's `SERVICE_UNAVAILABLE`). */
export type Unavailable = { readonly type: "unavailable"; readonly reason: UnavailableReason };

/** A value the code did not expect (an unmapped constraint, an insert with no row): a bug. */
export type Unexpected = { readonly type: "unexpected"; readonly detail: string };

/** The requested resource does not exist or is not visible to the caller (the contract's `NOT_FOUND`). */
export type NotFound = { readonly type: "not_found" };

/** The errors `respond` maps for every procedure. */
export type SharedError = Unavailable | Unexpected | NotFound;

export const unavailable = (reason: UnavailableReason): Err<Unavailable> =>
  err({ type: "unavailable", reason });

export const unexpected = (detail: string): Err<Unexpected> => err({ type: "unexpected", detail });

export const notFound = (): Err<NotFound> => err({ type: "not_found" });
