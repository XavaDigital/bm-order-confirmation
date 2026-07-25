/**
 * Shared magic-link token machinery for the three access tables
 * (order_access, roster_access, roster_member_access). All three are built
 * from the same `accessTokenColumns()` DDL in src/db/schema.ts — tokenHash /
 * revokedAt / expiresAt behave identically — so lookup, revoke, and mint live
 * here once instead of being re-implemented per surface.
 *
 * Raw tokens are hashed at rest (SHA-256 + pepper, src/lib/tokens.ts); the
 * raw value is only ever returned once, by whoever generated it.
 */
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { db, type Transaction } from '@/db';
import { orderAccess, rosterAccess, rosterMemberAccess } from '@/db/schema';
import { hashToken } from '@/lib/tokens';
import { env } from '@/lib/env';

type Db = typeof db;
export type AccessTable = typeof orderAccess | typeof rosterAccess | typeof rosterMemberAccess;

/** Null when `LINK_EXPIRY_DAYS` is unset — links never expire. */
export function computeAccessExpiry(): Date | null {
  return env.LINK_EXPIRY_DAYS ? new Date(Date.now() + env.LINK_EXPIRY_DAYS * 86_400_000) : null;
}

// The internal casts to `typeof orderAccess` below are safe: the columns these
// helpers touch are identical across the union (same accessTokenColumns()).

/**
 * The non-revoked, non-expired access row matching a raw token, or null.
 * Every token-gated customer entry point resolves through this.
 */
export async function resolveActiveToken<T extends AccessTable>(
  table: T,
  rawToken: string,
): Promise<T['$inferSelect'] | null> {
  const [access] = await db
    .select()
    .from(table as typeof orderAccess)
    .where(and(eq(table.tokenHash, hashToken(rawToken)), isNull(table.revokedAt)))
    .limit(1);
  if (!access) return null;
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) return null;
  return access as T['$inferSelect'];
}

/** Revoke every active token within a scope (e.g. one order, one member). */
export async function revokeActiveTokens(
  executor: Db | Transaction,
  table: AccessTable,
  scope: SQL,
): Promise<void> {
  await executor
    .update(table as typeof orderAccess)
    .set({ revokedAt: new Date() })
    .where(and(scope, isNull(table.revokedAt)));
}

/**
 * Insert a new access row for an already-generated raw token. `scopeValues`
 * carries the owning id (orderId / rosterMemberId) plus any table-specific
 * extras (e.g. a carried-over accessCodeHash).
 */
export async function insertToken(
  executor: Db | Transaction,
  table: AccessTable,
  rawToken: string,
  scopeValues: Record<string, unknown>,
): Promise<void> {
  await executor.insert(table as typeof orderAccess).values({
    ...scopeValues,
    tokenHash: hashToken(rawToken),
    expiresAt: computeAccessExpiry(),
  } as typeof orderAccess.$inferInsert);
}

/** Replace a scope's active token: revoke all active, insert the new one. */
export async function mintToken(
  executor: Db | Transaction,
  table: AccessTable,
  rawToken: string,
  scope: SQL,
  scopeValues: Record<string, unknown>,
): Promise<void> {
  await revokeActiveTokens(executor, table, scope);
  await insertToken(executor, table, rawToken, scopeValues);
}
