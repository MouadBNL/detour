import { err, ok, type Result } from "@detour/result";
import { enqueueBackground } from "./background-queue.ts";
import { MAX_REASON_LENGTH } from "./form-schemas.ts";
import {
  findMatchingGuardedSite,
  hostnameMatchesDomain,
  normalizeDomain,
  type ActiveGrant,
  type GuardState,
} from "./guard-state.ts";
import { isValidGrantDuration } from "./messages.ts";
import { removeDomainPermission } from "./permissions.adapter.ts";
import {
  commitGuardStep,
  runGuardStep,
  type ReconcileError,
  type ReconcileResult,
} from "./reconcile.ts";

const WRAPUP_MINUTES = 2;
const WRAPUP_REASON = "2-minute wrap-up";

type GrantResult = ReconcileResult & {
  readonly extra: { readonly domain: string; readonly expiresAtMs: number };
};

function installGrant(state: GuardState, grant: ActiveGrant): GuardState {
  return {
    ...state,
    grants: [...state.grants.filter((item) => item.domain !== grant.domain), grant],
    pendingSweepDomains: state.pendingSweepDomains.filter((domain) => domain !== grant.domain),
  };
}

/** Updates pause state and reconciles DNR rules in one serialized step. */
export async function setPausedState(
  paused: boolean,
  nowMs?: number,
): Promise<Result<ReconcileResult, ReconcileError>> {
  return runGuardStep({ nowMs }, (state) => ok({ state: { ...state, paused }, extra: null }));
}

/** Adds a normalized domain to the guarded list and reconciles DNR rules. */
export async function addGuardedSite(
  rawDomain: string,
  nowMs?: number,
): Promise<Result<ReconcileResult, ReconcileError>> {
  const normalized = normalizeDomain(rawDomain);
  if (!normalized.ok) return normalized;
  const domain = normalized.value;
  return runGuardStep({ nowMs }, (state) => {
    const exists = state.sites.some((site) => site.domain === domain);
    const sites = exists ? state.sites : [...state.sites, { domain }];
    return ok({ state: { ...state, sites }, extra: null });
  });
}

/**
 * Removes a domain from the guarded list (clearing its grants and pending sweeps), then releases
 * its host permission unless another guarded site still relies on overlapping patterns.
 */
export async function removeGuardedSite(
  rawDomain: string,
  nowMs?: number,
): Promise<Result<ReconcileResult, ReconcileError>> {
  const normalized = normalizeDomain(rawDomain);
  if (!normalized.ok) return normalized;
  const domain = normalized.value;
  return enqueueBackground(async () => {
    const committed = await commitGuardStep({ nowMs }, (state) =>
      ok({
        state: {
          ...state,
          sites: state.sites.filter((site) => site.domain !== domain),
          grants: state.grants.filter((grant) => grant.domain !== domain),
          pendingSweepDomains: state.pendingSweepDomains.filter((item) => item !== domain),
        },
        extra: null,
      }),
    );
    if (!committed.ok) return committed;
    const overlapping = committed.value.status.state.sites.some(
      (site) =>
        hostnameMatchesDomain(site.domain, domain) || hostnameMatchesDomain(domain, site.domain),
    );
    // Best effort: the permission may already be absent; site removal has succeeded either way.
    if (!overlapping) await removeDomainPermission(domain);
    return committed;
  });
}

/**
 * Grants a pass for the guarded site covering `input.domain` (`old.reddit.com` → `reddit.com`),
 * awaiting the DNR session allow rule before returning so `blocked.html` can navigate back.
 */
export async function grantDomainAccess(input: {
  readonly domain: string;
  readonly durationMinutes: number;
  readonly reason: string;
  readonly nowMs?: number;
}): Promise<Result<GrantResult, ReconcileError>> {
  const host = normalizeDomain(input.domain);
  if (!host.ok) return host;
  if (!isValidGrantDuration(input.durationMinutes)) {
    return err({ type: "invalid_duration", durationMinutes: input.durationMinutes });
  }
  const reason = input.reason.trim();
  if (reason.length > MAX_REASON_LENGTH) {
    return err({ type: "reason_too_long", maxLength: MAX_REASON_LENGTH });
  }
  const nowMs = input.nowMs ?? Date.now();
  const expiresAtMs = nowMs + Math.round(input.durationMinutes * 60_000);

  return runGuardStep({ nowMs }, (state) => {
    const site = findMatchingGuardedSite(host.value, state.sites);
    if (!site) return err({ type: "site_not_guarded", domain: host.value });
    const grant: ActiveGrant = {
      domain: site.domain,
      reason,
      grantedAtMs: nowMs,
      expiresAtMs,
    };
    return ok({ state: installGrant(state, grant), extra: { domain: site.domain, expiresAtMs } });
  });
}

/**
 * Grants the one-time 2-minute wrap-up for the guarded site covering `senderHost`. Requires an
 * expired pass for that site whose wrap-up is unused, and no active pass.
 */
export async function consumeWrapupGrant(
  senderHost: string,
  nowMs: number = Date.now(),
): Promise<Result<GrantResult, ReconcileError>> {
  const expiresAtMs = nowMs + WRAPUP_MINUTES * 60_000;
  return runGuardStep({ nowMs }, (state) => {
    const site = findMatchingGuardedSite(senderHost, state.sites);
    const entry = site ? state.lastExpired.find((item) => item.domain === site.domain) : undefined;
    const hasActive = state.grants.some(
      (grant) => grant.domain === site?.domain && grant.expiresAtMs > nowMs,
    );
    if (!site || !entry || entry.wrapupUsed || hasActive) {
      return err({ type: "wrapup_unavailable", domain: senderHost });
    }
    const marked: GuardState = {
      ...state,
      lastExpired: state.lastExpired.map((item) =>
        item === entry ? { ...item, wrapupUsed: true } : item,
      ),
    };
    const grant: ActiveGrant = {
      domain: site.domain,
      reason: WRAPUP_REASON,
      grantedAtMs: nowMs,
      expiresAtMs,
      wrapup: true,
    };
    return ok({ state: installGrant(marked, grant), extra: { domain: site.domain, expiresAtMs } });
  });
}
