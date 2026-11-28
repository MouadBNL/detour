import type { GuardedSiteStatus } from "../../lib/messages.ts";
import { SiteRow } from "./site-row.tsx";

type SiteListProps = {
  sites: readonly GuardedSiteStatus[];
};

export function SiteList({ sites }: SiteListProps) {
  if (sites.length === 0) return null;
  return (
    <ul aria-label="Guarded sites" className="flex flex-col gap-1.5">
      {sites.map((site) => (
        <SiteRow key={site.domain} site={site} />
      ))}
    </ul>
  );
}
