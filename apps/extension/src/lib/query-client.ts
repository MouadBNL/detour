import { QueryClient } from "@tanstack/react-query";

/** One QueryClient per extension page (popup, blocked page). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // A page lives only while it is open; the background worker is the source of truth, so a
      // stale read is refetched rather than trusted. One retry covers a worker that was waking up.
      queries: { staleTime: 0, retry: 1 },
    },
  });
}
