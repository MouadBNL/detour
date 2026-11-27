import { fromPromise, ok, type Result } from "@detour/result";
import { browser } from "wxt/browser";
import { domainToOriginPatterns, type GuardedSite } from "./guard-state.ts";

export type PermissionsError = {
  readonly type: "permissions_failed";
  readonly operation: string;
  readonly cause: unknown;
};

export type SitePermissionAudit = {
  readonly grantedDomains: readonly string[];
  readonly revokedDomains: readonly string[];
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

/** Audits every configured guarded site to detect granted vs. revoked host permissions. */
export async function auditSitePermissions(
  sites: readonly GuardedSite[],
): Promise<Result<SitePermissionAudit, PermissionsError>> {
  const grantedDomains: string[] = [];
  const revokedDomains: string[] = [];
  for (const site of sites) {
    const allowed = await hasDomainPermission(site.domain);
    if (!allowed.ok) return allowed;
    if (allowed.value) {
      grantedDomains.push(site.domain);
    } else {
      revokedDomains.push(site.domain);
    }
  }
  return ok({ grantedDomains, revokedDomains });
}
