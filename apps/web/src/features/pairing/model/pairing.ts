import { PairingUserCodeSchema, type PAIRING_BROWSERS } from "@detour/contracts";
import type { ApiFailure } from "../../../lib/api-failure.ts";

export type PairingBrowser = (typeof PAIRING_BROWSERS)[number];
export type ViewerFailure = ApiFailure<"auth.me">;
export type LookupFailure = ApiFailure<"pairing.lookup">;
export type DecisionFailure = ApiFailure<"pairing.approve" | "pairing.deny">;

const BROWSER_LABELS: Record<PairingBrowser, string> = {
  chrome: "Chrome extension",
  firefox: "Firefox extension",
  other: "Browser extension",
};

const LOOKUP_UNAVAILABLE: Record<
  Extract<LookupFailure, { readonly type: "service_unavailable" }>["reason"],
  string
> = {
  shutting_down: "Detour is restarting. Try again in a moment.",
  database_unavailable: "Detour cannot reach its database right now.",
  auth_unavailable: "Detour cannot check your sign-in right now. Try again in a moment.",
};

const LOOKUP_FORBIDDEN: Record<
  Extract<LookupFailure, { readonly type: "forbidden" }>["reason"],
  string
> = {
  web_session_required: "Sign in on the web to approve an extension.",
};

const DECISION_CONFLICT: Record<
  Extract<DecisionFailure, { readonly type: "conflict" }>["reason"],
  string
> = {
  already_decided: "This pairing code was already approved or denied.",
  expired: "This pairing code has expired. Start pairing again in the extension.",
};

const SIMPLE_LOOKUP_FAILURES: Record<
  Exclude<LookupFailure, { readonly type: "forbidden" | "service_unavailable" }>["type"],
  string
> = {
  not_found: "We could not find a pairing request for this code.",
  unauthorized: "Sign in to confirm this pairing request.",
  invalid_input: "Enter the 8-character code shown in the extension (for example, ABCD-EFGH).",
  unreachable: "Could not reach the Detour API.",
  unexpected: "Something went wrong while checking that pairing code.",
};

const SIMPLE_DECISION_FAILURES: Record<
  Exclude<
    DecisionFailure,
    { readonly type: "conflict" | "forbidden" | "service_unavailable" }
  >["type"],
  string
> = {
  not_found: "This pairing code no longer exists.",
  unauthorized: "Your session expired. Sign in again to continue.",
  invalid_input: "That pairing code format is not valid.",
  unreachable: "Could not reach the Detour API.",
  unexpected: "Could not update the pairing request.",
};

export function describeBrowser(browser: PairingBrowser): string {
  return BROWSER_LABELS[browser];
}

export function normalizePairingCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function validatePairingCode(raw: string): string | null {
  const parsed = PairingUserCodeSchema.safeParse(raw);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Enter a valid pairing code.");
}

export function describeLookupFailure(failure: LookupFailure): string {
  if (failure.type === "forbidden") return LOOKUP_FORBIDDEN[failure.reason];
  if (failure.type === "service_unavailable") return LOOKUP_UNAVAILABLE[failure.reason];
  return SIMPLE_LOOKUP_FAILURES[failure.type];
}

export function describeDecisionFailure(failure: DecisionFailure): string {
  if (failure.type === "conflict") return DECISION_CONFLICT[failure.reason];
  if (failure.type === "forbidden") return LOOKUP_FORBIDDEN[failure.reason];
  if (failure.type === "service_unavailable") return LOOKUP_UNAVAILABLE[failure.reason];
  return SIMPLE_DECISION_FAILURES[failure.type];
}
