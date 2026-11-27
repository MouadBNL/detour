import { Button } from "@detour/ui";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { GuardedSite } from "../../lib/guard-state.ts";

type SiteListProps = {
  sites: readonly GuardedSite[];
  revokedDomains: readonly string[];
  onRegrant: (domain: string) => void;
  onRemove: (domain: string) => void;
};

export function SiteList({ sites, revokedDomains, onRegrant, onRemove }: SiteListProps) {
  if (sites.length === 0) return null;
  const revokedSet = new Set(revokedDomains);

  return (
    <ul className="flex flex-col gap-1.5">
      {sites.map((site) => {
        const revoked = revokedSet.has(site.domain);
        return (
          <li
            key={site.domain}
            className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm"
          >
            <span className="truncate font-medium">{site.domain}</span>
            <div className="flex items-center gap-1.5">
              {revoked ? (
                <Button size="sm" variant="secondary" onClick={() => onRegrant(site.domain)}>
                  <AlertTriangle className="size-3.5 text-danger" aria-hidden="true" />
                  Re-grant
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${site.domain}`}
                onClick={() => onRemove(site.domain)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
