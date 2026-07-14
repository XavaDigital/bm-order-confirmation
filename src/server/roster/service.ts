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
import { orders, rosterMembers, rosterAccess, rosterMemberAccess } from '@/db/schema';
import { generateToken, hashToken, buildRosterUrl, buildMemberRosterUrl } from '@/lib/tokens';
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

export async function getRosterMember(orderId: string, memberId: string) {
  const member = await db.query.rosterMembers.findFirst({ where: eq(rosterMembers.id, memberId) });
  if (!member || member.orderId !== orderId) throw new NotFoundError('Team member');
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

export type DuplicateResolution = 'importAll' | 'skipAmbiguous';

export interface AmbiguousDuplicate {
  name: string;
  existingNumber: string | null;
  existingEmail: string | null;
  newNumber: string | null;
  newEmail: string | null;
}

export interface ImportRosterResult {
  imported: number;
  skippedBlank: number;
  skippedDuplicate: number;
  skippedAmbiguous: number;
  members: (typeof rosterMembers.$inferSelect)[];
  /** True when ambiguous same-name rows were found and no resolution was given yet — nothing was inserted. */
  needsConfirmation?: boolean;
  ambiguousDuplicates?: AmbiguousDuplicate[];
}

interface SeenEntry {
  playerNumber: string | null;
  email: string | null;
}

/** Same non-blank number or same non-blank email (case-insensitive) counts as a confirmed match. */
function fieldsMatch(a: SeenEntry, b: SeenEntry): boolean {
  const numberMatch = !!a.playerNumber && !!b.playerNumber && a.playerNumber.toLowerCase() === b.playerNumber.toLowerCase();
  const emailMatch = !!a.email && !!b.email && a.email.toLowerCase() === b.email.toLowerCase();
  return numberMatch || emailMatch;
}

/**
 * Bulk-insert roster members from parsed sheet rows. Skips rows with no name in
 * the mapped column — never fails the whole import over one bad row.
 *
 * Dedupe is name-based (case-insensitive) but a same-name row is only treated as
 * a confirmed duplicate (auto-skipped) when its number or email also matches —
 * two real teammates can share a name. When a same-name row's other details
 * differ (or there's nothing else to compare), it's "ambiguous": if `resolution`
 * isn't given yet, nothing is inserted and the ambiguous rows are returned for
 * the caller to show staff and ask; the caller re-calls with `resolution` set to
 * finish the import.
 */
export async function importRosterMembers(
  orderId: string,
  rows: string[][],
  mapping: RosterImportMapping,
  resolution?: DuplicateResolution,
): Promise<ImportRosterResult> {
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new NotFoundError('Order');

  const existing = await db.query.rosterMembers.findMany({
    where: eq(rosterMembers.orderId, orderId),
    columns: { name: true, playerNumber: true, email: true },
  });

  const seen = new Map<string, SeenEntry[]>();
  for (const m of existing) {
    const key = m.name.trim().toLowerCase();
    seen.set(key, [...(seen.get(key) ?? []), { playerNumber: m.playerNumber, email: m.email }]);
  }

  let skippedBlank = 0;
  let skippedDuplicate = 0;
  let skippedAmbiguous = 0;
  const ambiguous: AmbiguousDuplicate[] = [];
  const accepted: { name: string; entry: SeenEntry }[] = [];

  for (const row of rows) {
    const name = (row[mapping.nameColumn] ?? '').trim();
    if (!name) {
      skippedBlank++;
      continue;
    }

    const rawNumber = mapping.playerNumberColumn !== null ? (row[mapping.playerNumberColumn] ?? '').trim() : '';
    const rawEmail = mapping.emailColumn !== null ? (row[mapping.emailColumn] ?? '').trim() : '';
    const entry: SeenEntry = {
      playerNumber: rawNumber || null,
      email: EMAIL_LIKE.test(rawEmail) ? rawEmail : null,
    };

    const key = name.toLowerCase();
    const priorMatches = seen.get(key) ?? [];
    const confirmedDuplicate = priorMatches.some((p) => fieldsMatch(p, entry));

    if (confirmedDuplicate) {
      skippedDuplicate++;
      continue;
    }

    if (priorMatches.length > 0) {
      // Same name, but nothing else confirms it's the same person.
      if (resolution === 'importAll') {
        accepted.push({ name, entry });
        seen.set(key, [...priorMatches, entry]);
      } else if (resolution === 'skipAmbiguous') {
        skippedAmbiguous++;
      } else {
        ambiguous.push({
          name,
          existingNumber: priorMatches[0].playerNumber,
          existingEmail: priorMatches[0].email,
          newNumber: entry.playerNumber,
          newEmail: entry.email,
        });
      }
      continue;
    }

    accepted.push({ name, entry });
    seen.set(key, [entry]);
  }

  // Ambiguity found and not yet resolved — insert nothing, ask the caller to confirm first.
  if (ambiguous.length > 0 && !resolution) {
    return {
      imported: 0,
      skippedBlank: 0,
      skippedDuplicate: 0,
      skippedAmbiguous: 0,
      members: [],
      needsConfirmation: true,
      ambiguousDuplicates: ambiguous,
    };
  }

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${rosterMembers.sortOrder}), -1)` })
    .from(rosterMembers)
    .where(eq(rosterMembers.orderId, orderId));

  let sortOrder = Number(maxSort) + 1;
  const toInsert: (typeof rosterMembers.$inferInsert)[] = accepted.map(({ name, entry }) => ({
    orderId,
    name,
    playerNumber: entry.playerNumber,
    email: entry.email,
    sortOrder: sortOrder++,
  }));

  const members = toInsert.length > 0 ? await db.insert(rosterMembers).values(toInsert).returning() : [];

  await recordAuditEvent({
    aggregateId: orderId,
    eventType: 'roster.import_completed',
    payload: { imported: members.length, skippedBlank, skippedDuplicate, skippedAmbiguous },
  });

  return { imported: members.length, skippedBlank, skippedDuplicate, skippedAmbiguous, members };
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

// ---------------------------------------------------------------------------
// Admin writes — per-member individual link (v2, TEAM_ROSTER_PLAN.md Phase 9)
//
// Unlike the shared roster link, a member token isn't minted speculatively at
// member-creation time — the raw value is only ever usable once, right after
// minting, so it's generated on demand: when staff copy one member's link, or
// when the bulk "email everyone their individual link" action sends it. This
// keeps roster_member_access free of tokens whose one-time raw value was
// never captured or used.
// ---------------------------------------------------------------------------

export async function generateMemberToken(
  memberId: string,
  meta?: { actorEmail?: string },
): Promise<{ token: string; url: string }> {
  const member = await db.query.rosterMembers.findFirst({ where: eq(rosterMembers.id, memberId) });
  if (!member) throw new NotFoundError('Team member');

  const rawToken = generateToken();

  await db.transaction(async (tx) => {
    // Revoke any existing active link for this member only — never touches
    // the shared roster_access link or other members' tokens.
    await tx
      .update(rosterMemberAccess)
      .set({ revokedAt: new Date() })
      .where(and(eq(rosterMemberAccess.rosterMemberId, memberId), isNull(rosterMemberAccess.revokedAt)));

    await tx.insert(rosterMemberAccess).values({
      rosterMemberId: memberId,
      tokenHash: hashToken(rawToken),
      expiresAt: computeAccessExpiry(),
    });

    await emitDomainEvent(tx, {
      aggregateId: member.orderId,
      eventType: 'roster.member_link_generated',
      payload: { memberId, name: member.name, actorEmail: meta?.actorEmail ?? null },
    });
  });

  return { token: rawToken, url: buildMemberRosterUrl(rawToken) };
}
