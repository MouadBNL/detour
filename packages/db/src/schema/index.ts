/**
 * Every SQLite / Cloudflare D1 table. drizzle-kit reads this file (`drizzle.config.ts`)
 * to generate migrations into `packages/db/migrations/`.
 */
export {
  EXTENSION_TOKEN_HASH_UNIQUE,
  EXTENSION_TOKEN_PAIRING_UNIQUE,
  extensionTokens,
  PAIRING_DEVICE_CODE_HASH_UNIQUE,
  PAIRING_USER_CODE_UNIQUE,
  pairingSessions,
  type ExtensionTokenRow,
  type PairingSessionRow,
} from "./pairing.ts";
export { users, type UserRow } from "./users.ts";
