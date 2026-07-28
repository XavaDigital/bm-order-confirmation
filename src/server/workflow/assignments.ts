/**
 * Ownership: who is responsible for a stage, an order or a purchase order.
 *
 * One polymorphic table rather than a `stage_owners` table plus an
 * `order_assignees` table — a user owning a STAGE is just a row with
 * `entityType: 'workflow_stage'`. That is what lets "notify whoever owns this
 * step" and "notify whoever owns this order" be the same lookup.
 *
 * Named teams are deliberately not modelled yet: multi-user ownership already
 * works here, and a teams table would only be a saved-set convenience until we
 * know whether the same sets actually repeat.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import { assignments, staffUsers } from '@/db/schema';
import type { AssignmentEntityType } from '@/db/schema';
import { recordAuditEvent } from '@/server/events/outbox';

export interface Assignee {
  staffUserId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

/** Everyone assigned to one entity. */
export async function getAssignees(
  entityType: AssignmentEntityType,
  entityId: string,
): Promise<Assignee[]> {
  const rows = await db
    .select({
      staffUserId: assignments.staffUserId,
      role: assignments.role,
      name: staffUsers.name,
      email: staffUsers.email,
      isActive: staffUsers.isActive,
    })
    .from(assignments)
    .innerJoin(staffUsers, eq(staffUsers.id, assignments.staffUserId))
    .where(and(eq(assignments.entityType, entityType), eq(assignments.entityId, entityId)));

  return rows;
}

/**
 * Assignees for many entities at once, keyed by entity id.
 *
 * The batch form exists because the board and the checklist both need owners for
 * every row on screen; doing it per row is the N+1 that makes a board slow enough
 * that people stop opening it.
 *
 * Takes an optional executor so a caller already inside a transaction can pass
 * its `tx`. Reaching for the global `db` from within one deadlocks on PGlite,
 * which has a single connection — the test suite hangs rather than failing.
 */
export async function getAssigneesForMany(
  entityType: AssignmentEntityType,
  entityIds: string[],
  executor: Transaction | typeof db = db,
): Promise<Map<string, Assignee[]>> {
  const result = new Map<string, Assignee[]>();
  if (entityIds.length === 0) return result;

  const rows = await executor
    .select({
      entityId: assignments.entityId,
      staffUserId: assignments.staffUserId,
      role: assignments.role,
      name: staffUsers.name,
      email: staffUsers.email,
      isActive: staffUsers.isActive,
    })
    .from(assignments)
    .innerJoin(staffUsers, eq(staffUsers.id, assignments.staffUserId))
    .where(
      and(eq(assignments.entityType, entityType), inArray(assignments.entityId, entityIds)),
    );

  for (const row of rows) {
    const { entityId, ...assignee } = row;
    const list = result.get(entityId);
    if (list) list.push(assignee);
    else result.set(entityId, [assignee]);
  }
  return result;
}

/**
 * Owner ids only — what the task rules need.
 *
 * Deactivated users are excluded: an `all` policy waiting on someone who has left
 * the company is a permanent deadlock, and their row is kept for the audit trail
 * rather than as a live obligation.
 */
export async function getStageOwnerIds(stageId: string): Promise<string[]> {
  const rows = await getAssignees('workflow_stage', stageId);
  return rows.filter((row) => row.isActive).map((row) => row.staffUserId);
}

/** Active owner ids for many stages at once, keyed by stage id. */
export async function getStageOwnerIdsForMany(
  stageIds: string[],
  executor: Transaction | typeof db = db,
): Promise<Map<string, string[]>> {
  const byStage = await getAssigneesForMany('workflow_stage', stageIds, executor);
  const result = new Map<string, string[]>();
  for (const [stageId, people] of byStage) {
    result.set(
      stageId,
      people.filter((person) => person.isActive).map((person) => person.staffUserId),
    );
  }
  return result;
}

export interface OwnerDiff {
  added: string[];
  removed: string[];
}

/**
 * Replace the owner set for an entity, returning what actually changed.
 *
 * The diff is the point: the caller needs to know who was newly made responsible
 * so they can be told, without emailing everyone who was already on the list
 * every time somebody edits it.
 */
export async function setAssignees(
  entityType: AssignmentEntityType,
  entityId: string,
  staffUserIds: string[],
  meta?: { actorEmail?: string | null; actorStaffUserId?: string | null; role?: string },
): Promise<OwnerDiff> {
  const role = meta?.role ?? 'owner';
  const wanted = [...new Set(staffUserIds)];

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ staffUserId: assignments.staffUserId })
      .from(assignments)
      .where(
        and(
          eq(assignments.entityType, entityType),
          eq(assignments.entityId, entityId),
          eq(assignments.role, role),
        ),
      );

    const current = new Set(existing.map((row) => row.staffUserId));
    const added = wanted.filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !wanted.includes(id));

    if (removed.length > 0) {
      await tx
        .delete(assignments)
        .where(
          and(
            eq(assignments.entityType, entityType),
            eq(assignments.entityId, entityId),
            eq(assignments.role, role),
            inArray(assignments.staffUserId, removed),
          ),
        );
    }

    if (added.length > 0) {
      await tx
        .insert(assignments)
        .values(
          added.map((staffUserId) => ({
            staffUserId,
            entityType,
            entityId,
            role,
            createdBy: meta?.actorStaffUserId ?? null,
          })),
        )
        // Concurrent edits should converge, not 23505.
        .onConflictDoNothing();
    }

    if (added.length > 0 || removed.length > 0) {
      await recordAuditEvent(
        {
          aggregateId: entityId,
          aggregateType: entityType === 'purchase_order' ? 'purchase_order' : 'order',
          eventType: 'workflow.owners_changed',
          payload: { entityType, role, added, removed },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }

    return { added, removed };
  });
}

/**
 * What is assigned to one person — the "my work" reverse lookup.
 *
 * Returns raw assignment rows; resolving them to orders or stages is the
 * caller's job, since the two boards render them very differently.
 */
export async function getAssignmentsForUser(
  staffUserId: string,
  entityType?: AssignmentEntityType,
): Promise<Array<{ entityType: AssignmentEntityType; entityId: string; role: string }>> {
  const rows = await db
    .select({
      entityType: assignments.entityType,
      entityId: assignments.entityId,
      role: assignments.role,
    })
    .from(assignments)
    .where(
      entityType
        ? and(eq(assignments.staffUserId, staffUserId), eq(assignments.entityType, entityType))
        : eq(assignments.staffUserId, staffUserId),
    );

  return rows;
}
