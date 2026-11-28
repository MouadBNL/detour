import type { Result } from "@detour/result";
import type { Browser } from "wxt/browser";
import { formatError } from "./background-errors.ts";
import { enqueueBackground } from "./background-queue.ts";
import { buildBlockedRedirectUrl } from "./dnr-projection.ts";
import { getBlockedPageUrl } from "./dnr.adapter.ts";
import {
  addGuardedSite,
  consumeWrapupGrant,
  grantDomainAccess,
  removeGuardedSite,
  setPausedState,
} from "./guard-mutations.ts";
import {
  extractWebHostname,
  hostnameMatchesDomain,
  type ExpiredGrantContext,
} from "./guard-state.ts";
import {
  parseExtensionMessage,
  type ExtensionMessage,
  type ExtensionResponse,
  type FollowupVerdict,
} from "./messages.ts";
import {
  readExtensionStatus,
  reconcile,
  type ReconcileError,
  type ReconcileResult,
} from "./reconcile.ts";
import { getExtensionId, getExtensionOriginPrefix } from "./runtime.adapter.ts";
import { readGuardState } from "./storage.adapter.ts";
import { redirectTab } from "./tabs-scripting.adapter.ts";

type Sender = Browser.runtime.MessageSender;

const UNAUTHORIZED: ExtensionResponse = {
  ok: false,
  errorType: "unauthorized_sender",
  message: "Untrusted message sender.",
};

function isOwnExtension(sender: Sender): boolean {
  return !sender.id || sender.id === getExtensionId();
}

/** True for this extension's own pages (popup, blocked page), never for content scripts. */
function isTrustedExtensionSender(sender: Sender): boolean {
  return (
    isOwnExtension(sender) &&
    typeof sender.url === "string" &&
    sender.url.startsWith(getExtensionOriginPrefix())
  );
}

/** True for trusted extension pages or for content scripts running in a web tab. */
function isTrustedOrTabSender(sender: Sender): boolean {
  if (isTrustedExtensionSender(sender)) return true;
  return isOwnExtension(sender) && extractWebHostname(sender.tab?.url) !== null;
}

function statusReply(result: Result<ReconcileResult, ReconcileError>): ExtensionResponse {
  return result.ok
    ? { ok: true, type: "status", status: result.value.status }
    : formatError(result.error);
}

async function resolveExpiryContext(sender: Sender): Promise<ExtensionResponse> {
  const stored = await enqueueBackground(readGuardState);
  if (!stored.ok) return formatError(stored.error);

  const senderHost = extractWebHostname(sender.tab?.url);
  const context: ExpiredGrantContext | null = senderHost
    ? (stored.value.lastExpired.find((item) => hostnameMatchesDomain(senderHost, item.domain)) ??
      null)
    : (stored.value.lastExpired[0] ?? null);
  return { ok: true, type: "expiry_context", context };
}

async function submitFollowup(
  verdict: FollowupVerdict,
  sender: Sender,
): Promise<ExtensionResponse> {
  const senderHost = extractWebHostname(sender.tab?.url);
  if (senderHost === null) {
    return { ok: false, errorType: "invalid_sender", message: "Missing tab URL for follow-up." };
  }
  if (verdict === "wrapup_2m") {
    const result = await consumeWrapupGrant(senderHost);
    return result.ok
      ? { ok: true, type: "followup_recorded", domain: result.value.extra.domain, verdict }
      : formatError(result.error);
  }
  if (typeof sender.tab?.id !== "number" || typeof sender.tab.url !== "string") {
    return { ok: false, errorType: "invalid_sender", message: "Missing tab URL for follow-up." };
  }
  const redirected = await redirectTab(
    sender.tab.id,
    buildBlockedRedirectUrl(getBlockedPageUrl(), sender.tab.url),
  );
  if (!redirected.ok) return formatError(redirected.error);
  return { ok: true, type: "followup_recorded", domain: senderHost, verdict };
}

async function dispatchPrivileged(
  message: Exclude<ExtensionMessage, { readonly type: "get_expiry_context" | "submit_followup" }>,
): Promise<ExtensionResponse> {
  let reply: ExtensionResponse;
  switch (message.type) {
    case "get_status": {
      const status = await readExtensionStatus();
      reply = status.ok
        ? { ok: true, type: "status", status: status.value }
        : formatError(status.error);
      break;
    }
    case "set_paused":
      reply = statusReply(await setPausedState(message.paused));
      break;
    case "add_site":
      reply = statusReply(await addGuardedSite(message.domain));
      break;
    case "remove_site":
      reply = statusReply(await removeGuardedSite(message.domain));
      break;
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
            domain: result.value.extra.domain,
            expiresAtMs: result.value.extra.expiresAtMs,
            sessionRuleCount: result.value.status.sessionRuleCount,
          }
        : formatError(result.error);
      break;
    }
    case "reconcile_now":
      reply = statusReply(await reconcile({ expiredAction: message.expiredAction }));
      break;
  }
  return reply;
}

/** Handles typed runtime messages arriving at the MV3 background service worker / event page. */
export async function handleBackgroundMessage(
  rawMessage: unknown,
  sender: Sender,
): Promise<ExtensionResponse> {
  const message = parseExtensionMessage(rawMessage);
  if (!message) {
    return { ok: false, errorType: "invalid_message", message: "Unsupported message payload." };
  }
  if (message.type === "get_expiry_context" || message.type === "submit_followup") {
    if (!isTrustedOrTabSender(sender)) return UNAUTHORIZED;
    return message.type === "get_expiry_context"
      ? resolveExpiryContext(sender)
      : submitFollowup(message.verdict, sender);
  }
  if (!isTrustedExtensionSender(sender)) return UNAUTHORIZED;
  return dispatchPrivileged(message);
}
