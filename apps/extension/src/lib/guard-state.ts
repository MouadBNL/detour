import { err, ok, type Result } from "@detour/result";

export type GuardedSite = {
  readonly domain: string;
};

export type ActiveGrant = {
  readonly domain: string;
  readonly reason: string;
  readonly grantedAtMs: number;
  readonly expiresAtMs: number;
};

export type ExpiredGrantContext = {
  readonly domain: string;
  readonly reason: string;
  readonly durationMinutes: number;
  readonly expiredAtMs: number;
};

export type GuardState = {
  readonly paused: boolean;
  readonly sites: readonly GuardedSite[];
  readonly grants: readonly ActiveGrant[];
  readonly lastExpired: readonly ExpiredGrantContext[];
};

export type DomainError = {
  readonly type: "invalid_domain";
  readonly raw: string;
};

export const DEFAULT_GUARD_STATE: GuardState = {
  paused: false,
  sites: [],
  grants: [],
  lastExpired: [],
};

const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;

/** Normalizes user input (`https://News.YCombinator.com/newest` or `example.com`) to a domain. */
export function normalizeDomain(input: string): Result<string, DomainError> {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return err({ type: "invalid_domain", raw: input });
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(withScheme)) return err({ type: "invalid_domain", raw: input });
  const hostname = new URL(withScheme).hostname.replace(/\.+$/u, "");
  if (!HOSTNAME_PATTERN.test(hostname) && hostname !== "localhost") {
    return err({ type: "invalid_domain", raw: input });
  }
  return ok(hostname);
}

/** Builds optional host-permission match patterns covering a domain and its subdomains. */
export function domainToOriginPatterns(domain: string): readonly string[] {
  if (domain === "localhost") {
    return ["*://localhost/*"];
  }
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

/** Returns true when `hostname` equals `domain` or is a subdomain of `domain`. */
export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

/** Extracts the hostname from an http(s) URL string, or returns null for non-web URLs. */
export function extractWebHostname(url: string | undefined): string | null {
  if (!url || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.hostname.toLowerCase();
}

/** Splits stored grants into still-active and expired buckets at `nowMs`. */
export function partitionGrants(
  grants: readonly ActiveGrant[],
  nowMs: number,
): { readonly active: readonly ActiveGrant[]; readonly expired: readonly ActiveGrant[] } {
  const active: ActiveGrant[] = [];
  const expired: ActiveGrant[] = [];
  for (const grant of grants) {
    if (grant.expiresAtMs > nowMs) {
      active.push(grant);
    } else {
      expired.push(grant);
    }
  }
  return { active, expired };
}

/** Returns the earliest future expiry timestamp among active grants, or null if none exist. */
export function nextExpiryMs(grants: readonly ActiveGrant[], nowMs: number): number | null {
  let earliest: number | null = null;
  for (const grant of grants) {
    if (grant.expiresAtMs <= nowMs) continue;
    if (earliest === null || grant.expiresAtMs < earliest) {
      earliest = grant.expiresAtMs;
    }
  }
  return earliest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSites(raw: unknown): readonly GuardedSite[] {
  if (!Array.isArray(raw)) return [];
  const result: GuardedSite[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry["domain"] !== "string") continue;
    const normalized = normalizeDomain(entry["domain"]);
    if (normalized.ok && !result.some((site) => site.domain === normalized.value)) {
      result.push({ domain: normalized.value });
    }
  }
  return result;
}

function parseGrants(raw: unknown): readonly ActiveGrant[] {
  if (!Array.isArray(raw)) return [];
  const result: ActiveGrant[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const domain = entry["domain"];
    const reason = entry["reason"];
    const grantedAtMs = entry["grantedAtMs"];
    const expiresAtMs = entry["expiresAtMs"];
    if (
      typeof domain !== "string" ||
      typeof reason !== "string" ||
      typeof grantedAtMs !== "number" ||
      typeof expiresAtMs !== "number"
    ) {
      continue;
    }
    const normalized = normalizeDomain(domain);
    if (!normalized.ok) continue;
    result.push({ domain: normalized.value, reason, grantedAtMs, expiresAtMs });
  }
  return result;
}

function parseLastExpired(raw: unknown): readonly ExpiredGrantContext[] {
  if (!Array.isArray(raw)) return [];
  const result: ExpiredGrantContext[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const domain = entry["domain"];
    const reason = entry["reason"];
    const durationMinutes = entry["durationMinutes"];
    const expiredAtMs = entry["expiredAtMs"];
    if (
      typeof domain !== "string" ||
      typeof reason !== "string" ||
      typeof durationMinutes !== "number" ||
      typeof expiredAtMs !== "number"
    ) {
      continue;
    }
    const normalized = normalizeDomain(domain);
    if (!normalized.ok) continue;
    result.push({ domain: normalized.value, reason, durationMinutes, expiredAtMs });
  }
  return result;
}

/** Validates untrusted storage payloads into a well-typed `GuardState`. */
export function parseGuardState(raw: unknown): GuardState {
  if (!isRecord(raw)) return DEFAULT_GUARD_STATE;
  const paused = raw["paused"];
  return {
    paused: typeof paused === "boolean" ? paused : false,
    sites: parseSites(raw["sites"]),
    grants: parseGrants(raw["grants"]),
    lastExpired: parseLastExpired(raw["lastExpired"]),
  };
}
