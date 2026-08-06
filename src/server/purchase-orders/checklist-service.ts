/**
 * Pre-send checklist (David, 2026-08-06): the configurable list of checks the
 * production-prep team works through before a PO may be sent. Items with an
 * `autoRule` satisfy themselves from data; the rest are manual ticks recorded
 * with who/when (the History card shows them via the audit trail). Sending is
 * blocked while anything is outstanding — an admin override (with a reason)
 * rides the same override the po_send workflow gate uses.
 */
import { and, eq, ilike, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  poChecklistCompletions,
  poChecklistItems,
  poFiles,
  purchaseOrderRevisions,
  purchaseOrders,
} from '@/db/schema';
import { recordAuditEvent } from '@/server/events/outbox';
import { ConflictError, NotFoundError } from '@/server/orders/service';

export interface PoChecklistEntry {
  id: string;
  label: string;
  /** Set = satisfied automatically from data; manual ticks have null. */
  autoRule: 'design_file_attached' | 'color_book_set' | null;
  satisfied: boolean;
  /** True when `satisfied` came from the rule rather than a tick. */
  auto: boolean;
  checkedByEmail: string | null;
  checkedAt: Date | null;
}

async function evaluateAutoRule(
  rule: 'design_file_attached' | 'color_book_set',
  po: { id: string; colorBookId: string | null },
): Promise<boolean> {
  if (rule === 'color_book_set') return po.colorBookId !== null;
  // design_file_attached: a live production file in a design-ish category,
  // or a design asset already in the latest snapshot.
  const [file] = await db.query.poFiles.findMany({
    where: and(
      eq(poFiles.poId, po.id),
      isNull(poFiles.deletedAt),
      ilike(poFiles.category, 'design%'),
    ),
    limit: 1,
  });
  if (file) return true;
  const latest = await db.query.purchaseOrderRevisions.findFirst({
    where: eq(purchaseOrderRevisions.poId, po.id),
    orderBy: (r, { desc }) => [desc(r.revisionNumber)],
  });
  return (latest?.snapshot.assets?.length ?? 0) > 0;
}

/** The PO's checklist state: every ACTIVE item, in order, with satisfaction. */
export async function getPoChecklist(poId: string): Promise<PoChecklistEntry[]> {
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, poId),
    columns: { id: true, colorBookId: true },
  });
  if (!po) throw new NotFoundError('Purchase order');

  const items = await db.query.poChecklistItems.findMany({
    where: eq(poChecklistItems.isActive, true),
    orderBy: (i, { asc }) => [asc(i.sortOrder), asc(i.createdAt)],
  });
  const completions = await db.query.poChecklistCompletions.findMany({
    where: eq(poChecklistCompletions.poId, poId),
  });
  const byItem = new Map(completions.map((c) => [c.itemId, c]));

  return Promise.all(
    items.map(async (item) => {
      const tick = byItem.get(item.id);
      const autoSatisfied = item.autoRule ? await evaluateAutoRule(item.autoRule, po) : false;
      return {
        id: item.id,
        label: item.label,
        autoRule: item.autoRule ?? null,
        satisfied: autoSatisfied || Boolean(tick),
        auto: autoSatisfied && !tick,
        checkedByEmail: tick?.checkedByEmail ?? null,
        checkedAt: tick?.checkedAt ?? null,
      };
    }),
  );
}

/** Tick or untick one item, recorded with who/when in the audit trail. */
export async function setChecklistItem(
  poId: string,
  itemId: string,
  checked: boolean,
  meta: { actorEmail?: string | null },
): Promise<void> {
  const po = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, poId) });
  if (!po) throw new NotFoundError('Purchase order');
  const item = await db.query.poChecklistItems.findFirst({
    where: eq(poChecklistItems.id, itemId),
  });
  if (!item || !item.isActive) throw new NotFoundError('Checklist item');

  if (checked) {
    await db
      .insert(poChecklistCompletions)
      .values({ poId, itemId, checkedByEmail: meta.actorEmail ?? null })
      .onConflictDoNothing();
  } else {
    await db
      .delete(poChecklistCompletions)
      .where(
        and(eq(poChecklistCompletions.poId, poId), eq(poChecklistCompletions.itemId, itemId)),
      );
  }
  await recordAuditEvent({
    aggregateId: po.orderId,
    eventType: 'po.check_changed',
    payload: { poId, poNumber: po.poNumber, item: item.label, checked },
    actorEmail: meta.actorEmail ?? null,
  });
}

/**
 * The send gate: every active item must be satisfied. Throws a ConflictError
 * listing the outstanding labels; the caller may bypass with the same
 * admin-only override reason the workflow gate uses (audited there).
 */
export async function assertChecklistComplete(poId: string): Promise<void> {
  const entries = await getPoChecklist(poId);
  const outstanding = entries.filter((e) => !e.satisfied).map((e) => e.label);
  if (outstanding.length > 0) {
    throw new ConflictError(`Pre-send checklist incomplete: ${outstanding.join('; ')}`);
  }
}
