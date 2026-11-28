export { createD1Db, type D1Binding, type Db } from "./d1.ts";
export {
  tryQuery,
  type ConstraintViolation,
  type DbUnavailable,
  type QueryFailure,
} from "./query.adapter.ts";
export {
  EXTENSION_TOKEN_HASH_UNIQUE,
  EXTENSION_TOKEN_PAIRING_UNIQUE,
  extensionTokens,
  PAIRING_DEVICE_CODE_HASH_UNIQUE,
  PAIRING_USER_CODE_UNIQUE,
  pairingSessions,
  users,
  type ExtensionTokenRow,
  type PairingSessionRow,
  type UserRow,
} from "./schema/index.ts";
