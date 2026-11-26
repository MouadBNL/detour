import { err, fromPromise, ok, type Result } from "@detour/result";
import { browser } from "wxt/browser";

const PAUSED_KEY = "detour:paused";

export type StorageError = {
  readonly type: "storage_failed";
  readonly cause: unknown;
};

/** Reads whether Detour is currently paused from extension local storage. */
export async function readPausedState(): Promise<Result<boolean, StorageError>> {
  const stored = await fromPromise(
    () => browser.storage.local.get(PAUSED_KEY),
    (cause): StorageError => ({
      type: "storage_failed",
      cause,
    }),
  );
  if (!stored.ok) return stored;
  const value = stored.value[PAUSED_KEY];
  return ok(typeof value === "boolean" ? value : false);
}

/** Persists whether Detour is currently paused in extension local storage. */
export async function writePausedState(paused: boolean): Promise<Result<boolean, StorageError>> {
  const written = await fromPromise(
    () => browser.storage.local.set({ [PAUSED_KEY]: paused }),
    (cause): StorageError => ({ type: "storage_failed", cause }),
  );
  if (!written.ok) return err(written.error);
  return ok(paused);
}
