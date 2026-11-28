import { err, ok, type Result } from "@detour/result";
import { queryOptions } from "@tanstack/react-query";
import type { ExtensionMessage, ExtensionResponse, ExtensionStatus } from "./messages.ts";
import { unwrapForQuery } from "./query.adapter.ts";
import { sendExtensionMessage } from "./runtime.adapter.ts";

type SuccessReply = Extract<ExtensionResponse, { readonly ok: true }>;
type SuccessReplyType = SuccessReply["type"];
type ReplyOf<K extends SuccessReplyType> = Extract<SuccessReply, { readonly type: K }>;

/** Why a runtime message to the background worker did not produce the expected reply. */
export type ExtensionApiError =
  | { readonly type: "runtime_failed"; readonly cause: unknown }
  | { readonly type: "background_error"; readonly errorType: string; readonly message: string }
  | {
      readonly type: "unexpected_reply";
      readonly expected: SuccessReplyType;
      readonly received: SuccessReplyType;
    };

export type PassRequest = {
  readonly domain: string;
  readonly durationMinutes: number;
  readonly reason: string;
};

function isReplyOf<K extends SuccessReplyType>(
  reply: SuccessReply,
  expected: K,
): reply is ReplyOf<K> {
  return reply.type === expected;
}

async function request<K extends SuccessReplyType>(
  message: ExtensionMessage,
  expected: K,
): Promise<Result<ReplyOf<K>, ExtensionApiError>> {
  const reply = await sendExtensionMessage(message);
  if (!reply.ok) return reply;
  const response = reply.value;
  if (!response.ok) {
    return err({
      type: "background_error",
      errorType: response.errorType,
      message: response.message,
    });
  }
  if (!isReplyOf(response, expected)) {
    return err({ type: "unexpected_reply", expected, received: response.type });
  }
  return ok(response);
}

async function requestStatus(
  message: ExtensionMessage,
): Promise<Result<ExtensionStatus, ExtensionApiError>> {
  const reply = await request(message, "status");
  return reply.ok ? ok(reply.value.status) : reply;
}

/** Reads the guard state, host access per site and rule counts from the background worker. */
export function fetchExtensionStatus(): Promise<Result<ExtensionStatus, ExtensionApiError>> {
  return requestStatus({ type: "get_status" });
}

export function setPausedMutationFn(
  paused: boolean,
): Promise<Result<ExtensionStatus, ExtensionApiError>> {
  return requestStatus({ type: "set_paused", paused });
}

export function addSiteMutationFn(
  domain: string,
): Promise<Result<ExtensionStatus, ExtensionApiError>> {
  return requestStatus({ type: "add_site", domain });
}

export function removeSiteMutationFn(
  domain: string,
): Promise<Result<ExtensionStatus, ExtensionApiError>> {
  return requestStatus({ type: "remove_site", domain });
}

export function reconcileNowMutationFn(): Promise<Result<ExtensionStatus, ExtensionApiError>> {
  return requestStatus({ type: "reconcile_now" });
}

/** Asks the background worker to install a temporary allow rule for `domain`. */
export function requestPassAccess(
  pass: PassRequest,
): Promise<Result<ReplyOf<"grant_installed">, ExtensionApiError>> {
  return request({ type: "grant_access", ...pass }, "grant_installed");
}

/** Sentences for failures that carry no message of their own. */
const API_ERROR_SENTENCES: Record<
  Exclude<ExtensionApiError["type"], "background_error">,
  string
> = {
  runtime_failed: "Could not reach the Detour background worker.",
  unexpected_reply: "Detour answered with an unexpected reply.",
};

/** One sentence per failure, for an alert next to the action that failed. */
export function describeExtensionApiError(error: ExtensionApiError): string {
  // The background worker already words its own errors (`background-errors.ts`).
  if (error.type === "background_error") return error.message;
  return API_ERROR_SENTENCES[error.type];
}

/** The popup's view of the extension. Failures come back as `query.error`. */
export const popupStatusQueryOptions = queryOptions<ExtensionStatus, ExtensionApiError>({
  queryKey: ["extension", "status"],
  queryFn: async () => unwrapForQuery(await fetchExtensionStatus()),
});
