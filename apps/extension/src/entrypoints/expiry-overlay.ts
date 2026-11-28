import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { mountExpiryOverlay } from "../lib/expiry-overlay-dom.ts";
import { sendExtensionMessage } from "../lib/runtime.adapter.ts";

export default defineUnlistedScript(() => {
  void sendExtensionMessage({ type: "get_expiry_context" }).then((reply) => {
    const context =
      reply.ok && reply.value.ok && reply.value.type === "expiry_context"
        ? reply.value.context
        : null;
    mountExpiryOverlay(context, sendExtensionMessage);
  });
});
