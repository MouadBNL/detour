import { err, fromPromise, ok, type Result } from "@detour/result";
import { browser } from "wxt/browser";
import { parseGuardState, type GuardState } from "./guard-state.ts";
import type { StorageAccessStatus } from "./messages.ts";

const GUARD_STATE_KEY = "detour:guard-state";

export type StorageError = {
  readonly type: "storage_failed";
  readonly cause: unknown;
};

type StorageAreaWithOptionalAccessLevel = {
  setAccessLevel?: (options: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void>;
};

/**
 * Restricts `storage.local` to trusted extension contexts (`TRUSTED_CONTEXTS`) when supported.
 *
 * Chrome 102+ supports `storage.local.setAccessLevel`; Firefox MV3 omits the method (Bug 1724754),
 * so feature detection returns `"unsupported"` instead of throwing a runtime `TypeError`.
 */
export async function ensureTrustedStorageAccess(): Promise<
  Result<StorageAccessStatus, StorageError>
> {
  const area: StorageAreaWithOptionalAccessLevel = browser.storage.local;
  const setAccessLevel = area.setAccessLevel;
  if (typeof setAccessLevel !== "function") {
    return ok("unsupported");
  }
  const applied = await fromPromise(
    () => setAccessLevel.call(browser.storage.local, { accessLevel: "TRUSTED_CONTEXTS" }),
    (cause): StorageError => ({ type: "storage_failed", cause }),
  );
  if (!applied.ok) return err(applied.error);
  return ok("enforced");
}

/** Reads the canonical guard state from extension local storage. */
export async function readGuardState(): Promise<Result<GuardState, StorageError>> {
  const stored = await fromPromise(
    () => browser.storage.local.get(GUARD_STATE_KEY),
    (cause): StorageError => ({ type: "storage_failed", cause }),
  );
  if (!stored.ok) return stored;
  return ok(parseGuardState(stored.value[GUARD_STATE_KEY]));
}

/** Persists the canonical guard state to extension local storage. */
export async function writeGuardState(
  state: GuardState,
): Promise<Result<GuardState, StorageError>> {
  const written = await fromPromise(
    () => browser.storage.local.set({ [GUARD_STATE_KEY]: state }),
    (cause): StorageError => ({ type: "storage_failed", cause }),
  );
  if (!written.ok) return err(written.error);
  return ok(state);
}
