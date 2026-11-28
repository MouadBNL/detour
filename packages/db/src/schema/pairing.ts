import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./users.ts";

export const PAIRING_DEVICE_CODE_HASH_UNIQUE = "pairing_sessions.device_code_hash";
export const PAIRING_USER_CODE_UNIQUE = "pairing_sessions.user_code";
export const EXTENSION_TOKEN_HASH_UNIQUE = "extension_tokens.token_hash";
export const EXTENSION_TOKEN_PAIRING_UNIQUE = "extension_tokens.pairing_session_id";

export const pairingSessions = sqliteTable(
  "pairing_sessions",
  {
    id: text("id").primaryKey(),
    deviceCodeHash: text("device_code_hash").notNull(),
    userCode: text("user_code").notNull(),
    browser: text("browser").notNull(),
    deviceName: text("device_name").notNull(),
    status: text("status").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("pairing_sessions_device_code_hash_unique").on(table.deviceCodeHash),
    uniqueIndex("pairing_sessions_user_code_unique").on(table.userCode),
    index("pairing_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const extensionTokens = sqliteTable(
  "extension_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The pairing this token redeemed. Unique: a pairing yields at most one token, so a second
     * concurrent poll fails here instead of minting another. Null once the pairing row is
     * cleaned up (`set null`, so cleaning up pairings never revokes devices).
     */
    pairingSessionId: text("pairing_session_id").references(() => pairingSessions.id, {
      onDelete: "set null",
    }),
    tokenHash: text("token_hash").notNull(),
    browser: text("browser").notNull(),
    deviceName: text("device_name").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("extension_tokens_token_hash_unique").on(table.tokenHash),
    uniqueIndex("extension_tokens_pairing_session_id_unique").on(table.pairingSessionId),
    index("extension_tokens_user_id_idx").on(table.userId),
  ],
);

export type PairingSessionRow = typeof pairingSessions.$inferSelect;
export type ExtensionTokenRow = typeof extensionTokens.$inferSelect;
