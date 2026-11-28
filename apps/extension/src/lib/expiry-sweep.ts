import { ok, type Result } from "@detour/result";
import { buildBlockedRedirectUrl } from "./dnr-projection.ts";
import {
  extractWebHostname,
  hostnameMatchesDomain,
  type ActiveGrant,
  type ExpiredGrantContext,
  type GuardState,
} from "./guard-state.ts";
import type { ExpiredTabAction } from "./messages.ts";
import {
  injectExpiryOverlay,
  queryOpenTabs,
  redirectTab,
  type OpenTab,
  type TabsScriptingError,
} from "./tabs-scripting.adapter.ts";

const MAX_EXPIRED_HISTORY = 20;

export type SweepOutcome = {
  readonly sweptTabIds: readonly number[];
  readonly failedDomains: readonly string[];
};

function toExpiredContext(
  grant: ActiveGrant,
  previous: ExpiredGrantContext | undefined,
  nowMs: number,
): ExpiredGrantContext {
  // A wrap-up pass keeps the original pass context and leaves the wrap-up consumed.
  if (grant.wrapup === true && previous) {
    return { ...previous, expiredAtMs: nowMs, wrapupUsed: true };
  }
  return {
    domain: grant.domain,
    reason: grant.reason,
    durationMinutes: Math.max(1, Math.round((grant.expiresAtMs - grant.grantedAtMs) / 60_000)),
    expiredAtMs: nowMs,
    wrapupUsed: grant.wrapup === true,
  };
}

/** Prepends contexts for newly expired grants, replacing older entries for the same domain. */
export function mergeExpiredHistory(
  existing: readonly ExpiredGrantContext[],
  newlyExpired: readonly ActiveGrant[],
  nowMs: number,
): readonly ExpiredGrantContext[] {
  const fresh = newlyExpired.map((grant) =>
    toExpiredContext(
      grant,
      existing.find((item) => item.domain === grant.domain),
      nowMs,
    ),
  );
  const freshDomains = new Set(fresh.map((item) => item.domain));
  const retained = existing.filter((item) => !freshDomains.has(item.domain));
  return [...fresh, ...retained].slice(0, MAX_EXPIRED_HISTORY);
}

/** Pending sweeps: guarded domains, without an active grant, whose tabs still need gating. */
export function computePendingSweep(
  state: GuardState,
  additions: readonly string[],
): readonly string[] {
  if (state.paused) return [];
  const guarded = new Set(state.sites.map((site) => site.domain));
  const granted = new Set(state.grants.map((grant) => grant.domain));
  return [...new Set([...state.pendingSweepDomains, ...additions])].filter(
    (domain) => guarded.has(domain) && !granted.has(domain),
  );
}

async function gateTab(
  tab: OpenTab,
  blockedPageUrl: string,
  action: ExpiredTabAction,
): Promise<boolean> {
  if (action === "overlay") {
    const injected = await injectExpiryOverlay(tab.id);
    if (injected.ok) return true;
  }
  const redirected = await redirectTab(tab.id, buildBlockedRedirectUrl(blockedPageUrl, tab.url));
  return redirected.ok;
}

/**
 * Overlays (or redirects) every open tab on `domains`. A domain fails when any of its tabs could be
 * neither overlaid nor redirected; callers keep failed domains pending and retry.
 */
export async function sweepTabsForDomains(
  domains: readonly string[],
  blockedPageUrl: string,
  action: ExpiredTabAction,
): Promise<Result<SweepOutcome, TabsScriptingError>> {
  if (domains.length === 0) return ok({ sweptTabIds: [], failedDomains: [] });
  const openTabs = await queryOpenTabs();
  if (!openTabs.ok) return openTabs;

  const sweptTabIds: number[] = [];
  const failed = new Set<string>();
  for (const tab of openTabs.value) {
    const hostname = extractWebHostname(tab.url);
    if (!hostname) continue;
    const domain = domains.find((candidate) => hostnameMatchesDomain(hostname, candidate));
    if (domain === undefined) continue;
    if (await gateTab(tab, blockedPageUrl, action)) {
      sweptTabIds.push(tab.id);
    } else {
      failed.add(domain);
    }
  }
  return ok({ sweptTabIds, failedDomains: [...failed] });
}
