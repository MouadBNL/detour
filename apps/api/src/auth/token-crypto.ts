import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Unambiguous Crockford-like alphabet (no 0/O/1/I) for human-verifiable pairing codes. */
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const EXTENSION_TOKEN_PREFIX = "dtr_";

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

export function generateExtensionToken(): string {
  return `${EXTENSION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function generateUserCode(): string {
  const bytes = randomBytes(8);
  let raw = "";
  for (const byte of bytes) {
    const index = byte % USER_CODE_ALPHABET.length;
    raw += USER_CODE_ALPHABET[index] ?? "A";
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function normalizeUserCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Constant-time equality of two secrets of any length (compares their SHA-256 digests). */
export function secretsEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
