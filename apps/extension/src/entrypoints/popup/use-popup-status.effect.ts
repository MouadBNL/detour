import { useEffect, useState } from "react";
import type { ExtensionStatus } from "../../lib/messages.ts";
import { sendExtensionMessage } from "../../lib/runtime.adapter.ts";

export type PopupStatusState = {
  readonly status: ExtensionStatus | null;
  readonly setStatus: (next: ExtensionStatus) => void;
  readonly loadError: string | null;
};

/** Loads initial extension status from the MV3 background worker when the popup mounts. */
export function usePopupStatus(): PopupStatusState {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void sendExtensionMessage({ type: "get_status" }).then((reply) => {
      if (!active) return;
      if (reply.ok && reply.value.ok && reply.value.type === "status") {
        setStatus(reply.value.status);
        setLoadError(null);
        return;
      }
      setLoadError("Could not reach Detour background worker.");
    });
    return () => {
      active = false;
    };
  }, []);

  return { status, setStatus, loadError };
}
