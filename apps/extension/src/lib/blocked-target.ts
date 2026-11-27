import { err, ok, type Result } from "@detour/result";

export type BlockedTarget = {
  readonly host: string;
  readonly href: string;
};

export type BlockedTargetError =
  | { readonly type: "missing_url" }
  | { readonly type: "invalid_url"; readonly raw: string };

const RAW_URL_PREFIX = "?url=";

/**
 * Extracts and validates the intercepted destination from `blocked.html?url=...`.
 *
 * DNR `regexSubstitution` injects the matched URL verbatim without percent-encoding, so a target
 * containing `&` (e.g. `?url=https://example.com/search?a=1&b=2`) would be truncated by
 * `URLSearchParams.get("url")`. When the query begins with `?url=http://` or `?url=https://`,
 * preserve the full raw suffix; otherwise fall back to standard `URLSearchParams` decoding.
 */
export function parseBlockedTarget(search: string): Result<BlockedTarget, BlockedTargetError> {
  let raw: string | undefined;
  if (search.startsWith(RAW_URL_PREFIX)) {
    const candidate = search.slice(RAW_URL_PREFIX.length).trim();
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      raw = candidate;
    }
  }
  if (raw === undefined) {
    raw = new URLSearchParams(search).get("url")?.trim();
  }
  if (!raw) return err({ type: "missing_url" });
  if (!URL.canParse(raw)) return err({ type: "invalid_url", raw });
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err({ type: "invalid_url", raw });
  }
  return ok({ host: parsed.hostname, href: parsed.href });
}
