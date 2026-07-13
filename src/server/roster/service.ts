/**
 * Team roster service — staff-side roster management (TEAM_ROSTER_PLAN.md Phase 2).
 *
 * Staff manage roster membership and the shared roster link here. Team
 * members submit their own sizes via src/server/roster/customer-service.ts
 * (added in a later phase), writing ordinary garment_sizing rows tagged with
 * roster_member_id — they coexist with staff-entered sizing with no conflict.
 *
 * Locking/unlocking the roster lives in src/server/orders/service.ts instead
 * of here, because it writes the `orders` row directly and that module is the
 * only place order rows are mutated (CLAUDE.md).
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orders, rosterMembers, rosterAccess } from '@/db/schema';
import { generateToken, hashToken, buildRosterUrl } from '@/lib/tokens';
import { computeAccessExpiry, NotFoundError } from '@/server/orders/service';
import { emitDomainEvent, recordAuditEvent } from '@/server/events/outbox';
import type { AddRosterMemberInput, UpdateRosterMemberInput, RosterImportMapping } from './contract';

// Loose check only — imported spreadsheet cells are messy free text, not a trust
// boundary; an unparsable value is simply dropped to null rather than rejected.
const EMAIL_LIKE = /\S+@\S+\.\S+/;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getRoster(orderId: string) {
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new NotFoundError('Order');

  const members = await db.query.rosterMembers.findMany({
    where: eq(rosterMembers.orderId, orderId),
    orderBy: [asc(rosterMembers.sortOrder), asc(rosterMembers.createdAt)],
    with: { sizing: true },
  });

  const currentAccess = await db.query.rosterAccess.findFirst({
    where: and(eq(rosterAccess.orderId, orderId), isNull(rosterAccess.revokedAt)),
    orderBy: [desc(rosterAccess.createdAt)],
  });

  const submitted = members.filter((m) => m.submittedAt !== null).length;

  return {
    members,
    currentAccess: currentAccess ?? null,
    stats: { total: members.length, submitted },
    locked: order.rosterLockedAt !== null,
  };
}

// ---------------------------------------------------------------------------
// Admin writes — members
// ---------------------------------------------------------------------------

export async function addRosterMember(orderId: string, data: AddRosterMemberInput) {
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new NotFoundError('Order');

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${rosterMembers.sortOrder}), -1)` })
    .from(rosterMembers)
    .where(eq(rosterMembers.orderId, orderId));

  const [member] = await db
    .insert(rosterMembers)
    .values({
      orderId,
      name: data.name,
      playerNumber: data.playerNumber ?? null,
      email: data.email ?? null,
      sortOrder: Number(maxSort) + 1,
    })
    .returning();

  await recordAuditEvent({
    aggregateId: orderId,
    eventType: 'roster.member_added',
    payload: { memberId: member.id, name: member.name },
  });

  return member;
}

export async function updateRosterMember(memberId: string, patch: UpdateRosterMemberInput) {
  const existing = await db.query.rosterMembers.findFirst({ where: eq(rosterMembers.id, memberId) });
  if (!existing) throw new NotFoundError('Roster member');

  await db.update(rosterMembers).set({
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.playerNumber !== undefined && { playerNumber: patch.playerNumber }),
    ...(patch.email !== undefined && { email: patch.email }),
  }).where(eq(rosterMembers.id, memberId));
}

export async function removeRosterMember(memberId: string) {
  const existing = await db.query.rosterMembers.findFirst({ where: eq(rosterMembers.id, memberId) });
  if (!existing) throw new NotFoundError('Roster member');

  // Cascades the member's garment_sizing rows via the FK.
  await db.delete(rosterMembers).where(eq(rosterMembers.id, memberId));

  await recordAuditEvent({
    aggregateId: existing.orderId,
    eventType: 'roster.member_removed',
    payload: { memberId, name: existing.name },
  });
}

// ---------------------------------------------------------------------------
// Admin writes — bulk import (CSV/XLSX, see src/server/roster/import.ts)
// ---------------------------------------------------------------------------

export interface ImportRosterResult {
  imported: number;
  skippedBlank: number;
  skippedDuplicate: number;
  members: (typeof rosterMembers.$inferSelect)[];
}

/**
 * Bulk-insert roster members from parsed sheet rows. Dedupes case-insensitively
 * against both existing members and other rows in the same file, and skips rows
 * with no name in the mapped column — never fails the whole import over one bad row.
 */
export async function importRosterMembers(
  orderId: string,
  rows: string[][],
  mapping: RosterImportMapping,
): Promise<ImportRosterResult> {
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new NotFoundError('Order');

  const existing = await db.query.rosterMembers.findMany({
    where: eq(rosterMembers.orderId, orderId),
    columns: { name: true },
  });
  const seenNames = new Set(existing.map((m) => m.name.trim().toLowerCase()));

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${rosterMembers.sortOrder}), -1)` })
    .from(rosterMembers)
    .where(eq(rosterMembers.orderId, orderId));

  let sortOrder = Number(maxSort) + 1;
  let skippedBlank = 0;
  let skippedDuplicate = 0;
  const toInsert: (typeof rosterMembers.$inferInsert)[] = [];

  for (const row of rows) {
    const name = (row[mapping.nameColumn] ?? '').trim();
    if (!name) {
      skippedBlank++;
      continue;
    }

    const key = name.toLowerCase();
    if (seenNames.has(key)) {
      skippedDuplicate++;
      continue;
    }
    seenNames.add(key);

    const rawNumber = mapping.playerNumberColumn !== null ? (row[mapping.playerNumberColumn] ?? '').trim() : '';
    const rawEmail = mapping.emailColumn !== null ? (row[mapping.emailColumn] ?? '').trim() : '';

    toInsert.push({
      orderId,
      name,
      playerNumber: rawNumber || null,
      email: EMAIL_LIKE.test(rawEmail) ? rawEmail : null,
      sortOrder: sortOrder++,
    });
  }

  const members = toInsert.length > 0 ? await db.insert(rosterMembers).values(toInsert).returning() : [];

  await recordAuditEvent({
    aggregateId: orderId,
    eventType: 'roster.import_completed',
    payload: { imported: members.length, skippedBlank, skippedDuplicate },
  });

  return { imported: members.length, skippedBlank, skippedDuplicate, members };
}

// ---------------------------------------------------------------------------
// Admin writes — shared roster link
// ---------------------------------------------------------------------------

export async function generateRosterToken(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<{ token: string; url: string }> {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!existing) throw new NotFoundError('Order');

  const rawToken = generateToken();

  await db.transaction(async (tx) => {
    // Revoke any existing active roster link — never touches order_access.
    await tx
      .update(rosterAccess)
      .set({ revokedAt: new Date() })
      .where(and(eq(rosterAccess.orderId, orderId), isNull(rosterAccess.revokedAt)));

    await tx.insert(rosterAccess).values({
      orderId,
      tokenHash: hashToken(rawToken),
      expiresAt: computeAccessExpiry(),
    });

    await emitDomainEvent(tx, {
      aggregateId: orderId,
      eventType: 'roster.token_generated',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });

  return { token: rawToken, url: buildRosterUrl(rawToken) };
}

export async function revokeRosterToken(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(rosterAccess)
      .set({ revokedAt: new Date() })
      .where(and(eq(rosterAccess.orderId, orderId), isNull(rosterAccess.revokedAt)));

    await emitDomainEvent(tx, {
      aggregateId: orderId,
      eventType: 'roster.token_revoked',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });
}
