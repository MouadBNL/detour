import { err, fromPromise, ok, type Result } from "@detour/result";
import { browser, type Browser } from "wxt/browser";

export type DnrError = {
  readonly type: "dnr_failed";
  readonly operation: string;
  readonly cause: unknown;
};

/** Resolves the extension-internal URL for `blocked.html` (`chrome-extension://` or `moz-extension://`). */
export function getBlockedPageUrl(): string {
  return browser.runtime.getURL("/blocked.html");
}

/** Atomically replaces all extension dynamic DNR rules with `desiredRules`. */
export async function syncDynamicRules(
  desiredRules: readonly Browser.declarativeNetRequest.Rule[],
): Promise<Result<number, DnrError>> {
  const existing = await fromPromise(
    () => browser.declarativeNetRequest.getDynamicRules(),
    (cause): DnrError => ({ type: "dnr_failed", operation: "getDynamicRules", cause }),
  );
  if (!existing.ok) return existing;

  const removeRuleIds = existing.value.map((rule) => rule.id);
  const addRules = [...desiredRules];
  const updated = await fromPromise(
    () => browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }),
    (cause): DnrError => ({ type: "dnr_failed", operation: "updateDynamicRules", cause }),
  );
  if (!updated.ok) return err(updated.error);
  return ok(addRules.length);
}

/** Atomically replaces all extension session DNR rules with `desiredRules`. */
export async function syncSessionRules(
  desiredRules: readonly Browser.declarativeNetRequest.Rule[],
): Promise<Result<number, DnrError>> {
  const existing = await fromPromise(
    () => browser.declarativeNetRequest.getSessionRules(),
    (cause): DnrError => ({ type: "dnr_failed", operation: "getSessionRules", cause }),
  );
  if (!existing.ok) return existing;

  const removeRuleIds = existing.value.map((rule) => rule.id);
  const addRules = [...desiredRules];
  const updated = await fromPromise(
    () => browser.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules }),
    (cause): DnrError => ({ type: "dnr_failed", operation: "updateSessionRules", cause }),
  );
  if (!updated.ok) return err(updated.error);
  return ok(addRules.length);
}

/** Counts the extension's installed dynamic DNR rules without modifying them. */
export async function getDynamicRuleCount(): Promise<Result<number, DnrError>> {
  const existing = await fromPromise(
    () => browser.declarativeNetRequest.getDynamicRules(),
    (cause): DnrError => ({ type: "dnr_failed", operation: "getDynamicRules", cause }),
  );
  if (!existing.ok) return existing;
  return ok(existing.value.length);
}

/** Counts the extension's installed session DNR rules without modifying them. */
export async function getSessionRuleCount(): Promise<Result<number, DnrError>> {
  const existing = await fromPromise(
    () => browser.declarativeNetRequest.getSessionRules(),
    (cause): DnrError => ({ type: "dnr_failed", operation: "getSessionRules", cause }),
  );
  if (!existing.ok) return existing;
  return ok(existing.value.length);
}
