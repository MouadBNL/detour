import type { Result, TaggedError } from "@detour/result";

/**
 * TanStack Query learns about a failed fetch only when the `queryFn` throws; it then stores the
 * error and exposes it as a value (`query.error`). This is the one place that turns our `Result`
 * into that throw: the value, or the error thrown for the query to record.
 *
 *   queryFn: async () => unwrapForQuery(await fetchExtensionStatus())
 */
export function unwrapForQuery<T>(result: Result<T, TaggedError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}
