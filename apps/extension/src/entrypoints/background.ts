import { defineBackground } from "wxt/utils/define-background";
import { RECONCILE_ALARM_NAME } from "../lib/alarms.adapter.ts";
import { handleBackgroundMessage } from "../lib/background-controller.ts";
import { reconcile } from "../lib/reconcile.ts";
import { registerBackgroundListeners } from "../lib/runtime.adapter.ts";

async function runReconcile(trigger: string): Promise<void> {
  const result = await reconcile();
  if (result.ok) {
    console.info(
      `Detour reconciled (${trigger}): dynamic=${String(result.value.status.dynamicRuleCount)} session=${String(result.value.status.sessionRuleCount)} storageAccess=${result.value.status.storageAccess}`,
    );
    return;
  }
  console.warn(`Detour reconcile failed (${trigger}): ${result.error.type}`);
}

export default defineBackground(() => {
  registerBackgroundListeners({
    onLifecycleTrigger: runReconcile,
    onAlarm: async (alarmName) => {
      if (alarmName !== RECONCILE_ALARM_NAME) return;
      await runReconcile(`alarm:${alarmName}`);
    },
    onMessage: handleBackgroundMessage,
  });

  void runReconcile("worker-init");
});
