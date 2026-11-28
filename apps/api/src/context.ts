/**
 * What every procedure receives as oRPC context.
 *
 * `Deps` are the long-lived dependencies: `worker.ts` builds the
 * real ones, tests build their own (`src/testing/test-app.ts`). `createApp` resolves `session` per
 * request and hands `{ ...deps, session }` to the router.
 */
import type { Db } from "@detour/db";
import type { AuthUser, RequestSession, WebSession } from "./auth/types.ts";
import type { WebAuthProvider } from "./auth/workos.adapter.ts";
import type { UnavailableReason } from "./errors.ts";

export type Deps = {
  readonly lifecycle: Lifecycle;
  /** The one clock: code that needs the time takes it from here, so a test can pin it. */
  readonly now: () => Date;
  readonly db: Db;
  readonly webAuth: WebAuthProvider;
};

export type Context = Deps & {
  readonly session: RequestSession | null;
  /**
   * Set when the caller presented a credential that could not be checked (D1 or WorkOS did not
   * answer): procedures that need a session answer `SERVICE_UNAVAILABLE`, not `UNAUTHORIZED`.
   */
  readonly sessionUnavailable: UnavailableReason | null;
};

export type WebSignedInContext = Deps & {
  readonly session: WebSession;
  readonly user: AuthUser;
};

type Lifecycle = {
  /** True once the process received SIGTERM/SIGINT and is draining. */
  readonly isShuttingDown: () => boolean;
};
