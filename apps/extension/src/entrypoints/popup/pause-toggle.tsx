import { Button } from "@detour/ui";
import { Pause, Play } from "lucide-react";
import { describeExtensionApiError } from "../../lib/extension-api.ts";
import { useSetPaused } from "./use-popup-queries.ts";

type PauseToggleProps = {
  paused: boolean;
};

export function PauseToggle({ paused }: PauseToggleProps) {
  const setPaused = useSetPaused();
  const result = setPaused.data;

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant={paused ? "primary" : "secondary"}
        pending={setPaused.isPending}
        onClick={() => setPaused.mutate(!paused)}
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {paused ? "Resume Detour" : "Pause Detour"}
      </Button>
      {result?.ok === true ? (
        <output className="text-xs text-fg-muted">
          {result.value.state.paused ? "Detour is paused." : "Detour is active."}
        </output>
      ) : null}
      {result?.ok === false ? (
        <p role="alert" className="text-xs text-danger">
          Could not save pause state. {describeExtensionApiError(result.error)}
        </p>
      ) : null}
    </div>
  );
}
