import type { Result } from "@detour/result";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addSiteMutationFn,
  popupStatusQueryOptions,
  reconcileNowMutationFn,
  removeSiteMutationFn,
  setPausedMutationFn,
  type ExtensionApiError,
} from "../../lib/extension-api.ts";
import type { ExtensionStatus } from "../../lib/messages.ts";
import { requestDomainPermission, type PermissionsError } from "../../lib/permissions.adapter.ts";

type StatusResult = Result<ExtensionStatus, ExtensionApiError>;
type PermissionResult = Result<boolean, PermissionsError>;

/** Requests already sent for one domain, still being answered. */
export type PendingSiteRequests = {
  readonly domain: string;
  readonly permission: Promise<PermissionResult>;
};

export type PendingAddSite = PendingSiteRequests & {
  readonly added: Promise<StatusResult>;
};

/** What a host-access request and the status write that followed it came back with. */
export type SiteOutcome = {
  readonly domain: string;
  readonly granted: boolean;
  readonly status: StatusResult;
};

function storeStatus(queryClient: QueryClient, result: StatusResult): void {
  if (result.ok) queryClient.setQueryData(popupStatusQueryOptions.queryKey, result.value);
}

function wasGranted(permission: PermissionResult): boolean {
  return permission.ok && permission.value;
}

/**
 * Starts both requests synchronously, inside the click or submit that called it: the host
 * permission prompt needs the user gesture, and `add_site` is already sent if Firefox closes the
 * popup when its permission dialog opens.
 */
export function beginAddSite(domain: string): PendingAddSite {
  return {
    domain,
    permission: requestDomainPermission(domain),
    added: addSiteMutationFn(domain),
  };
}

/** Starts the host permission prompt inside the click that called it (the user gesture). */
export function beginRegrant(domain: string): PendingSiteRequests {
  return { domain, permission: requestDomainPermission(domain) };
}

export function usePopupStatus() {
  return useQuery(popupStatusQueryOptions);
}

export function useSetPaused() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setPausedMutationFn,
    onSuccess: (result) => storeStatus(queryClient, result),
  });
}

export function useAddSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pending: PendingAddSite): Promise<SiteOutcome> => {
      const [permission, status] = await Promise.all([pending.permission, pending.added]);
      return { domain: pending.domain, granted: wasGranted(permission), status };
    },
    onSuccess: (outcome) => storeStatus(queryClient, outcome.status),
  });
}

export function useRegrantSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pending: PendingSiteRequests): Promise<SiteOutcome> => {
      // Reconcile only once the prompt is answered, so the audit sees the new host access.
      const permission = await pending.permission;
      const status = await reconcileNowMutationFn();
      return { domain: pending.domain, granted: wasGranted(permission), status };
    },
    onSuccess: (outcome) => storeStatus(queryClient, outcome.status),
  });
}

export function useRemoveSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeSiteMutationFn,
    onSuccess: (result) => storeStatus(queryClient, result),
  });
}
