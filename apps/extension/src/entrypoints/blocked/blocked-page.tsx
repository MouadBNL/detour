import { Clock } from "lucide-react";
import { parseBlockedTarget } from "../../lib/blocked-target.ts";
import { PassForm } from "./pass-form.tsx";

function isTopLevelWindow(): boolean {
  return typeof window === "undefined" || window.top === window;
}

function navigateTo(href: string): void {
  window.location.replace(href);
}

type BlockedPageProps = {
  search: string;
  onNavigate?: (href: string) => void;
  /** True when another page embeds this one; the pass form is then withheld (clickjacking). */
  isFramed?: boolean;
};

export function BlockedPage({
  search,
  onNavigate = navigateTo,
  isFramed = !isTopLevelWindow(),
}: BlockedPageProps) {
  const target = parseBlockedTarget(search);
  const heading = target.ok ? target.value.host : "Detour gate";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-canvas px-6 py-10 text-fg">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-fg-muted">
          <Clock className="size-4 text-accent" aria-hidden="true" />
          <span className="text-sm font-medium">Detour</span>
        </div>
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="text-sm text-fg-muted">
          {target.ok && !isFramed
            ? "How long do you need, and what are you here for?"
            : "This page intercepts guarded visits before they load."}
        </p>
      </header>

      {isFramed ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-fg">
          This page is shown inside another site, so Detour will not grant a pass here. Open the
          site directly in its own tab to request one.
        </p>
      ) : null}
      {!isFramed && target.ok ? <PassForm target={target.value} onNavigate={onNavigate} /> : null}
      {!isFramed && !target.ok ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-fg-muted">
          There is no valid site address to open from here. Visit a guarded site to request a pass.
        </p>
      ) : null}
    </main>
  );
}
