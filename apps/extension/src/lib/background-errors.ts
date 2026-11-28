import type { ExtensionResponse } from "./messages.ts";
import type { ReconcileError } from "./reconcile.ts";

function describeError(error: ReconcileError): string {
  let message: string;
  switch (error.type) {
    case "storage_failed":
      message = "Extension storage operation failed.";
      break;
    case "dnr_failed":
      message = `DNR ${error.operation} failed.`;
      break;
    case "permissions_failed":
      message = `Permissions ${error.operation} failed.`;
      break;
    case "alarm_failed":
      message = `Alarms ${error.operation} failed.`;
      break;
    case "tabs_scripting_failed":
      message = `${error.operation} failed.`;
      break;
    case "invalid_domain":
      message = `Invalid domain: ${error.raw}`;
      break;
    case "site_not_guarded":
      message = `${error.domain} is not on your guarded list.`;
      break;
    case "wrapup_unavailable":
      message = `No wrap-up available for ${error.domain}.`;
      break;
    case "invalid_duration":
      message = "Pass length must be between 1 and 240 minutes.";
      break;
    case "reason_too_long":
      message = `Keep your reason under ${String(error.maxLength)} characters.`;
      break;
  }
  return message;
}

/** Maps a background error value to the runtime-message failure reply. */
export function formatError(error: ReconcileError): ExtensionResponse {
  return { ok: false, errorType: error.type, message: describeError(error) };
}
