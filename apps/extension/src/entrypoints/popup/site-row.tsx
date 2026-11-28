import { Button } from "@detour/ui";
import { AlertTriangle, Trash2 } from "lucide-react";
import { describeExtensionApiError } from "../../lib/extension-api.ts";
import type { GuardedSiteStatus } from "../../lib/messages.ts";
import {
  beginRegrant,
  useRegrantSite,
  useRemoveSite,
  type SiteOutcome,
} from "./use-popup-queries.ts";

function describeRegrant(outcome: SiteOutcome): string {
  if (!outcome.status.ok) {
    return `Could not refresh ${outcome.domain}. ${describeExtensionApiError(outcome.status.error)}`;
  }
  return outcome.granted
    ? `Restored host access for ${outcome.domain}.`
    : `Host access is still revoked for ${outcome.domain}.`;
}

type SiteRowProps = {
  site: GuardedSiteStatus;
};

/** One guarded site, with its own Re-grant and Remove actions. */
export function SiteRow({ site }: SiteRowProps) {
  const regrant = useRegrantSite();
  const remove = useRemoveSite();
  const removeError = remove.data?.ok === false ? remove.data.error : null;

  return (
    <li className="flex flex-col gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{site.domain}</span>
        <div className="flex items-center gap-1.5">
          {site.hostAccess === "revoked" ? (
            <Button
              size="sm"
              variant="secondary"
              pending={regrant.isPending}
              // The permission prompt starts here, inside the click, before anything is awaited.
              onClick={() => regrant.mutate(beginRegrant(site.domain))}
            >
              <AlertTriangle className="size-3.5 text-danger" aria-hidden="true" />
              Re-grant
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${site.domain}`}
            pending={remove.isPending}
            onClick={() => remove.mutate(site.domain)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {regrant.data === undefined ? null : (
        <output className="text-xs text-fg-muted">{describeRegrant(regrant.data)}</output>
      )}
      {removeError === null ? null : (
        <p role="alert" className="text-xs text-danger">
          Could not remove {site.domain}. {describeExtensionApiError(removeError)}
        </p>
      )}
    </li>
  );
}
