import type { Browser } from "wxt/browser";
import { buildBlockedRedirectUrl } from "./dnr-projection.ts";
import { getBlockedPageUrl } from "./dnr.adapter.ts";
import {
  extractWebHostname,
  hostnameMatchesDomain,
  type ExpiredGrantContext,
} from "./guard-state.ts";
import {
  parseExtensionMessage,
  type ExtensionMessage,
  type ExtensionResponse,
} from "./messages.ts";
import {
  addGuardedSite,
  grantDomainAccess,
  reconcile,
  removeGuardedSite,
  setPausedState,
  type ReconcileError,
} from "./reconcile.ts";
import { readGuardState } from "./storage.adapter.ts";
import { redirectTab } from "./tabs-scripting.adapter.ts";

function formatError(error: ReconcileError): ExtensionResponse {
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
  }
  return { ok: false, errorType: error.type, message };
}

async function resolveExpiryContext(
  sender: Browser.runtime.MessageSender,
): Promise<ExtensionResponse> {
  const stored = await readGuardState();
  if (!stored.ok) return formatError(stored.error);

  const senderHost = extractWebHostname(sender.tab?.url);
  const context: ExpiredGrantContext | null = senderHost
    ? (stored.value.lastExpired.find((item) => hostnameMatchesDomain(senderHost, item.domain)) ??
      null)
    : (stored.value.lastExpired[0] ?? null);
  return { ok: true, type: "expiry_context", context };
}

async function dispatchMessage(
  message: ExtensionMessage,
  sender: Browser.runtime.MessageSender,
): Promise<ExtensionResponse> {
  let reply: ExtensionResponse;
  switch (message.type) {
    case "get_status": {
      const result = await reconcile();
      reply = result.ok
        ? { ok: true, type: "status", status: result.value.status }
        : formatError(result.error);
      break;
    }
    case "set_paused": {
      const result = await setPausedState(message.paused);
      reply = result.ok
        ? { ok: true, type: "status", status: result.value.status }
        : formatError(result.error);
      break;
    }
    case "add_site": {
      const result = await addGuardedSite(message.domain);
      reply = result.ok
        ? { ok: true, type: "status", status: result.value.status }
        : formatError(result.error);
      break;
    }
    case "remove_site": {
      const result = await removeGuardedSite(message.domain);
      reply = result.ok
        ? { ok: true, type: "status", status: result.value.status }
        : formatError(result.error);
      break;
    }
    case "grant_access": {
      const result = await grantDomainAccess({
        domain: message.domain,
        durationMinutes: message.durationMinutes,
        reason: message.reason,
      });
      reply = result.ok
        ? {
            ok: true,
            type: "grant_installed",
            domain: message.domain,
            expiresAtMs: result.value.expiresAtMs,
            sessionRuleCount: result.value.status.sessionRuleCount,
          }
        : formatError(result.error);
      break;
    }
    case "reconcile_now": {
      const result = await reconcile({ expiredAction: message.expiredAction });
      reply = result.ok
        ? { ok: true, type: "status", status: result.value.status }
        : formatError(result.error);
      break;
    }
    case "get_expiry_context":
      reply = await resolveExpiryContext(sender);
      break;
    case "submit_followup": {
      if (message.verdict === "wrapup_2m") {
        const result = await grantDomainAccess({
          domain: message.domain,
          durationMinutes: 2,
          reason: "2-minute wrap-up",
        });
        reply = result.ok
          ? { ok: true, type: "followup_recorded", domain: message.domain, verdict: "wrapup_2m" }
          : formatError(result.error);
        break;
      }
      if (typeof sender.tab?.id === "number" && typeof sender.tab.url === "string") {
        await redirectTab(
          sender.tab.id,
          buildBlockedRedirectUrl(getBlockedPageUrl(), sender.tab.url),
        );
      }
      reply = {
        ok: true,
        type: "followup_recorded",
        domain: message.domain,
        verdict: message.verdict,
      };
      break;
    }
  }
  return reply;
}

/** Handles typed runtime messages arriving at the MV3 background service worker / event page. */
export async function handleBackgroundMessage(
  rawMessage: unknown,
  sender: Browser.runtime.MessageSender,
): Promise<ExtensionResponse> {
  const message = parseExtensionMessage(rawMessage);
  if (!message) {
    return { ok: false, errorType: "invalid_message", message: "Unsupported message payload." };
  }
  return dispatchMessage(message, sender);
}
