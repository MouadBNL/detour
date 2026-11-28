import { err, fromPromise, type Result } from "@detour/result";
import { queryOptions } from "@tanstack/react-query";
import { failureOf } from "../../../lib/api-failure.ts";
import { api } from "../../../lib/orpc.ts";
import { unwrapForQuery } from "../../../lib/query.adapter.ts";
import type { DecisionFailure, LookupFailure, ViewerFailure } from "../model/pairing.ts";

export type Viewer = Awaited<ReturnType<typeof api.auth.me>>;
export type PairingLookup = Awaited<ReturnType<typeof api.pairing.lookup>>;

export const viewerQuery = queryOptions<
  Viewer | null,
  Exclude<ViewerFailure, { type: "unauthorized" }>
>({
  queryKey: ["auth", "me"],
  queryFn: async () => {
    const result = await fromPromise(() => api.auth.me(), failureOf("auth.me"));
    if (!result.ok && result.error.type === "unauthorized") return null;
    if (!result.ok) return unwrapForQuery(err(result.error));
    return result.value;
  },
  staleTime: 10_000,
  retry: false,
});

export function pairingLookupQuery(userCode: string) {
  return queryOptions<PairingLookup, LookupFailure>({
    queryKey: ["pairing", "lookup", userCode],
    queryFn: async () =>
      unwrapForQuery(
        await fromPromise(() => api.pairing.lookup({ userCode }), failureOf("pairing.lookup")),
      ),
    retry: false,
  });
}

export async function approvePairingRequest(
  userCode: string,
): Promise<Result<{ readonly status: "approved" | "denied" }, DecisionFailure>> {
  return fromPromise(() => api.pairing.approve({ userCode }), failureOf("pairing.approve"));
}

export async function denyPairingRequest(
  userCode: string,
): Promise<Result<{ readonly status: "approved" | "denied" }, DecisionFailure>> {
  return fromPromise(() => api.pairing.deny({ userCode }), failureOf("pairing.deny"));
}

export function buildWorkosSignInUrl(userCode: string): string {
  const returnTo = userCode.length > 0 ? `/pair?code=${encodeURIComponent(userCode)}` : "/pair";
  return `/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}
