import { ok, type Result } from "@detour/result";
import { getReconcileAlarmWhenMs, syncReconcileAlarm, type AlarmError } from "./alarms.adapter.ts";
import { enqueueBackground } from "./background-queue.ts";
import { projectDnrRules } from "./dnr-projection.ts";
import {
  getBlockedPageUrl,
  getDynamicRuleCount,
  getSessionRuleCount,
  syncDynamicRules,
  syncSessionRules,
  type DnrError,
} from "./dnr.adapter.ts";
import { computePendingSweep, mergeExpiredHistory, sweepTabsForDomains } from "./expiry-sweep.ts";
import { nextExpiryMs, partitionGrants, type DomainError, type GuardState } from "./guard-state.ts";
import type { ExpiredTabAction, ExtensionStatus } from "./messages.ts";
import { auditSitePermissions, type PermissionsError } from "./permissions.adapter.ts";
import {
  ensureTrustedStorageAccess,
  readGuardState,
  writeGuardState,
  type StorageError,
} from "./storage.adapter.ts";
import type { TabsScriptingError } from "./tabs-scripting.adapter.ts";

export type ReconcileError =
  | StorageError
  | DnrError
  | PermissionsError
  | AlarmError
  | TabsScriptingError
  | DomainError
  | { readonly type: "site_not_guarded"; readonly domain: string }
  | { readonly type: "wrapup_unavailable"; readonly domain: string }
  | { readonly type: "invalid_duration"; readonly durationMinutes: number }
  | { readonly type: "reason_too_long"; readonly maxLength: number };

export type ReconcileOptions = {
  readonly nowMs?: number | undefined;
  readonly expiredAction?: ExpiredTabAction | undefined;
};

export type ReconcileResult = {
  readonly status: ExtensionStatus;
  readonly expiredDomains: readonly string[];
  readonly sweptTabIds: readonly number[];
};

/** A state transform plus a value the caller wants back once the state is committed. */
export type GuardStep<X> = { readonly state: GuardState; readonly extra: X };

const RETRY_DELAY_MS = 30_000;

async function scheduleRetry(nowMs: number): Promise<void> {
  // Best effort: if even the alarm fails, the next lifecycle event or message reconciles again.
  await syncReconcileAlarm(nowMs + RETRY_DELAY_MS);
}

function prepareNextState(base: GuardState, nowMs: number) {
  const { active, expired } = partitionGrants(base.grants, nowMs);
  const expiredDomains = expired.map((grant) => grant.domain);
  const withGrants: GuardState = {
    ...base,
    grants: active,
    lastExpired:
      expired.length > 0 ? mergeExpiredHistory(base.lastExpired, expired, nowMs) : base.lastExpired,
  };
  const state: GuardState = {
    ...withGrants,
    pendingSweepDomains: computePendingSweep(withGrants, expiredDomains),
  };
  return { state, expiredDomains };
}

async function sweepPending(
  state: GuardState,
  blockedPageUrl: string,
  action: ExpiredTabAction,
): Promise<
  Result<
    { readonly state: GuardState; readonly sweptTabIds: readonly number[] },
    TabsScriptingError | StorageError
  >
> {
  const swept = await sweepTabsForDomains(state.pendingSweepDomains, blockedPageUrl, action);
  if (!swept.ok) return swept;
  const { failedDomains, sweptTabIds } = swept.value;
  if (failedDomains.length === state.pendingSweepDomains.length) {
    return ok({ state, sweptTabIds });
  }
  const persisted = await writeGuardState({ ...state, pendingSweepDomains: failedDomains });
  if (!persisted.ok) return persisted;
  return ok({ state: persisted.value, sweptTabIds });
}

function alarmTarget(state: GuardState, nowMs: number): number | null {
  const expiry = nextExpiryMs(state.grants, nowMs);
  if (state.pendingSweepDomains.length === 0) return expiry;
  const retryAt = nowMs + RETRY_DELAY_MS;
  return expiry === null ? retryAt : Math.min(expiry, retryAt);
}

/**
 * Commits `base` in one step: expires grants, syncs DNR rules first (storage is left untouched on
 * failure so expired grants are retried), persists, sweeps pending tabs, and syncs the alarm.
 * Callers must run inside `enqueueBackground`.
 */
async function commitGuardState(
  base: GuardState,
  options: ReconcileOptions,
): Promise<Result<ReconcileResult, ReconcileError>> {
  const nowMs = options.nowMs ?? Date.now();
  const storageAccess = await ensureTrustedStorageAccess();
  if (!storageAccess.ok) return storageAccess;

  const { state, expiredDomains } = prepareNextState(base, nowMs);
  const blockedPageUrl = getBlockedPageUrl();
  const projection = projectDnrRules(state, blockedPageUrl, nowMs);

  const dynamicRuleCount = await syncDynamicRules(projection.dynamicRules);
  if (!dynamicRuleCount.ok) {
    await scheduleRetry(nowMs);
    return dynamicRuleCount;
  }
  const sessionRuleCount = await syncSessionRules(projection.sessionRules);
  if (!sessionRuleCount.ok) {
    await scheduleRetry(nowMs);
    return sessionRuleCount;
  }
  const persisted = await writeGuardState(state);
  if (!persisted.ok) {
    await scheduleRetry(nowMs);
    return persisted;
  }

  const swept = await sweepPending(state, blockedPageUrl, options.expiredAction ?? "overlay");
  if (!swept.ok) {
    await scheduleRetry(nowMs);
    return swept;
  }
  const finalState = swept.value.state;

  const nextAlarmAtMs = await syncReconcileAlarm(alarmTarget(finalState, nowMs));
  if (!nextAlarmAtMs.ok) return nextAlarmAtMs;

  const sites = await auditSitePermissions(finalState.sites);
  if (!sites.ok) return sites;

  return ok({
    status: {
      state: finalState,
      sites: sites.value,
      storageAccess: storageAccess.value,
      dynamicRuleCount: dynamicRuleCount.value,
      sessionRuleCount: sessionRuleCount.value,
      nextAlarmAtMs: nextAlarmAtMs.value,
    },
    expiredDomains,
    sweptTabIds: swept.value.sweptTabIds,
  });
}

/** Reads, transforms and commits guard state without enqueueing (caller holds the queue). */
export async function commitGuardStep<X>(
  options: ReconcileOptions,
  transform: (state: GuardState) => Result<GuardStep<X>, ReconcileError>,
): Promise<Result<ReconcileResult & { readonly extra: X }, ReconcileError>> {
  const stored = await readGuardState();
  if (!stored.ok) return stored;
  const step = transform(stored.value);
  if (!step.ok) return step;
  const committed = await commitGuardState(step.value.state, options);
  if (!committed.ok) return committed;
  return ok({ ...committed.value, extra: step.value.extra });
}

/** Runs one serialized read → transform → DNR sync → persist → sweep → alarm step. */
export function runGuardStep<X>(
  options: ReconcileOptions,
  transform: (state: GuardState) => Result<GuardStep<X>, ReconcileError>,
): Promise<Result<ReconcileResult & { readonly extra: X }, ReconcileError>> {
  return enqueueBackground(() => commitGuardStep(options, transform));
}

/**
 * Idempotently reconciles stored state into DNR dynamic/session rules, the expiry alarm, and
 * open-tab sweeps for expired grants (retrying sweeps that failed earlier).
 */
export async function reconcile(
  options: ReconcileOptions = {},
): Promise<Result<ReconcileResult, ReconcileError>> {
  return runGuardStep(options, (state) => ok({ state, extra: null }));
}

/** Reports current status strictly read-only: no storage writes, DNR updates, or tab sweeps. */
export async function readExtensionStatus(): Promise<Result<ExtensionStatus, ReconcileError>> {
  return enqueueBackground(async (): Promise<Result<ExtensionStatus, ReconcileError>> => {
    const storageAccess = await ensureTrustedStorageAccess();
    if (!storageAccess.ok) return storageAccess;
    const state = await readGuardState();
    if (!state.ok) return state;
    const sites = await auditSitePermissions(state.value.sites);
    if (!sites.ok) return sites;
    const dynamicRuleCount = await getDynamicRuleCount();
    if (!dynamicRuleCount.ok) return dynamicRuleCount;
    const sessionRuleCount = await getSessionRuleCount();
    if (!sessionRuleCount.ok) return sessionRuleCount;
    const nextAlarmAtMs = await getReconcileAlarmWhenMs();
    if (!nextAlarmAtMs.ok) return nextAlarmAtMs;
    return ok({
      state: state.value,
      sites: sites.value,
      storageAccess: storageAccess.value,
      dynamicRuleCount: dynamicRuleCount.value,
      sessionRuleCount: sessionRuleCount.value,
      nextAlarmAtMs: nextAlarmAtMs.value,
    });
  });
}
