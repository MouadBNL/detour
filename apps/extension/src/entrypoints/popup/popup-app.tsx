import { Button } from "@detour/ui";
import { Pause, Play, Shield } from "lucide-react";
import { useState } from "react";
import { writePausedState } from "../../lib/storage.adapter.ts";

export function PopupApp() {
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  async function handleTogglePause() {
    setSaving(true);
    setStatusNote(null);
    const nextPaused = !paused;
    const result = await writePausedState(nextPaused);
    setSaving(false);
    if (!result.ok) {
      setStatusNote("Could not save pause state.");
      return;
    }
    setPaused(result.value);
    setStatusNote(result.value ? "Detour is paused." : "Detour is active.");
  }

  return (
    <main className="flex w-72 flex-col gap-3 bg-canvas p-4 text-fg">
      <header className="flex items-center gap-2">
        <Shield className="size-4 text-accent" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Detour</h1>
      </header>
      <p className="text-sm text-fg-muted">
        {paused
          ? "Interceptions are paused for now."
          : "Active on your guarded sites. Take a breath before you detour."}
      </p>
      <Button
        variant={paused ? "primary" : "secondary"}
        pending={saving}
        onClick={() => void handleTogglePause()}
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {paused ? "Resume Detour" : "Pause Detour"}
      </Button>
      {statusNote ? <output className="text-xs text-fg-muted">{statusNote}</output> : null}
    </main>
  );
}
