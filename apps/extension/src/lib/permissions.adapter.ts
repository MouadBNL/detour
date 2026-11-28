import { fromPromise, ok, type Result } from "@detour/result";
import { browser } from "wxt/browser";
import { domainToOriginPatterns, type GuardedSite } from "./guard-state.ts";
import type { GuardedSiteStatus } from "./messages.ts";

export type PermissionsError = {
  readonly type: "permissions_failed";
  readonly operation: string;
  readonly cause: unknown;
};

/** Checks whether the extension currently holds optional host permissions for `domain`. */
export async function hasDomainPermission(
  domain: string,
): Promise<Result<boolean, PermissionsError>> {
  const origins = [...domainToOriginPatterns(domain)];
  return fromPromise(
    () => browser.permissions.contains({ origins }),
    (cause): PermissionsError => ({ type: "permissions_failed", operation: "contains", cause }),
  );
}

/** Requests optional host permissions for `domain` (must be called from a user gesture). */
export async function requestDomainPermission(
  domain: string,
): Promise<Result<boolean, PermissionsError>> {
  const origins = [...domainToOriginPatterns(domain)];
  return fromPromise(
    () => browser.permissions.request({ origins }),
    (cause): PermissionsError => ({ type: "permissions_failed", operation: "request", cause }),
  );
}

/** Releases optional host permissions for `domain`; resolves `false` when none were held. */
export async function removeDomainPermission(
  domain: string,
): Promise<Result<boolean, PermissionsError>> {
  const origins = [...domainToOriginPatterns(domain)];
  return fromPromise(
    () => browser.permissions.remove({ origins }),
    (cause): PermissionsError => ({ type: "permissions_failed", operation: "remove", cause }),
  );
}

/** Audits every configured guarded site to detect granted vs. revoked host permissions. */
export async function auditSitePermissions(
  sites: readonly GuardedSite[],
): Promise<Result<readonly GuardedSiteStatus[], PermissionsError>> {
  const statuses: GuardedSiteStatus[] = [];
  for (const site of sites) {
    const allowed = await hasDomainPermission(site.domain);
    if (!allowed.ok) return allowed;
    statuses.push({ domain: site.domain, hostAccess: allowed.value ? "granted" : "revoked" });
  }
  return ok(statuses);
}
