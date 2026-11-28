import type { Browser } from "wxt/browser";
import type { GuardState } from "./guard-state.ts";

export const DYNAMIC_BLOCK_RULE_BASE_ID = 1000;
export const SESSION_ALLOW_RULE_BASE_ID = 2000;
export const DYNAMIC_BLOCK_PRIORITY = 1;
export const SESSION_ALLOW_PRIORITY = 10;

/** Captures the full http/https navigation URL for DNR `regexSubstitution`. */
export const BLOCK_REGEX_FILTER = "^(https?://.+)$";

export type DnrProjection = {
  readonly dynamicRules: readonly Browser.declarativeNetRequest.Rule[];
  readonly sessionRules: readonly Browser.declarativeNetRequest.Rule[];
};

/** Builds a direct `blocked.html?url=...` link for fallback tab redirects. */
export function buildBlockedRedirectUrl(blockedPageUrl: string, targetUrl: string): string {
  return `${blockedPageUrl}?url=${encodeURIComponent(targetUrl)}`;
}

/**
 * Pure projection of stored `GuardState` into MV3 DNR `dynamic` block rules and higher-priority
 * `session` allow rules.
 *
 * - Dynamic redirect rules persist across browser restarts (fail closed) and use `requestDomains`
 *   plus `regexFilter`/`regexSubstitution` to preserve the target URL without `webNavigation`.
 * - Session allow rules override dynamic blocks (`priority: 10 > 1`) and auto-clear on restart.
 * - When `state.paused` is true, no dynamic block rules are projected.
 */
export function projectDnrRules(
  state: GuardState,
  blockedPageUrl: string,
  nowMs: number,
): DnrProjection {
  const dynamicRules: Browser.declarativeNetRequest.Rule[] = state.paused
    ? []
    : state.sites.map((site, index) => ({
        id: DYNAMIC_BLOCK_RULE_BASE_ID + index,
        priority: DYNAMIC_BLOCK_PRIORITY,
        action: {
          type: "redirect",
          redirect: {
            regexSubstitution: `${blockedPageUrl}?url=\\1`,
          },
        },
        condition: {
          requestDomains: [site.domain],
          regexFilter: BLOCK_REGEX_FILTER,
          resourceTypes: ["main_frame"],
        },
      }));

  const activeGrants = state.grants.filter((grant) => grant.expiresAtMs > nowMs);
  const sessionRules: Browser.declarativeNetRequest.Rule[] = activeGrants.map((grant, index) => ({
    id: SESSION_ALLOW_RULE_BASE_ID + index,
    priority: SESSION_ALLOW_PRIORITY,
    action: {
      type: "allow",
    },
    condition: {
      requestDomains: [grant.domain],
      resourceTypes: ["main_frame"],
    },
  }));

  return { dynamicRules, sessionRules };
}
