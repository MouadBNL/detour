import { Button } from "@detour/ui";
import { Pause, Play, Plus, Shield } from "lucide-react";
import { useState, type FormEvent } from "react";
import { normalizeDomain } from "../../lib/guard-state.ts";
import type { ExtensionMessage, ExtensionStatus } from "../../lib/messages.ts";
import { requestDomainPermission } from "../../lib/permissions.adapter.ts";
import { sendExtensionMessage } from "../../lib/runtime.adapter.ts";
import { SiteList } from "./site-list.tsx";
import { usePopupStatus } from "./use-popup-status.effect.ts";

async function sendStatusUpdate(message: ExtensionMessage): Promise<ExtensionStatus | null> {
  const reply = await sendExtensionMessage(message);
  if (!reply.ok || !reply.value.ok || reply.value.type !== "status") return null;
  return reply.value.status;
}

export function PopupApp() {
  const { status, setStatus, loadError } = usePopupStatus();
  const [domainInput, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const paused = status?.state.paused ?? false;

  async function handleTogglePause() {
    setBusy(true);
    setNote(null);
    const next = await sendStatusUpdate({ type: "set_paused", paused: !paused });
    setBusy(false);
    if (!next) {
      setNote("Could not save pause state.");
      return;
    }
    setStatus(next);
    setNote(next.state.paused ? "Detour is paused." : "Detour is active.");
  }

  async function handleAddSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeDomain(domainInput);
    if (!normalized.ok) {
      setNote("Enter a valid domain like example.com.");
      return;
    }
    setBusy(true);
    setNote(null);
    const granted = await requestDomainPermission(normalized.value);
    const next = await sendStatusUpdate({ type: "add_site", domain: normalized.value });
    setBusy(false);
    if (!next) {
      setNote("Could not save site.");
      return;
    }
    setStatus(next);
    setDomainInput("");
    setNote(
      granted.ok && granted.value
        ? `Guarding ${normalized.value}.`
        : `Added ${normalized.value}, but host access was not granted.`,
    );
  }

  async function handleRegrant(domain: string) {
    setBusy(true);
    setNote(null);
    const granted = await requestDomainPermission(domain);
    const next = await sendStatusUpdate({ type: "reconcile_now" });
    setBusy(false);
    if (next) setStatus(next);
    setNote(
      granted.ok && granted.value
        ? `Restored host access for ${domain}.`
        : `Host access is still revoked for ${domain}.`,
    );
  }

  async function handleRemoveSite(domain: string) {
    setBusy(true);
    setNote(null);
    const next = await sendStatusUpdate({ type: "remove_site", domain });
    setBusy(false);
    if (next) {
      setStatus(next);
      setNote(`Removed ${domain}.`);
    }
  }

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
      <Button
        variant={paused ? "primary" : "secondary"}
        pending={busy}
        onClick={() => void handleTogglePause()}
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {paused ? "Resume Detour" : "Pause Detour"}
      </Button>
      <form onSubmit={(event) => void handleAddSite(event)} className="flex gap-2">
        <label className="sr-only" htmlFor="detour-domain-input">
          Domain to guard
        </label>
        <input
          id="detour-domain-input"
          type="text"
          value={domainInput}
          onChange={(event) => setDomainInput(event.target.value)}
          placeholder="example.com"
          className="h-8 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg placeholder:text-fg-subtle"
        />
        <Button type="submit" size="sm" variant="primary" pending={busy}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </form>
      <SiteList
        sites={status?.state.sites ?? []}
        revokedDomains={status?.revokedDomains ?? []}
        onRegrant={(domain) => void handleRegrant(domain)}
        onRemove={(domain) => void handleRemoveSite(domain)}
      />
      {loadError ? <output className="text-xs text-danger">{loadError}</output> : null}
      {note ? <output className="text-xs text-fg-muted">{note}</output> : null}
    </main>
  );
}
