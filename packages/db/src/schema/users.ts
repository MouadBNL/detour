import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Local projection of WorkOS AuthKit users, keyed by WorkOS `user.id` (e.g. `user_01...`).
 * Upserted on AuthKit sign-in so `pairing_sessions`, `extension_tokens`, and `credit_ledger`
 * enforce foreign keys cleanly inside Cloudflare D1 / SQLite. `email` is not unique here: WorkOS
 * owns it, and a user recreated there (new id, same email) must still be able to sign in.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type UserRow = typeof users.$inferSelect;
