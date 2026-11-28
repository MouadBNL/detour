/**
 * Test databases (`@detour/db/testing`).
 *
 *   const db = await createTestDb(); // empty, fully migrated SQLite in memory (<1 ms)
 *
 * Uses Node's built-in `node:sqlite` (`DatabaseSync`) behind the exact same async Drizzle SQLite
 * interface as Cloudflare D1. Each worker keeps one migrated in-memory SQLite instance and clears
 * all tables between tests in sub-millisecond time.
 */
import { DatabaseSync } from "node:sqlite";
import { assert } from "vite-plus/test";
import { createUnreachableDb, fromSqlite } from "./testing/sqlite.adapter.ts";
import type { Db } from "./d1.ts";

type WorkerDb = {
  readonly sqlite: DatabaseSync;
  readonly db: Db;
};

let shared: Promise<WorkerDb> | undefined;

async function boot(): Promise<WorkerDb> {
  const sqlite = new DatabaseSync(":memory:");
  const database = fromSqlite(sqlite);
  const migrated = await database.migrate();
  if (!migrated.ok) assert.fail(`test database migration failed: ${String(migrated.error.cause)}`);
  return { sqlite, db: database.db };
}

function resetSqlite(sqlite: DatabaseSync): void {
  const rows = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'",
    )
    .all();
  sqlite.exec("PRAGMA foreign_keys = OFF;");
  for (const row of rows) {
    if (typeof row["name"] === "string") {
      const escaped = row["name"].replaceAll('"', '""');
      sqlite.exec(`DELETE FROM "${escaped}"`);
    }
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
}

/**
 * Boots the worker's in-memory SQLite database before the first test.
 *
 * @internal For tests only (the `@detour/db/testing` entry).
 */
export async function bootTestDb(): Promise<void> {
  shared ??= boot();
  await shared;
}

/**
 * An empty, fully migrated SQLite/D1-compatible database.
 *
 * @internal For tests only (the `@detour/db/testing` entry).
 */
export async function createTestDb(): Promise<Db> {
  shared ??= boot();
  const worker = await shared;
  resetSqlite(worker.sqlite);
  return worker.db;
}

/**
 * A database whose every query fails with `db_unavailable`, for testing outage handling.
 *
 * @internal For tests only (the `@detour/db/testing` entry).
 */
export function unreachableDb(): Db {
  return createUnreachableDb();
}
