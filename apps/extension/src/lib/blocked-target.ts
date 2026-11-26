import { err, ok, type Result } from "@detour/result";

export type BlockedTarget = {
  readonly host: string;
  readonly href: string;
};

export type BlockedTargetError =
  | { readonly type: "missing_url" }
  | { readonly type: "invalid_url"; readonly raw: string };

/** Extracts and validates the intercepted destination from `blocked.html?url=...`. */
export function parseBlockedTarget(search: string): Result<BlockedTarget, BlockedTargetError> {
  const raw = new URLSearchParams(search).get("url")?.trim();
  if (!raw) return err({ type: "missing_url" });
  if (!URL.canParse(raw)) return err({ type: "invalid_url", raw });
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err({ type: "invalid_url", raw });
  }
  return ok({ host: parsed.hostname, href: parsed.href });
}
