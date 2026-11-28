import { EXTENSION_SCOPES, ExtensionScopeSchema, PairingBrowserSchema } from "@detour/contracts";
import type { ExtensionTokenRow, PairingSessionRow } from "@detour/db";
import { err, ok, type Result } from "@detour/result";
import * as z from "zod";
import {
  generateDeviceCode,
  generateExtensionToken,
  generateUserCode,
  hashSecret,
  normalizeUserCode,
} from "../../auth/token-crypto.ts";
import type { Context, WebSignedInContext } from "../../context.ts";
import {
  notFound,
  unexpected,
  type NotFound,
  type Unavailable,
  type Unexpected,
} from "../../errors.ts";
import {
  decidePairingSession,
  findPairingByDeviceCodeHash,
  findPairingByUserCode,
  findUserById,
  insertPairingSession,
  listActiveExtensionTokens,
  markPairingConsumed,
  redeemPairing,
  revokeExtensionToken,
} from "./pairing.repo.ts";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const EXTENSION_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;
const MAX_CODE_ATTEMPTS = 5;

const PairingStatusSchema = z.enum(["pending", "approved", "consumed", "denied"]);
type Browser = z.infer<typeof PairingBrowserSchema>;
type Scope = z.infer<typeof ExtensionScopeSchema>;

export type PairingConflictError = { readonly type: "already_decided" | "expired" };

function parseBrowser(raw: string): Browser {
  const parsed = PairingBrowserSchema.safeParse(raw);
  return parsed.success ? parsed.data : "other";
}

function parseScopes(raw: readonly string[]): Scope[] {
  const scopes: Scope[] = [];
  for (const item of raw) {
    const parsed = ExtensionScopeSchema.safeParse(item);
    if (parsed.success) scopes.push(parsed.data);
  }
  return scopes;
}

function effectiveStatus(
  row: PairingSessionRow,
  now: Date,
): "pending" | "approved" | "consumed" | "denied" | "expired" {
  const parsed = PairingStatusSchema.safeParse(row.status);
  const status = parsed.success ? parsed.data : "denied";
  if ((status === "pending" || status === "approved") && row.expiresAt <= now) return "expired";
  return status;
}

export async function startPairing(
  context: Pick<Context, "db" | "now">,
  input: { readonly browser: Browser; readonly deviceName: string },
): Promise<
  Result<
    {
      readonly deviceCode: string;
      readonly userCode: string;
      readonly verificationPath: string;
      readonly expiresAt: Date;
      readonly pollIntervalMs: number;
    },
    Unavailable | Unexpected
  >
> {
  const createdAt = context.now();
  const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_MS);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const inserted = await insertPairingSession(context.db, {
      deviceCodeHash: hashSecret(deviceCode),
      userCode,
      browser: input.browser,
      deviceName: input.deviceName,
      createdAt,
      expiresAt,
    });
    if (inserted.ok) {
      return ok({
        deviceCode,
        userCode,
        verificationPath: `/pair?code=${encodeURIComponent(userCode)}`,
        expiresAt,
        pollIntervalMs: POLL_INTERVAL_MS,
      });
    }
    if (inserted.error.type !== "code_collision") return err(inserted.error);
  }
  return unexpected("pairing_sessions: failed to generate unique pairing code");
}

async function issueTokenForPairing(
  context: Pick<Context, "db" | "now">,
  row: PairingSessionRow,
): Promise<
  Result<
    {
      readonly status: "approved";
      readonly accessToken: string;
      readonly tokenId: string;
      readonly expiresAt: Date;
      readonly scopes: Scope[];
      readonly user: { readonly id: string; readonly email: string; readonly name: string };
    },
    NotFound | Unavailable | Unexpected
  >
> {
  const now = context.now();
  if (row.userId === null) return unexpected("pairing_sessions: approved session missing userId");
  // Read before redeeming, so a failure here leaves the pairing redeemable on the next poll.
  const owner = await findUserById(context.db, row.userId);
  if (!owner.ok) return owner;
  if (owner.value === undefined) return notFound();

  const accessToken = generateExtensionToken();
  const tokenExpiresAt = new Date(now.getTime() + EXTENSION_TOKEN_TTL_MS);
  const scopes: Scope[] = [...EXTENSION_SCOPES];
  const created = await redeemPairing(context.db, {
    pairingId: row.id,
    tokenHash: hashSecret(accessToken),
    scopes,
    now,
    expiresAt: tokenExpiresAt,
  });
  if (!created.ok) return created;
  if (created.value === undefined) return notFound();
  // Bookkeeping only (see `markPairingConsumed`): the token exists, so return it even if this fails.
  await markPairingConsumed(context.db, row.id, now);

  return ok({
    status: "approved",
    accessToken,
    tokenId: created.value.id,
    expiresAt: tokenExpiresAt,
    scopes,
    user: { id: owner.value.id, email: owner.value.email, name: owner.value.name },
  });
}

export async function pollPairing(
  context: Pick<Context, "db" | "now">,
  input: { readonly deviceCode: string },
): Promise<
  Result<
    | { readonly status: "pending"; readonly expiresAt: Date }
    | { readonly status: "expired" }
    | { readonly status: "denied" }
    | {
        readonly status: "approved";
        readonly accessToken: string;
        readonly tokenId: string;
        readonly expiresAt: Date;
        readonly scopes: Scope[];
        readonly user: { readonly id: string; readonly email: string; readonly name: string };
      },
    NotFound | Unavailable | Unexpected
  >
> {
  const found = await findPairingByDeviceCodeHash(context.db, hashSecret(input.deviceCode));
  if (!found.ok) return found;
  if (found.value === undefined) return notFound();

  const status = effectiveStatus(found.value, context.now());
  if (status === "pending") return ok({ status: "pending", expiresAt: found.value.expiresAt });
  if (status === "expired") return ok({ status: "expired" });
  if (status === "denied") return ok({ status: "denied" });
  if (status === "consumed") return notFound();
  return issueTokenForPairing(context, found.value);
}

export async function lookupPairing(
  context: Pick<WebSignedInContext, "db" | "now">,
  input: { readonly userCode: string },
): Promise<
  Result<
    {
      readonly userCode: string;
      readonly browser: Browser;
      readonly deviceName: string;
      readonly status: "pending" | "approved" | "consumed" | "denied" | "expired";
      readonly expiresAt: Date;
    },
    NotFound | Unavailable | Unexpected
  >
> {
  const found = await findPairingByUserCode(context.db, normalizeUserCode(input.userCode));
  if (!found.ok) return found;
  if (found.value === undefined) return notFound();

  return ok({
    userCode: found.value.userCode,
    browser: parseBrowser(found.value.browser),
    deviceName: found.value.deviceName,
    status: effectiveStatus(found.value, context.now()),
    expiresAt: found.value.expiresAt,
  });
}

export async function decidePairing(
  context: Pick<WebSignedInContext, "db" | "now" | "user">,
  input: { readonly userCode: string; readonly decision: "approved" | "denied" },
): Promise<
  Result<
    { readonly status: "approved" | "denied" },
    PairingConflictError | NotFound | Unavailable | Unexpected
  >
> {
  const found = await findPairingByUserCode(context.db, normalizeUserCode(input.userCode));
  if (!found.ok) return found;
  if (found.value === undefined) return notFound();

  const status = effectiveStatus(found.value, context.now());
  if (status === "expired") return err({ type: "expired" });
  if (status !== "pending") return err({ type: "already_decided" });

  const decided = await decidePairingSession(context.db, {
    id: found.value.id,
    decision: input.decision,
    userId: context.user.id,
    now: context.now(),
  });
  if (!decided.ok) return decided;
  if (decided.value === undefined) return err({ type: "already_decided" });

  return ok({ status: input.decision });
}

function toPairedDevice(row: ExtensionTokenRow) {
  return {
    id: row.id,
    browser: parseBrowser(row.browser),
    deviceName: row.deviceName,
    scopes: parseScopes(row.scopes),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function listPairedDevices(
  context: Pick<WebSignedInContext, "db" | "now" | "user">,
): Promise<Result<ReturnType<typeof toPairedDevice>[], Unavailable | Unexpected>> {
  const rows = await listActiveExtensionTokens(context.db, context.user.id, context.now());
  if (!rows.ok) return rows;
  return ok(rows.value.map(toPairedDevice));
}

export async function revokePairedDevice(
  context: Pick<WebSignedInContext, "db" | "now" | "user">,
  input: { readonly tokenId: string },
): Promise<Result<{ readonly revoked: true }, NotFound | Unavailable | Unexpected>> {
  const revoked = await revokeExtensionToken(context.db, {
    tokenId: input.tokenId,
    userId: context.user.id,
    now: context.now(),
  });
  if (!revoked.ok) return revoked;
  if (revoked.value === undefined) return notFound();
  return ok({ revoked: true });
}
