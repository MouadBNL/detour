/**
 * The production driver: Drizzle over a Cloudflare D1 binding. Zero Node built-ins, so everything
 * the package root exports bundles for workerd (`wrangler dev` / `wrangler deploy`).
 */
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";

/** Async SQLite database: Cloudflare D1 in dev and prod, `node:sqlite` in tests. */
export type Db = SQLiteAsyncDatabase<"async", unknown>;

/** Cloudflare D1 binding type accepted by `createD1Db`. */
export type D1Binding = D1Database;

/** Wraps a Cloudflare Worker D1 binding (`env.DB`) in Drizzle. */
export function createD1Db(d1: D1Binding): Db {
  return drizzle(d1);
}
