import { fromPromise, ok, type Result } from "@detour/result";
import { browser } from "wxt/browser";

export type OpenTab = {
  readonly id: number;
  readonly url: string;
};

export type TabsScriptingError = {
  readonly type: "tabs_scripting_failed";
  readonly operation: string;
  readonly cause: unknown;
};

/**
 * Queries open tabs whose URLs are visible to the extension.
 *
 * Without the broad `"tabs"` permission, both Chrome and Firefox populate `tab.url` only for
 * extension pages and tabs matching currently granted host permissions.
 */
export async function queryOpenTabs(): Promise<Result<readonly OpenTab[], TabsScriptingError>> {
  const queried = await fromPromise(
    () => browser.tabs.query({}),
    (cause): TabsScriptingError => ({
      type: "tabs_scripting_failed",
      operation: "tabs.query",
      cause,
    }),
  );
  if (!queried.ok) return queried;

  const tabs: OpenTab[] = [];
  for (const tab of queried.value) {
    if (typeof tab.id === "number" && typeof tab.url === "string") {
      tabs.push({ id: tab.id, url: tab.url });
    }
  }
  return ok(tabs);
}

/** Injects the on-demand Shadow DOM expiry overlay script into an open tab. */
export async function injectExpiryOverlay(
  tabId: number,
): Promise<Result<void, TabsScriptingError>> {
  const executed = await fromPromise(
    async () => {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ["/expiry-overlay.js"],
      });
    },
    (cause): TabsScriptingError => ({
      type: "tabs_scripting_failed",
      operation: "scripting.executeScript",
      cause,
    }),
  );
  if (!executed.ok) return executed;
  return ok(undefined);
}

/** Redirects an open tab to the local `blocked.html` gate page. */
export async function redirectTab(
  tabId: number,
  url: string,
): Promise<Result<void, TabsScriptingError>> {
  const updated = await fromPromise(
    async () => {
      await browser.tabs.update(tabId, { url });
    },
    (cause): TabsScriptingError => ({
      type: "tabs_scripting_failed",
      operation: "tabs.update",
      cause,
    }),
  );
  if (!updated.ok) return updated;
  return ok(undefined);
}
