import { err, fromPromise, ok, type Result } from "@detour/result";
import { browser, type Browser } from "wxt/browser";
import type { ExtensionMessage, ExtensionResponse } from "./messages.ts";

export type RuntimeError = {
  readonly type: "runtime_failed";
  readonly cause: unknown;
};

export type BackgroundHandlers = {
  readonly onLifecycleTrigger: (reason: string) => Promise<void>;
  readonly onAlarm: (alarmName: string) => Promise<void>;
  readonly onMessage: (
    rawMessage: unknown,
    sender: Browser.runtime.MessageSender,
  ) => Promise<ExtensionResponse>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExtensionResponse(value: unknown): value is ExtensionResponse {
  return isRecord(value) && typeof value["ok"] === "boolean";
}

/** Returns this extension's origin prefix (`chrome-extension://<id>/` or `moz-extension://<uuid>/`). */
export function getExtensionOriginPrefix(): string {
  return browser.runtime.getURL("");
}

/** Returns this extension's runtime id. */
export function getExtensionId(): string {
  return browser.runtime.id;
}

/** Sends a typed runtime message to the MV3 background worker/event page. */
export async function sendExtensionMessage(
  message: ExtensionMessage,
): Promise<Result<ExtensionResponse, RuntimeError>> {
  const response = await fromPromise(
    (): Promise<unknown> => browser.runtime.sendMessage(message),
    (cause): RuntimeError => ({ type: "runtime_failed", cause }),
  );
  if (!response.ok) return response;
  if (!isExtensionResponse(response.value)) {
    return err({ type: "runtime_failed", cause: response.value });
  }
  return ok(response.value);
}

/**
 * Registers top-level synchronous MV3 background listeners.
 *
 * Uses `sendResponse` + `return true` for `runtime.onMessage` so async responses work identically
 * on Chrome (raw `chrome.*`, which ignores returned Promises) and Firefox MV3.
 */
export function registerBackgroundListeners(handlers: BackgroundHandlers): void {
  browser.runtime.onInstalled.addListener(() => {
    void handlers.onLifecycleTrigger("onInstalled");
  });

  browser.runtime.onStartup.addListener(() => {
    void handlers.onLifecycleTrigger("onStartup");
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    void handlers.onAlarm(alarm.name);
  });

  browser.permissions.onAdded.addListener(() => {
    void handlers.onLifecycleTrigger("permissions.onAdded");
  });

  browser.permissions.onRemoved.addListener(() => {
    void handlers.onLifecycleTrigger("permissions.onRemoved");
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handlers
      .onMessage(message, sender)
      .then((reply) => {
        sendResponse(reply);
      })
      .catch((cause: unknown) => {
        sendResponse({
          ok: false,
          errorType: "internal_error",
          message: String(cause),
        });
      });
    return true;
  });
}
