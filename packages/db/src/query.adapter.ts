/**
 * Database failures as values for Cloudflare D1 and local `node:sqlite`.
 *
 * `tryQuery` sorts thrown errors into three buckets:
 * - a declared SQLite constraint rejected the write (`unique_violation`, `foreign_key_violation`,
 *   `check_violation`, `not_null_violation`);
 * - the database cannot be reached or is overloaded (`db_unavailable`);
 * - anything else (syntax error, missing table, bug): a defect, rethrown untouched.
 */
import { err, ok, type Result } from "@detour/result";
import { DrizzleQueryError } from "drizzle-orm/errors";

export type DbUnavailable = { readonly type: "db_unavailable"; readonly cause: unknown };

type ViolationType =
  | "unique_violation"
  | "foreign_key_violation"
  | "check_violation"
  | "not_null_violation";

export type ConstraintViolation = {
  readonly type: ViolationType;
  /** SQLite target, e.g. `pairing_sessions.user_code`; compare with schema constants. */
  readonly constraint: string;
  readonly table: string | undefined;
  readonly detail: string | undefined;
};

/** What `tryQuery` returns instead of throwing. */
export type QueryFailure = ConstraintViolation | DbUnavailable;

const UNAVAILABLE_PATTERNS = [
  /SQLITE_BUSY/i,
  /SQLITE_LOCKED/i,
  /SQLITE_CANTOPEN/i,
  /SQLITE_IOERR/i,
  /SQLITE_PROTOCOL/i,
  /database is locked/i,
  /database unavailable/i,
  // Cloudflare's documented transient D1 errors (retrying can succeed), and nothing broader: a
  // defect whose text merely contains "reset" or "internal" (a column name) must stay a defect.
  /Network connection lost/i,
  /D1 DB is overloaded/i,
  /D1 DB.*\b(?:was|to be) reset\b/i,
  /D1 DB.*transient issue/i,
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i,
];

type ConstraintRule = {
  readonly type: ViolationType;
  readonly pattern: RegExp;
  readonly errcodes: readonly number[];
  readonly fallback: string;
  readonly hasTable: boolean;
};

const CONSTRAINT_RULES: readonly ConstraintRule[] = [
  {
    type: "unique_violation",
    pattern: /UNIQUE constraint failed:\s*([^:\n]+)/i,
    errcodes: [2067, 1555],
    fallback: "unique",
    hasTable: true,
  },
  {
    type: "not_null_violation",
    pattern: /NOT NULL constraint failed:\s*([^:\n]+)/i,
    errcodes: [1299],
    fallback: "not_null",
    hasTable: true,
  },
  {
    type: "foreign_key_violation",
    pattern: /FOREIGN KEY constraint failed/i,
    errcodes: [787],
    fallback: "foreign_key",
    hasTable: false,
  },
  {
    type: "check_violation",
    pattern: /CHECK constraint failed:\s*([^:\n]+)/i,
    errcodes: [275],
    fallback: "check",
    hasTable: false,
  },
];

function extractMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return typeof cause.message === "string" ? cause.message : "";
  }
  return typeof cause === "string" ? cause : "";
}

function extractErrcode(cause: unknown): number | undefined {
  if (typeof cause === "object" && cause !== null && "errcode" in cause) {
    return typeof cause.errcode === "number" ? cause.errcode : undefined;
  }
  return undefined;
}

function stripD1Suffix(target: string): string {
  return target.replace(/:\s*SQLITE_[A-Z_]+$/i, "").trim();
}

function tableFromTarget(target: string): string | undefined {
  const dot = target.indexOf(".");
  return dot > 0 ? target.slice(0, dot) : undefined;
}

function parseConstraint(
  message: string,
  errcode: number | undefined,
): ConstraintViolation | undefined {
  for (const rule of CONSTRAINT_RULES) {
    const match = rule.pattern.exec(message);
    if (match === null && (errcode === undefined || !rule.errcodes.includes(errcode))) continue;
    const constraint = stripD1Suffix(match?.[1] ?? rule.fallback);
    return {
      type: rule.type,
      constraint,
      table: rule.hasTable ? tableFromTarget(constraint) : undefined,
      detail: message,
    };
  }
  return undefined;
}

function toQueryFailure(thrown: unknown): QueryFailure | undefined {
  const cause = thrown instanceof DrizzleQueryError ? thrown.cause : thrown;
  const message = extractMessage(cause);
  const violation = parseConstraint(message, extractErrcode(cause));
  if (violation !== undefined) return violation;
  if (UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { type: "db_unavailable", cause };
  }
  return undefined;
}

/**
 * Runs a query; SQLite/D1 constraint violations and unavailability come back as values, anything
 * else is rethrown untouched as a defect.
 */
export async function tryQuery<T>(run: () => PromiseLike<T>): Promise<Result<T, QueryFailure>> {
  try {
    return ok(await run());
  } catch (thrown) {
    const failure = toQueryFailure(thrown);
    if (failure === undefined) throw thrown;
    return err(failure);
  }
}
