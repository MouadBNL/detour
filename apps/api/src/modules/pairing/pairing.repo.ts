import {
  EXTENSION_TOKEN_HASH_UNIQUE,
  EXTENSION_TOKEN_PAIRING_UNIQUE,
  extensionTokens,
  PAIRING_DEVICE_CODE_HASH_UNIQUE,
  PAIRING_USER_CODE_UNIQUE,
  pairingSessions,
  tryQuery,
  users,
  type Db,
  type ExtensionTokenRow,
  type PairingSessionRow,
  type QueryFailure,
  type UserRow,
} from "@detour/db";
import { err, ok, type Err, type Result } from "@detour/result";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { unavailable, unexpected, type Unavailable, type Unexpected } from "../../errors.ts";

export type CodeCollision = { readonly type: "code_collision" };

const otherwise = (failure: QueryFailure): Err<Unavailable | Unexpected> =>
  failure.type === "db_unavailable"
    ? unavailable("database_unavailable")
    : unexpected(failure.constraint);

export async function insertPairingSession(
  db: Db,
  row: {
    readonly deviceCodeHash: string;
    readonly userCode: string;
    readonly browser: string;
    readonly deviceName: string;
    readonly createdAt: Date;
    readonly expiresAt: Date;
  },
): Promise<Result<PairingSessionRow, CodeCollision | Unavailable | Unexpected>> {
  const inserted = await tryQuery(() =>
    db
      .insert(pairingSessions)
      .values({ id: crypto.randomUUID(), ...row, status: "pending" })
      .returning(),
  );
  if (!inserted.ok) {
    const failure = inserted.error;
    if (
      failure.type === "unique_violation" &&
      (failure.constraint === PAIRING_USER_CODE_UNIQUE ||
        failure.constraint === PAIRING_DEVICE_CODE_HASH_UNIQUE)
    ) {
      return err({ type: "code_collision" });
    }
    return otherwise(failure);
  }
  const [created] = inserted.value;
  return created === undefined
    ? unexpected("pairing_sessions: insert returned no row")
    : ok(created);
}

export async function findPairingByDeviceCodeHash(
  db: Db,
  deviceCodeHash: string,
): Promise<Result<PairingSessionRow | undefined, Unavailable | Unexpected>> {
  const rows = await tryQuery(() =>
    db
      .select()
      .from(pairingSessions)
      .where(eq(pairingSessions.deviceCodeHash, deviceCodeHash))
      .limit(1),
  );
  if (!rows.ok) return otherwise(rows.error);
  return ok(rows.value[0]);
}

export async function findPairingByUserCode(
  db: Db,
  userCode: string,
): Promise<Result<PairingSessionRow | undefined, Unavailable | Unexpected>> {
  const rows = await tryQuery(() =>
    db.select().from(pairingSessions).where(eq(pairingSessions.userCode, userCode)).limit(1),
  );
  if (!rows.ok) return otherwise(rows.error);
  return ok(rows.value[0]);
}

export async function decidePairingSession(
  db: Db,
  input: {
    readonly id: string;
    readonly decision: "approved" | "denied";
    readonly userId: string;
    readonly now: Date;
  },
): Promise<Result<PairingSessionRow | undefined, Unavailable | Unexpected>> {
  const updated = await tryQuery(() =>
    db
      .update(pairingSessions)
      .set({
        status: input.decision,
        userId: input.userId,
        approvedAt: input.decision === "approved" ? input.now : null,
      })
      .where(
        and(
          eq(pairingSessions.id, input.id),
          eq(pairingSessions.status, "pending"),
          gt(pairingSessions.expiresAt, input.now),
        ),
      )
      .returning(),
  );
  if (!updated.ok) return otherwise(updated.error);
  return ok(updated.value[0]);
}

/**
 * Redeems an approved, unexpired pairing into an extension token in one statement:
 * `INSERT INTO extension_tokens ... SELECT ... FROM pairing_sessions WHERE status = 'approved'`.
 * The insert is the commit point: before it nothing changed (a failure can be retried), after it
 * the token exists. The unique `pairing_session_id` makes a concurrent second redemption fail, so
 * a pairing yields at most one token. `undefined`: the pairing is no longer redeemable.
 */
export async function redeemPairing(
  db: Db,
  input: {
    readonly pairingId: string;
    readonly tokenHash: string;
    readonly scopes: readonly string[];
    readonly now: Date;
    readonly expiresAt: Date;
  },
): Promise<Result<ExtensionTokenRow | undefined, Unavailable | Unexpected>> {
  const redeemable = db
    .select({
      id: sql<string>`${crypto.randomUUID()}`.as("id"),
      userId: sql<string>`${pairingSessions.userId}`.as("user_id"),
      pairingSessionId: pairingSessions.id,
      tokenHash: sql<string>`${input.tokenHash}`.as("token_hash"),
      browser: pairingSessions.browser,
      deviceName: pairingSessions.deviceName,
      scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as("scopes"),
      createdAt: sql<Date>`${input.now.getTime()}`.as("created_at"),
      expiresAt: sql<Date>`${input.expiresAt.getTime()}`.as("expires_at"),
    })
    .from(pairingSessions)
    .where(
      and(
        eq(pairingSessions.id, input.pairingId),
        eq(pairingSessions.status, "approved"),
        gt(pairingSessions.expiresAt, input.now),
        isNotNull(pairingSessions.userId),
      ),
    );
  const inserted = await tryQuery(() => db.insert(extensionTokens).select(redeemable).returning());
  if (!inserted.ok) {
    const failure = inserted.error;
    if (
      failure.type === "unique_violation" &&
      failure.constraint === EXTENSION_TOKEN_PAIRING_UNIQUE
    ) {
      return ok(undefined);
    }
    if (failure.type === "unique_violation" && failure.constraint === EXTENSION_TOKEN_HASH_UNIQUE) {
      return unexpected("extension_tokens: token hash collision");
    }
    return otherwise(failure);
  }
  return ok(inserted.value[0]);
}

/**
 * Marks a redeemed pairing `consumed` (bookkeeping for `lookup`/`poll`). Redemption itself is
 * guarded by the unique `pairing_session_id`, so a failure here never allows a second token.
 */
export async function markPairingConsumed(
  db: Db,
  id: string,
  now: Date,
): Promise<Result<void, Unavailable | Unexpected>> {
  const updated = await tryQuery(() =>
    db
      .update(pairingSessions)
      .set({ status: "consumed", consumedAt: now })
      .where(and(eq(pairingSessions.id, id), eq(pairingSessions.status, "approved"))),
  );
  return updated.ok ? ok() : otherwise(updated.error);
}

export async function findUserById(
  db: Db,
  userId: string,
): Promise<Result<UserRow | undefined, Unavailable | Unexpected>> {
  const rows = await tryQuery(() => db.select().from(users).where(eq(users.id, userId)).limit(1));
  if (!rows.ok) return otherwise(rows.error);
  return ok(rows.value[0]);
}

export async function listActiveExtensionTokens(
  db: Db,
  userId: string,
  now: Date,
): Promise<Result<readonly ExtensionTokenRow[], Unavailable | Unexpected>> {
  const rows = await tryQuery(() =>
    db
      .select()
      .from(extensionTokens)
      .where(
        and(
          eq(extensionTokens.userId, userId),
          isNull(extensionTokens.revokedAt),
          gt(extensionTokens.expiresAt, now),
        ),
      )
      .orderBy(desc(extensionTokens.createdAt)),
  );
  if (!rows.ok) return otherwise(rows.error);
  return ok(rows.value);
}

export async function revokeExtensionToken(
  db: Db,
  input: { readonly tokenId: string; readonly userId: string; readonly now: Date },
): Promise<Result<ExtensionTokenRow | undefined, Unavailable | Unexpected>> {
  const updated = await tryQuery(() =>
    db
      .update(extensionTokens)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(extensionTokens.id, input.tokenId),
          eq(extensionTokens.userId, input.userId),
          isNull(extensionTokens.revokedAt),
        ),
      )
      .returning(),
  );
  if (!updated.ok) return otherwise(updated.error);
  return ok(updated.value[0]);
}
