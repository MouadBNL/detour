/**
 * Test-only SQLite driver: Node's built-in `node:sqlite` behind `drizzle-orm/sqlite-proxy` with
 * Cloudflare D1's codecs, so tests get the same async `Db` (and the same migrations) as D1
 * without booting workerd. Local dev and production run on D1 through Wrangler instead.
 */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import path from "node:path";
import { err, ok, type Result } from "@detour/result";
import { d1Codecs } from "drizzle-orm/d1";
import {
  drizzle,
  type SqliteProxyExecutors,
  type SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";
import { migrate as migrateProxy } from "drizzle-orm/sqlite-proxy/migrator";
import type { Db } from "../d1.ts";

type MigrationFailed = { readonly type: "migration_failed"; readonly cause: unknown };

type Database = {
  readonly db: Db;
  /** Applies the SQL migrations in `packages/db/migrations/` that have not run yet. */
  readonly migrate: () => Promise<Result<void, MigrationFailed>>;
};

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, "../../migrations");

/**
 * Binds parameters the way D1 does: strings, numbers, bigints, bytes and null as they are,
 * booleans as 1/0, anything else rejected with D1's `D1_TYPE_ERROR` (so a value that would fail
 * on D1, an object Drizzle did not serialize, say, fails in tests too).
 */
function toSqlParams(params: readonly unknown[]): SQLInputValue[] {
  const result: SQLInputValue[] = [];
  for (const param of params) {
    if (
      param === null ||
      typeof param === "string" ||
      typeof param === "number" ||
      typeof param === "bigint" ||
      param instanceof Uint8Array
    ) {
      result.push(param);
    } else if (typeof param === "boolean") {
      result.push(param ? 1 : 0);
    } else {
      throw new TypeError(
        `D1_TYPE_ERROR: Type '${typeof param}' not supported for a bound parameter`,
      );
    }
  }
  return result;
}

function createRunAll(sqlite: DatabaseSync): SqliteProxyExecutors["all"] {
  function runAll(sqlText: string, params: unknown[], rowMode?: "array"): Promise<unknown[][]>;
  function runAll(
    sqlText: string,
    params: unknown[],
    rowMode: "object",
  ): Promise<Record<string, unknown>[]>;
  function runAll(
    sqlText: string,
    params: unknown[],
    rowMode?: "array" | "object",
  ): Promise<Record<string, unknown>[]>;
  // `async`: a synchronous throw (prepare, bind) becomes a rejection, as D1's promises do.
  async function runAll(
    sqlText: string,
    params: unknown[],
    rowMode?: "array" | "object",
  ): Promise<unknown> {
    const stmt = sqlite.prepare(sqlText);
    if (rowMode !== "object") stmt.setReturnArrays(true);
    return stmt.all(...toSqlParams(params));
  }
  return runAll;
}

function createRunGet(sqlite: DatabaseSync): SqliteProxyExecutors["get"] {
  function runGet(
    sqlText: string,
    params: unknown[],
    rowMode?: "array",
  ): Promise<unknown[] | undefined>;
  function runGet(
    sqlText: string,
    params: unknown[],
    rowMode: "object",
  ): Promise<Record<string, unknown> | undefined>;
  function runGet(
    sqlText: string,
    params: unknown[],
    rowMode?: "array" | "object",
  ): Promise<Record<string, unknown> | undefined>;
  async function runGet(
    sqlText: string,
    params: unknown[],
    rowMode?: "array" | "object",
  ): Promise<unknown> {
    const stmt = sqlite.prepare(sqlText);
    if (rowMode !== "object") stmt.setReturnArrays(true);
    return stmt.get(...toSqlParams(params));
  }
  return runGet;
}

function createExecutors(sqlite: DatabaseSync): SqliteProxyExecutors {
  const runAll = createRunAll(sqlite);
  const runGet = createRunGet(sqlite);
  const runExec = async (sqlText: string, params: unknown[]): Promise<unknown> =>
    sqlite.prepare(sqlText).run(...toSqlParams(params));

  return {
    all: runAll,
    get: runGet,
    run: runExec,
    // D1 runs a batch as one transaction: all of it commits, or none of it.
    batch: async (items) => {
      const results: unknown[] = [];
      sqlite.exec("BEGIN");
      try {
        for (const item of items) {
          if (item.method === "run") results.push(await runExec(item.sql, item.params));
          else if (item.method === "get")
            results.push(await runGet(item.sql, item.params, item.rowMode));
          else results.push(await runAll(item.sql, item.params, item.rowMode));
        }
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      return results;
    },
  };
}

export function fromSqlite(sqlite: DatabaseSync): Database {
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db: SqliteRemoteDatabase = drizzle(createExecutors(sqlite), { codecs: d1Codecs });
  const migrate = async (): Promise<Result<void, MigrationFailed>> => {
    try {
      await migrateProxy(
        db,
        async (queries) => {
          for (const query of queries) sqlite.exec(query);
        },
        { migrationsFolder: MIGRATIONS_FOLDER },
      );
      return ok();
    } catch (cause) {
      return err({ type: "migration_failed", cause });
    }
  };
  return {
    db,
    migrate,
  };
}

const failUnavailable = (): Promise<never> =>
  Promise.reject(new Error("D1_ERROR: database unavailable"));

/** Creates a Drizzle SQLite handle whose every query rejects as unavailable (for tests). */
export function createUnreachableDb(): Db {
  return drizzle({
    all: failUnavailable,
    get: failUnavailable,
    run: failUnavailable,
    batch: failUnavailable,
  });
}
