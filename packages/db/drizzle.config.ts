/**
 * drizzle-kit config for Cloudflare D1 / SQLite. `pnpm -C packages/db generate` diffs
 * `src/schema` against the committed snapshots and writes a new SQL migration to `migrations/`.
 * Wrangler applies them to D1 (`pnpm -C apps/api db:migrate:local` / `db:migrate:remote`, via
 * `migrations_pattern` in apps/api/wrangler.jsonc); tests apply them to `node:sqlite`.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});
