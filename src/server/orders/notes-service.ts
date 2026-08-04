/**
 * Order notes — the staff conversation on an order, and on a single garment of
 * it.
 *
 * These are a chat, not a log: every note carries a real author, an edit
 * timestamp, and a soft delete, so the thread reads as something people said to
 * each other. `audit_events` remains the place where *actions* are recorded.
 *
 * Sanitisation happens HERE rather than in the route, because this is the layer
 * every writer goes through — the admin routes, the inbound capability surface,
 * and anything added later. A route-level sanitiser would be one `import` away
 * from being skipped.
 */
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { orderNotes } from '@/db/schema';
import { htmlToPlainText, isNoteEmpty, sanitizeNoteHtml } from '@/lib/rich-text';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { ConflictError, NotFoundError } from './service';
import { assertGarmentBelongsToOrder, assertOrderExists } from './guards';

type ActorMeta = {
  actorEmail?: string | null;
  actorStaffUserId?: string | null;
  /** Admins may edit and delete anyone's note; everyone else only their own. */
  isAdmin?: boolean;
};

/** Which thread to read. */
export type NoteScope = 'order' | 'all' | { garmentId: string };

export interface OrderNoteDto {
  id: string;
  orderId: string;
  garmentId: string | null;
  garmentName: string | null;
  /** Sanitised HTML when the note came from the editor, else null. */
  bodyHtml: string | null;
  /** Plain text — always present, and what to show if `bodyHtml` is null. */
  body: string;
  /** 'comment' = the discussion thread; 'note' = an order note (finalisation point). */
  kind: 'comment' | 'note';
  authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
  authorName: string | null;
  authorEmail: string | null;
  /**
   * The raw label as stored. Kept on the DTO because the inbound capability
   * route returns this shape to Email Flow, which reads `authorLabel` — dropping
   * it in favour of the resolved `authorEmail` would break that integration.
   */
  authorLabel: string | null;
  authorStaffUserId: string | null;
  /** 'shared' notes are visible on the token-gated supplier portal. */
  visibility: 'internal' | 'shared';
  createdAt: Date;
  updatedAt: Date;
  edited: boolean;
  deleted: boolean;
}

type NoteRow = typeof orderNotes.$inferSelect & {
  garment?: { id: string; name: string } | null;
  author?: { id: string; name: string | null; email: string } | null;
};

/**
 * Project a row for the client. A deleted note keeps its place in the thread but
 * loses its content here, in the mapper, so no caller can render it by mistake.
 */
function toNoteDto(row: NoteRow): OrderNoteDto {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    orderId: row.orderId,
    garmentId: row.garmentId ?? null,
    garmentName: row.garment?.name ?? null,
    bodyHtml: deleted ? null : (row.bodyHtml ?? null),
    body: deleted ? '' : row.body,
    kind: row.kind,
    authorKind: row.authorKind,
    authorName: row.author?.name ?? null,
    authorEmail: row.author?.email ?? row.authorLabel ?? null,
    authorLabel: row.authorLabel ?? null,
    authorStaffUserId: row.authorStaffUserId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Compared with a second of slack: `updatedAt` defaults to now() alongside
    // `createdAt`, so identical writes can land a few milliseconds apart.
    edited: !deleted && row.updatedAt.getTime() - row.createdAt.getTime() > 1000,
    deleted,
  };
}

function scopeFilter(orderId: string, scope: NoteScope) {
  const onOrder = eq(orderNotes.orderId, orderId);
  if (scope === 'all') return onOrder;
  if (scope === 'order') return and(onOrder, isNull(orderNotes.garmentId));
  return and(onOrder, eq(orderNotes.garmentId, scope.garmentId));
}

/**
 * Read a thread, oldest first — chat order, so the newest message is at the
 * bottom where the composer is.
 *
 * `visibility: 'shared'` scopes to notes staff have opted to expose on the
 * supplier portal — used by src/server/supplier-portal/service.ts, which must
 * never see the internal-by-default thread.
 */
export async function listOrderNotes(
  orderId: string,
  scope: NoteScope = 'order',
  opts?: { visibility?: 'shared'; kind?: 'comment' | 'note' },
): Promise<OrderNoteDto[]> {
  const conditions = [scopeFilter(orderId, scope)];
  if (opts?.visibility) conditions.push(eq(orderNotes.visibility, opts.visibility));
  if (opts?.kind) conditions.push(eq(orderNotes.kind, opts.kind));
  const where = and(...conditions);
  const rows = await db.query.orderNotes.findMany({
    where,
    orderBy: [asc(orderNotes.createdAt)],
    with: {
      garment: { columns: { id: true, name: true } },
      author: { columns: { id: true, name: true, email: true } },
    },
  });
  return rows.map(toNoteDto);
}

/** The most recent live notes on an order, newest first — for previews. */
export async function listRecentOrderNotes(orderId: string, limit = 3): Promise<OrderNoteDto[]> {
  const rows = await db.query.orderNotes.findMany({
    where: and(eq(orderNotes.orderId, orderId), isNull(orderNotes.deletedAt)),
    orderBy: [desc(orderNotes.createdAt)],
    limit,
    with: {
      garment: { columns: { id: true, name: true } },
      author: { columns: { id: true, name: true, email: true } },
    },
  });
  return rows.map(toNoteDto);
}

/**
 * Load a note and confirm it really is on that order, so a note id from a
 * different order is a 404 rather than a silent cross-order write.
 */
async function loadNoteOrThrow(orderId: string, id: string) {
  const note = await db.query.orderNotes.findFirst({ where: eq(orderNotes.id, id) });
  if (!note || note.orderId !== orderId) throw new NotFoundError('Note');
  return note;
}

/**
 * Add a note to an order, optionally against one of its garments.
 *
 * Used by the admin UI (`authorKind: 'staff'`), by Email Flow via the inbound
 * capability surface (`authorKind: 'email_flow'`), and by the token-gated
 * supplier portal (`authorKind: 'supplier'`, src/server/supplier-portal/).
 * Never exposed on the customer surface.
 */
export async function addOrderNote(
  orderId: string,
  data: {
    body: string;
    authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
    authorLabel?: string | null;
    garmentId?: string | null;
    /** True when `body` is HTML from the editor and should be stored as such. */
    isHtml?: boolean;
    /**
     * Whether this note is visible on the supplier portal. Ignored for
     * `authorKind: 'supplier'`, which is always 'shared' — a supplier reading
     * back their own comment is not a leak. Defaults to 'internal' for every
     * other author kind, so nothing becomes supplier-visible without staff
     * opting in per note.
     */
    visibility?: 'internal' | 'shared';
    /** 'note' = an order note (finalisation point); defaults to a thread comment. */
    kind?: 'comment' | 'note';
  },
  meta?: ActorMeta,
): Promise<OrderNoteDto> {
  await assertOrderExists(orderId);
  if (data.garmentId) await assertGarmentBelongsToOrder(orderId, data.garmentId);

  // Sanitise before the emptiness check: a body of nothing but markup we strip
  // is an empty note, however long the payload was.
  const bodyHtml = data.isHtml ? sanitizeNoteHtml(data.body) : null;
  const body = data.isHtml ? htmlToPlainText(bodyHtml) : data.body.trim();
  if (!body) throw new ConflictError('Note is empty');

  const visibility = data.authorKind === 'supplier' ? 'shared' : (data.visibility ?? 'internal');

  const note = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(orderNotes)
      .values({
        orderId,
        garmentId: data.garmentId ?? null,
        body,
        bodyHtml,
        kind: data.kind ?? 'comment',
        authorKind: data.authorKind,
        authorLabel: data.authorLabel ?? null,
        authorStaffUserId: meta?.actorStaffUserId ?? null,
        visibility,
      })
      .returning();

    // Outbox only, deliberately: `getOrderAuditLog` merges both sinks without
    // deduping, so an audit row here would show every note twice in the
    // timeline. Notification dispatch hangs off this event.
    await emitOrderEvent(tx, {
      aggregateId: orderId,
      eventType: 'order.note_added',
      payload: {
        noteId: row.id,
        garmentId: row.garmentId,
        kind: row.kind,
        authorKind: data.authorKind,
        authorLabel: data.authorLabel ?? null,
        actorEmail: meta?.actorEmail ?? null,
      },
    });

    return row;
  });

  // Re-read so the DTO carries the joined author and garment names.
  const withRelations = await db.query.orderNotes.findFirst({
    where: eq(orderNotes.id, note.id),
    with: {
      garment: { columns: { id: true, name: true } },
      author: { columns: { id: true, name: true, email: true } },
    },
  });
  return toNoteDto(withRelations ?? note);
}

/**
 * Edit a note's text. Only the author may edit, because an edited note still
 * carries their name — rewriting someone else's words under their byline is a
 * different thing from moderating, and admins get delete for that.
 */
export async function updateOrderNote(
  orderId: string,
  noteId: string,
  body: string,
  meta: ActorMeta,
): Promise<OrderNoteDto> {
  const existing = await loadNoteOrThrow(orderId, noteId);
  if (existing.deletedAt) throw new ConflictError('That note has been deleted');
  if (!existing.authorStaffUserId || existing.authorStaffUserId !== meta.actorStaffUserId) {
    throw new ConflictError('You can only edit your own notes');
  }

  const bodyHtml = sanitizeNoteHtml(body);
  if (isNoteEmpty(bodyHtml)) throw new ConflictError('Note is empty');
  const plain = htmlToPlainText(bodyHtml);

  await db.transaction(async (tx) => {
    await tx
      .update(orderNotes)
      .set({ body: plain, bodyHtml, updatedAt: new Date() })
      .where(eq(orderNotes.id, noteId));

    await recordAuditEvent(
      {
        aggregateId: existing.orderId,
        eventType: 'note.edited',
        payload: { noteId, garmentId: existing.garmentId },
        actorEmail: meta.actorEmail ?? null,
      },
      tx,
    );

    // Outbox too: the hub's upsert-by-id cache converges on the edit
    // (FLEET_STANDARD_ANNOTATIONS R1). No notification hangs off this.
    await emitOrderEvent(tx, {
      aggregateId: existing.orderId,
      eventType: 'order.note_updated',
      payload: { noteId, kind: existing.kind, authorKind: existing.authorKind },
    });
  });

  const [updated] = await listNoteById(noteId);
  return updated;
}

/**
 * Soft-delete a note. The row survives so the thread keeps its shape — a
 * conversation that silently loses messages reads as a bug to whoever comes
 * next. Authors may remove their own; admins may remove any.
 */
export async function deleteOrderNote(
  orderId: string,
  noteId: string,
  meta: ActorMeta,
): Promise<void> {
  const existing = await loadNoteOrThrow(orderId, noteId);
  if (existing.deletedAt) return; // already gone — deleting twice is not an error

  const isAuthor =
    !!existing.authorStaffUserId && existing.authorStaffUserId === meta.actorStaffUserId;
  if (!isAuthor && !meta.isAdmin) {
    throw new ConflictError('You can only delete your own notes');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(orderNotes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(orderNotes.id, noteId));

    await recordAuditEvent(
      {
        aggregateId: existing.orderId,
        eventType: 'note.deleted',
        payload: { noteId, garmentId: existing.garmentId, byAdmin: !isAuthor },
        actorEmail: meta.actorEmail ?? null,
      },
      tx,
    );

    // Outbox too: the tombstone reaches the hub cache (R1 — soft delete
    // means the row survives for the push handler to read).
    await emitOrderEvent(tx, {
      aggregateId: existing.orderId,
      eventType: 'order.note_deleted',
      payload: { noteId, kind: existing.kind, authorKind: existing.authorKind },
    });
  });
}

/** Single note with its relations loaded, as a one-element list or empty. */
async function listNoteById(noteId: string): Promise<OrderNoteDto[]> {
  const row = await db.query.orderNotes.findFirst({
    where: eq(orderNotes.id, noteId),
    with: {
      garment: { columns: { id: true, name: true } },
      author: { columns: { id: true, name: true, email: true } },
    },
  });
  return row ? [toNoteDto(row)] : [];
}

/** Live note count per garment, for badges on the garment list. */
export async function countGarmentNotes(orderId: string): Promise<Record<string, number>> {
  const rows = await db.query.orderNotes.findMany({
    where: and(eq(orderNotes.orderId, orderId), isNull(orderNotes.deletedAt)),
    columns: { garmentId: true },
  });

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.garmentId) continue;
    counts[row.garmentId] = (counts[row.garmentId] ?? 0) + 1;
  }
  return counts;
}
