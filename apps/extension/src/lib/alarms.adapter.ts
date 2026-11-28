import { err, fromPromise, ok, type Result } from "@detour/result";
import { browser } from "wxt/browser";

export const RECONCILE_ALARM_NAME = "detour:grant-expiry";

export type AlarmError = {
  readonly type: "alarm_failed";
  readonly operation: string;
  readonly cause: unknown;
};

/** Schedules or clears the single next-expiry reconciliation alarm. */
export async function syncReconcileAlarm(
  nextAlarmAtMs: number | null,
): Promise<Result<number | null, AlarmError>> {
  if (nextAlarmAtMs === null) {
    const cleared = await fromPromise(
      () => browser.alarms.clear(RECONCILE_ALARM_NAME),
      (cause): AlarmError => ({ type: "alarm_failed", operation: "clear", cause }),
    );
    if (!cleared.ok) return err(cleared.error);
    return ok(null);
  }

  const created = await fromPromise(
    async () => {
      await browser.alarms.create(RECONCILE_ALARM_NAME, { when: nextAlarmAtMs });
    },
    (cause): AlarmError => ({ type: "alarm_failed", operation: "create", cause }),
  );
  if (!created.ok) return err(created.error);
  return ok(nextAlarmAtMs);
}

/** Reads the scheduled time of the reconcile alarm, or null when none is scheduled. */
export async function getReconcileAlarmWhenMs(): Promise<Result<number | null, AlarmError>> {
  const alarm = await fromPromise(
    () => browser.alarms.get(RECONCILE_ALARM_NAME),
    (cause): AlarmError => ({ type: "alarm_failed", operation: "get", cause }),
  );
  if (!alarm.ok) return err(alarm.error);
  return ok(alarm.value?.scheduledTime ?? null);
}
