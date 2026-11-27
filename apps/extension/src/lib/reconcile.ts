import { ok, type Result } from "@detour/result";
import { syncReconcileAlarm, type AlarmError } from "./alarms.adapter.ts";
import { buildBlockedRedirectUrl, projectDnrRules } from "./dnr-projection.ts";
import {
  getBlockedPageUrl,
  syncDynamicRules,
  syncSessionRules,
  type DnrError,
} from "./dnr.adapter.ts";
import {
  extractWebHostname,
  hostnameMatchesDomain,
  nextExpiryMs,
  normalizeDomain,
  partitionGrants,
  type ActiveGrant,
  type DomainError,
  type ExpiredGrantContext,
  type GuardState,
} from "./guard-state.ts";
import type { ExpiredTabAction, ExtensionStatus } from "./messages.ts";
import { auditSitePermissions, type PermissionsError } from "./permissions.adapter.ts";
import {
  ensureTrustedStorageAccess,
  readGuardState,
  writeGuardState,
  type StorageError,
} from "./storage.adapter.ts";
import {
  injectExpiryOverlay,
  queryOpenTabs,
  redirectTab,
  type TabsScriptingError,
} from "./tabs-scripting.adapter.ts";

export type ReconcileError =
  | StorageError
  | DnrError
  | PermissionsError
  | AlarmError
  | TabsScriptingError
  | DomainError;

export type ReconcileOptions = {
  readonly nowMs?: number | undefined;
  readonly expiredAction?: ExpiredTabAction | undefined;
  readonly sweepDomains?: readonly string[] | undefined;
};

export type ReconcileResult = {
  readonly status: ExtensionStatus;
  readonly expiredDomains: readonly string[];
  readonly sweptTabIds: readonly number[];
};

const MAX_EXPIRED_HISTORY = 20;

function mergeExpiredHistory(
  existing: readonly ExpiredGrantContext[],
  newlyExpired: readonly ActiveGrant[],
  nowMs: number,
): readonly ExpiredGrantContext[] {
  const fresh: ExpiredGrantContext[] = newlyExpired.map((grant) => ({
    domain: grant.domain,
    reason: grant.reason,
    durationMinutes: Math.max(1, Math.round((grant.expiresAtMs - grant.grantedAtMs) / 60_000)),
    expiredAtMs: nowMs,
  }));
  const freshDomains = new Set(fresh.map((item) => item.domain));
  const retained = existing.filter((item) => !freshDomains.has(item.domain));
  return [...fresh, ...retained].slice(0, MAX_EXPIRED_HISTORY);
}

async function sweepTabsForDomains(
  domains: readonly string[],
  blockedPageUrl: string,
  action: ExpiredTabAction,
): Promise<Result<readonly number[], TabsScriptingError>> {
  if (domains.length === 0) return ok([]);
  const openTabs = await queryOpenTabs();
  if (!openTabs.ok) return openTabs;

  const sweptTabIds: number[] = [];
  for (const tab of openTabs.value) {
    const hostname = extractWebHostname(tab.url);
    if (!hostname) continue;
    const matched = domains.some((domain) => hostnameMatchesDomain(hostname, domain));
    if (!matched) continue;

    if (action === "overlay") {
      const injected = await injectExpiryOverlay(tab.id);
      if (injected.ok) {
        sweptTabIds.push(tab.id);
        continue;
      }
    }
    const redirected = await redirectTab(tab.id, buildBlockedRedirectUrl(blockedPageUrl, tab.url));
    if (redirected.ok) {
      sweptTabIds.push(tab.id);
    }
  }
  return ok(sweptTabIds);
}

/**
 * Idempotently reconciles stored state into DNR dynamic/session rules, expiry alarms, storage
 * access isolation, permission audits, and open-tab sweeps for expired grants.
 */
export async function reconcile(
  options: ReconcileOptions = {},
): Promise<Result<ReconcileResult, ReconcileError>> {
  const nowMs = options.nowMs ?? Date.now();
  const expiredAction = options.expiredAction ?? "overlay";

  const storageAccess = await ensureTrustedStorageAccess();
  if (!storageAccess.ok) return storageAccess;

  const stored = await readGuardState();
  if (!stored.ok) return stored;

  const { active, expired } = partitionGrants(stored.value.grants, nowMs);
  let state: GuardState = stored.value;
  if (expired.length > 0) {
    const nextState: GuardState = {
      ...stored.value,
      grants: active,
      lastExpired: mergeExpiredHistory(stored.value.lastExpired, expired, nowMs),
    };
    const persisted = await writeGuardState(nextState);
    if (!persisted.ok) return persisted;
    state = persisted.value;
  }

  const permissionAudit = await auditSitePermissions(state.sites);
  if (!permissionAudit.ok) return permissionAudit;

  const blockedPageUrl = getBlockedPageUrl();
  const projection = projectDnrRules(state, blockedPageUrl, nowMs);

  const dynamicRuleCount = await syncDynamicRules(projection.dynamicRules);
  if (!dynamicRuleCount.ok) return dynamicRuleCount;

  const sessionRuleCount = await syncSessionRules(projection.sessionRules);
  if (!sessionRuleCount.ok) return sessionRuleCount;

  const nextAlarmAtMs = await syncReconcileAlarm(nextExpiryMs(state.grants, nowMs));
  if (!nextAlarmAtMs.ok) return nextAlarmAtMs;

  const expiredDomains = expired.map((grant) => grant.domain);
  const domainsToSweep = state.paused
    ? []
    : [...new Set([...expiredDomains, ...(options.sweepDomains ?? [])])];

  const sweptTabIds = await sweepTabsForDomains(domainsToSweep, blockedPageUrl, expiredAction);
  if (!sweptTabIds.ok) return sweptTabIds;

  return ok({
    status: {
      state,
      grantedDomains: permissionAudit.value.grantedDomains,
      revokedDomains: permissionAudit.value.revokedDomains,
      storageAccess: storageAccess.value,
      dynamicRuleCount: dynamicRuleCount.value,
      sessionRuleCount: sessionRuleCount.value,
      nextAlarmAtMs: nextAlarmAtMs.value,
    },
    expiredDomains,
    sweptTabIds: sweptTabIds.value,
  });
}

/** Updates pause state and reconciles DNR rules immediately. */
export async function setPausedState(
  paused: boolean,
  nowMs?: number,
): Promise<Result<ReconcileResult, ReconcileError>> {
  const stored = await readGuardState();
  if (!stored.ok) return stored;
  const written = await writeGuardState({ ...stored.value, paused });
  if (!written.ok) return written;
  return reconcile({ nowMs });
}

/** Adds a normalized domain to the guarded list and reconciles DNR rules. */
export async function addGuardedSite(
  rawDomain: string,
  nowMs?: number,
): Promise<Result<ReconcileResult, ReconcileError>> {
  const normalized = normalizeDomain(rawDomain);
  if (!normalized.ok) return normalized;

  const stored = await readGuardState();
  if (!stored.ok) return stored;

  const exists = stored.value.sites.some((site) => site.domain === normalized.value);
  const sites = exists ? stored.value.sites : [...stored.value.sites, { domain: normalized.value }];
  const written = await writeGuardState({ ...stored.value, sites });
  if (!written.ok) return written;
  return reconcile({ nowMs });
}

/** Removes a domain from the guarded list and clears any active grant for it. */
export async function removeGuardedSite(
  rawDomain: string,
  nowMs?: number,
): Promise<Result<ReconcileResult, ReconcileError>> {
  const normalized = normalizeDomain(rawDomain);
  if (!normalized.ok) return normalized;

  const stored = await readGuardState();
  if (!stored.ok) return stored;

  const nextState: GuardState = {
    ...stored.value,
    sites: stored.value.sites.filter((site) => site.domain !== normalized.value),
    grants: stored.value.grants.filter((grant) => grant.domain !== normalized.value),
  };
  const written = await writeGuardState(nextState);
  if (!written.ok) return written;
  return reconcile({ nowMs });
}

/**
 * Persists an active grant and awaits DNR session allow-rule installation before returning,
 * preventing redirect loops when `blocked.html` navigates back to the target URL.
 */
export async function grantDomainAccess(input: {
  readonly domain: string;
  readonly durationMinutes: number;
  readonly reason: string;
  readonly nowMs?: number;
}): Promise<Result<ReconcileResult & { readonly expiresAtMs: number }, ReconcileError>> {
  const normalized = normalizeDomain(input.domain);
  if (!normalized.ok) return normalized;

  const nowMs = input.nowMs ?? Date.now();
  const clampedMinutes = Math.max(0.1, Math.min(240, input.durationMinutes));
  const expiresAtMs = nowMs + Math.round(clampedMinutes * 60_000);

  const stored = await readGuardState();
  if (!stored.ok) return stored;

  const remainingGrants = stored.value.grants.filter((grant) => grant.domain !== normalized.value);
  const nextGrant: ActiveGrant = {
    domain: normalized.value,
    reason: input.reason.trim(),
    grantedAtMs: nowMs,
    expiresAtMs,
  };
  const written = await writeGuardState({
    ...stored.value,
    grants: [...remainingGrants, nextGrant],
  });
  if (!written.ok) return written;

  const reconciled = await reconcile({ nowMs });
  if (!reconciled.ok) return reconciled;
  return ok({ ...reconciled.value, expiresAtMs });
}
