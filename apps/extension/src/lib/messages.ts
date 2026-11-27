import type { ExpiredGrantContext, GuardState } from "./guard-state.ts";

export type StorageAccessStatus = "enforced" | "unsupported";

export type FollowupVerdict = "worth_it" | "drifted" | "not_worth_it" | "wrapup_2m";

export type ExpiredTabAction = "overlay" | "redirect";

export type ExtensionStatus = {
  readonly state: GuardState;
  readonly grantedDomains: readonly string[];
  readonly revokedDomains: readonly string[];
  readonly storageAccess: StorageAccessStatus;
  readonly dynamicRuleCount: number;
  readonly sessionRuleCount: number;
  readonly nextAlarmAtMs: number | null;
};

export type ExtensionMessage =
  | { readonly type: "get_status" }
  | { readonly type: "set_paused"; readonly paused: boolean }
  | { readonly type: "add_site"; readonly domain: string }
  | { readonly type: "remove_site"; readonly domain: string }
  | {
      readonly type: "grant_access";
      readonly domain: string;
      readonly durationMinutes: number;
      readonly reason: string;
    }
  | { readonly type: "reconcile_now"; readonly expiredAction?: ExpiredTabAction }
  | { readonly type: "get_expiry_context" }
  | {
      readonly type: "submit_followup";
      readonly domain: string;
      readonly verdict: FollowupVerdict;
    };

export type ExtensionResponse =
  | { readonly ok: true; readonly type: "status"; readonly status: ExtensionStatus }
  | {
      readonly ok: true;
      readonly type: "grant_installed";
      readonly domain: string;
      readonly expiresAtMs: number;
      readonly sessionRuleCount: number;
    }
  | {
      readonly ok: true;
      readonly type: "expiry_context";
      readonly context: ExpiredGrantContext | null;
    }
  | {
      readonly ok: true;
      readonly type: "followup_recorded";
      readonly domain: string;
      readonly verdict: FollowupVerdict;
    }
  | { readonly ok: false; readonly errorType: string; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFollowupVerdict(value: unknown): value is FollowupVerdict {
  return (
    value === "worth_it" || value === "drifted" || value === "not_worth_it" || value === "wrapup_2m"
  );
}

/** Validates an untrusted runtime message payload into a typed `ExtensionMessage`. */
export function parseExtensionMessage(raw: unknown): ExtensionMessage | null {
  if (!isRecord(raw) || typeof raw["type"] !== "string") return null;
  switch (raw["type"]) {
    case "get_status":
      return { type: "get_status" };
    case "set_paused":
      return typeof raw["paused"] === "boolean"
        ? { type: "set_paused", paused: raw["paused"] }
        : null;
    case "add_site":
      return typeof raw["domain"] === "string" ? { type: "add_site", domain: raw["domain"] } : null;
    case "remove_site":
      return typeof raw["domain"] === "string"
        ? { type: "remove_site", domain: raw["domain"] }
        : null;
    case "grant_access": {
      const domain = raw["domain"];
      const durationMinutes = raw["durationMinutes"];
      const reason = raw["reason"];
      if (
        typeof domain !== "string" ||
        typeof durationMinutes !== "number" ||
        typeof reason !== "string"
      ) {
        return null;
      }
      return { type: "grant_access", domain, durationMinutes, reason };
    }
    case "reconcile_now": {
      const action = raw["expiredAction"];
      return action === "overlay" || action === "redirect"
        ? { type: "reconcile_now", expiredAction: action }
        : { type: "reconcile_now" };
    }
    case "get_expiry_context":
      return { type: "get_expiry_context" };
    case "submit_followup": {
      const domain = raw["domain"];
      const verdict = raw["verdict"];
      if (typeof domain !== "string" || !isFollowupVerdict(verdict)) return null;
      return { type: "submit_followup", domain, verdict };
    }
    default:
      return null;
  }
}
