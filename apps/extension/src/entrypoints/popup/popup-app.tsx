import { Skeleton } from "@detour/ui";
import { Shield } from "lucide-react";
import { describeExtensionApiError } from "../../lib/extension-api.ts";
import { AddSiteForm } from "./add-site-form.tsx";
import { PauseToggle } from "./pause-toggle.tsx";
import { SiteList } from "./site-list.tsx";
import { usePopupStatus } from "./use-popup-queries.ts";

export function PopupApp() {
  const { data: status, error, isPending } = usePopupStatus();
  const paused = status?.state.paused ?? false;

  return (
    <main className="flex w-80 flex-col gap-3 bg-canvas p-4 text-fg">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-accent" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Detour</h1>
        </div>
        {status ? (
          <span className="text-xs text-fg-subtle">
            {status.dynamicRuleCount} rules · {status.storageAccess}
          </span>
        ) : null}
      </header>
      <p className="text-sm text-fg-muted">
        {paused
          ? "Interceptions are paused for now."
          : "Active on your guarded sites. Take a breath before you detour."}
      </p>
      {isPending ? (
        <>
          <p className="sr-only">Loading Detour status…</p>
          <Skeleton className="h-8 w-full" />
        </>
      ) : null}
      {status ? <PauseToggle paused={paused} /> : null}
      <AddSiteForm />
      {status ? <SiteList sites={status.sites} /> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          Could not load Detour status. {describeExtensionApiError(error)}
        </p>
      ) : null}
    </main>
  );
}
