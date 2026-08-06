/**
 * Pre-send checklist (David, 2026-08-06): the configurable list of checks the
 * production-prep team works through before a PO may be sent. Items with an
 * `autoRule` satisfy themselves from data; the rest are manual ticks recorded
 * with who/when (the History card shows them via the audit trail). Sending is
 * blocked while anything is outstanding — an admin override (with a reason)
 * rides the same override the po_send workflow gate uses.
 */
import { and, eq, ilike, isNull, max } from 'drizzle-orm';
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

/** The rules an item can satisfy itself with — code, not config (see schema). */
export type PoChecklistAutoRule = 'design_file_attached' | 'color_book_set';

export interface PoChecklistEntry {
  id: string;
  label: string;
  /** Set = satisfied automatically from data; manual ticks have null. */
  autoRule: 'design_file_attached' | 'color_book_set' | null;
  satisfied: boolean;
  /** True when `satisfied` came from the rule rather than a tick. */
  auto: boolean;
  /** May this check be acknowledged past instead of done? */
  allowSidestep: boolean;
  /** True when what satisfies this item is a sidestep acknowledgement. */
  sidestepped: boolean;
  sidestepReason: string | null;
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
        allowSidestep: item.allowSidestep,
        sidestepped: tick?.sidestepped ?? false,
        sidestepReason: tick?.sidestepReason ?? null,
        checkedByEmail: tick?.checkedByEmail ?? null,
        checkedAt: tick?.checkedAt ?? null,
      };
    }),
  );
}

/**
 * Tick, untick, or SIDESTEP one item — every outcome recorded with who/when.
 *
 * A sidestep (David, 2026-08-06) is an explicit acknowledgement that the check
 * is being passed without being done: only legal on items configured
 * `allowSidestep`, and only with a stated reason. Both refusals are hard —
 * an unreasoned acknowledgement, or one on a must-do check, is exactly the
 * silent skip the checklist exists to prevent.
 */
export async function setChecklistItem(
  poId: string,
  itemId: string,
  checked: boolean,
  meta: { actorEmail?: string | null; sidestepReason?: string | null },
): Promise<void> {
  const po = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, poId) });
  if (!po) throw new NotFoundError('Purchase order');
  const item = await db.query.poChecklistItems.findFirst({
    where: eq(poChecklistItems.id, itemId),
  });
  if (!item || !item.isActive) throw new NotFoundError('Checklist item');

  const reason = meta.sidestepReason?.trim() || null;
  const sidestepping = checked && reason !== null;
  if (sidestepping && !item.allowSidestep) {
    throw new ConflictError(`"${item.label}" cannot be sidestepped — it has to be done`);
  }

  if (checked) {
    await db
      .insert(poChecklistCompletions)
      .values({
        poId,
        itemId,
        checkedByEmail: meta.actorEmail ?? null,
        sidestepped: sidestepping,
        sidestepReason: sidestepping ? reason : null,
      })
      // A second click must be able to CONVERT a tick into a sidestep (and
      // vice versa) rather than silently keeping the first outcome.
      .onConflictDoUpdate({
        target: [poChecklistCompletions.poId, poChecklistCompletions.itemId],
        set: {
          checkedByEmail: meta.actorEmail ?? null,
          checkedAt: new Date(),
          sidestepped: sidestepping,
          sidestepReason: sidestepping ? reason : null,
        },
      });
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
    payload: {
      poId,
      poNumber: po.poNumber,
      item: item.label,
      checked,
      ...(sidestepping && { sidestepped: true, reason }),
    },
    actorEmail: meta.actorEmail ?? null,
  });
}

/**
 * The send gate (David, 2026-08-06): "without all the actions performed, or
 * the sidestep acknowledged, a proposed PO can not be sent to the supplier."
 * Every active item must be DONE (auto or ticked) or explicitly SIDESTEPPED
 * with a reason. Throws a ConflictError listing what is outstanding; the
 * admin-only override reason the workflow gate uses still bypasses it
 * (audited as workflow.gate_overridden).
 */
export async function assertChecklistComplete(poId: string): Promise<void> {
  const entries = await getPoChecklist(poId);
  const outstanding = entries.filter((e) => !e.satisfied).map((e) => e.label);
  if (outstanding.length > 0) {
    throw new ConflictError(`Pre-send checklist incomplete: ${outstanding.join('; ')}`);
  }
}

// --- the checks THEMSELVES (admin configuration) ----------------------------
//
// The list of checks is config, not code: the seeded items are a starting point,
// and production staff change what the team has to work through. Only the
// `autoRule` vocabulary is code (each rule has a hard-wired evaluator above), so
// adding a RULE is a deploy while adding a CHECK is a setting.
//
// Deactivate-never-delete, for the same reason the rest of the app does it: a
// completion row points at an item, and the audit trail names it. Retiring an
// item drops it out of `getPoChecklist` (which reads active items only) without
// rewriting what already happened.

export interface PoChecklistItemRow {
  id: string;
  label: string;
  autoRule: PoChecklistAutoRule | null;
  allowSidestep: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
}

/** Every item INCLUDING retired ones — the settings view has to show them to bring one back. */
export async function listChecklistItems(): Promise<PoChecklistItemRow[]> {
  return db.query.poChecklistItems.findMany({
    orderBy: (i, { asc }) => [asc(i.sortOrder), asc(i.createdAt)],
  });
}

export interface CreateChecklistItemInput {
  label: string;
  autoRule?: PoChecklistAutoRule | null;
  allowSidestep?: boolean;
  sortOrder?: number;
}

export async function createChecklistItem(
  input: CreateChecklistItemInput,
  meta?: { actorEmail?: string | null },
): Promise<PoChecklistItemRow> {
  // Append to the end unless a position was asked for, so a new check does not
  // silently jump the queue on a list people work through top to bottom.
  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(poChecklistItems.sortOrder) })
    .from(poChecklistItems);

  const [row] = await db
    .insert(poChecklistItems)
    .values({
      label: input.label,
      autoRule: input.autoRule ?? null,
      allowSidestep: input.allowSidestep ?? false,
      sortOrder: input.sortOrder ?? (highest ?? 0) + 1,
    })
    .returning();

  await recordAuditEvent({
    aggregateType: 'po_checklist_item',
    aggregateId: row.id,
    eventType: 'po.check_item_created',
    actorEmail: meta?.actorEmail ?? null,
    payload: {
      label: row.label,
      autoRule: row.autoRule,
      allowSidestep: row.allowSidestep,
      sortOrder: row.sortOrder,
    },
  });

  return row;
}

export interface UpdateChecklistItemInput {
  label?: string;
  autoRule?: PoChecklistAutoRule | null;
  allowSidestep?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Edit or retire one check. `isActive: false` is the only removal there is.
 *
 * Turning `allowSidestep` OFF does not void sidesteps already recorded against
 * the item: they were legitimate acknowledgements when they were given, and
 * silently un-satisfying them would block sends that nobody can see a reason
 * for. From here on the check has to be done — that is what the setting means.
 */
export async function updateChecklistItem(
  itemId: string,
  patch: UpdateChecklistItemInput,
  meta?: { actorEmail?: string | null },
): Promise<PoChecklistItemRow> {
  const current = await db.query.poChecklistItems.findFirst({
    where: eq(poChecklistItems.id, itemId),
  });
  if (!current) throw new NotFoundError('Checklist item');

  const [row] = await db
    .update(poChecklistItems)
    .set({
      ...(patch.label !== undefined && { label: patch.label }),
      ...(patch.autoRule !== undefined && { autoRule: patch.autoRule }),
      ...(patch.allowSidestep !== undefined && { allowSidestep: patch.allowSidestep }),
      ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
    })
    .where(eq(poChecklistItems.id, itemId))
    .returning();

  await recordAuditEvent({
    aggregateType: 'po_checklist_item',
    aggregateId: row.id,
    eventType: 'po.check_item_updated',
    actorEmail: meta?.actorEmail ?? null,
    payload: { label: row.label, changes: patch },
  });

  return row;
}
