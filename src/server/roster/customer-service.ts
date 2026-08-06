/**
 * Customer-facing roster service — token-gated reads and writes for the shared
 * team-roster link (TEAM_ROSTER_PLAN.md Phase 5).
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  garments,
  garmentSizing,
  orders,
  rosterAccess,
  rosterMemberAccess,
  rosterMembers,
  type SizeChartKind,
  type SizeChartSize,
} from '@/db/schema';
import { resolveActiveToken } from '@/server/access/tokens';
import { applyNameCase } from '@/lib/names';
import { customerChartLinks, unionChartSizes } from '@/lib/sizes';
import { assertGarmentBelongsToOrder } from '@/server/orders/guards';
import {
  upsertNameListEntries,
  importNameListFromRoster,
  NameListFullError,
} from '@/server/orders/service';
import type { UpsertNameListInput } from '@/server/orders/name-list-contract';
import { MAX_ROSTER_MEMBERS } from './service';
import type { AddRosterMemberInput, SubmitMemberSizesInput } from './contract';

type PublicMember = {
  id: string;
  name: string;
  playerNumber: string | null;
  submittedAt: Date | null;
  sizes: { garmentId: string; size: string | null }[];
};

function invalidToken(): never {
  throw new Error('invalid_token');
}

function rosterLocked(): never {
  throw new Error('roster_locked');
}

function invalidSizes(): never {
  throw new Error('invalid_sizes');
}

function rosterFull(): never {
  throw new Error('roster_full');
}

function toPublicMember(member: {
  id: string;
  name: string;
  playerNumber: string | null;
  submittedAt: Date | null;
  sizing: { garmentId: string; size: string | null }[];
}): PublicMember {
  return {
    id: member.id,
    name: member.name,
    playerNumber: member.playerNumber ?? null,
    submittedAt: member.submittedAt ?? null,
    sizes: member.sizing.map((row) => ({
      garmentId: row.garmentId,
      size: row.size ?? null,
    })),
  };
}

/**
 * Shared garment projection for the customer roster surfaces (shared link and
 * per-member link) — chart-defined sizes drive the member size dropdown.
 */
function toRosterGarment(garment: {
  id: string;
  name: string;
  notes: string | null;
  sizeChartLinks: {
    sizeChart: {
      name: string;
      storageKey: string | null;
      kind: SizeChartKind;
      sizes: SizeChartSize[] | null;
    } | null;
  }[];
  nameListEnabled: boolean;
  nameListRows: number | null;
  nameListEntries: { id: string; name: string; playerNumber: string | null }[];
}) {
  // Customer surface — production charts (factory detail) are filtered out.
  const linkedCharts = customerChartLinks(garment.sizeChartLinks);
  return {
    id: garment.id,
    name: garment.name,
    notes: garment.notes ?? null,
    // Chart-defined sizes drive the member size dropdown
    sizes: unionChartSizes(linkedCharts.map((link) => ({ sizes: link.sizeChart.sizes ?? [] }))),
    sizeCharts: linkedCharts.map((link) => ({
      name: link.sizeChart.name,
      storageKey: link.sizeChart.storageKey ?? null,
    })),
    // "Got Your Back" style — see GOT_YOUR_BACK_PLAN.md. Independent of the
    // per-member size submission above; the manager edits this directly
    // (updateGarmentNameList / importGarmentNameListFromRoster below).
    nameListEnabled: garment.nameListEnabled,
    nameListRows: garment.nameListRows,
    nameListEntries: garment.nameListEntries.map((e) => ({
      id: e.id,
      name: e.name,
      playerNumber: e.playerNumber,
    })),
  };
}

function getActiveRosterAccess(rawToken: string) {
  return resolveActiveToken(rosterAccess, rawToken);
}

async function getRosterOrderOrThrow(rawToken: string) {
  const access = await getActiveRosterAccess(rawToken);
  if (!access) invalidToken();

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
    columns: {
      id: true,
      orderNumber: true,
      clubName: true,
      rosterLockedAt: true,
      namesUppercase: true,
    },
  });
  if (!order) invalidToken();

  return { access, order };
}

export async function getRosterForMember(rawToken: string) {
  const access = await getActiveRosterAccess(rawToken);
  if (!access) return null;

  await db
    .update(rosterAccess)
    .set({ lastViewedAt: new Date() })
    .where(eq(rosterAccess.id, access.id));

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
    columns: {
      id: true,
      orderNumber: true,
      clubName: true,
      rosterLockedAt: true,
      namesUppercase: true,
    },
    with: {
      garments: {
        orderBy: [asc(garments.sortOrder)],
        columns: {
          id: true,
          name: true,
          notes: true,
          nameListEnabled: true,
          nameListRows: true,
        },
        with: {
          sizeChartLinks: {
            with: {
              sizeChart: {
                columns: {
                  name: true,
                  storageKey: true,
                  kind: true,
                  sizes: true,
                },
              },
            },
          },
          nameListEntries: {
            orderBy: (e, { asc }) => [asc(e.sortOrder)],
            columns: { id: true, name: true, playerNumber: true },
          },
        },
      },
      rosterMembers: {
        orderBy: [asc(rosterMembers.sortOrder), asc(rosterMembers.createdAt)],
        columns: {
          id: true,
          name: true,
          playerNumber: true,
          submittedAt: true,
        },
        with: {
          sizing: {
            orderBy: [asc(garmentSizing.sortOrder)],
            columns: {
              garmentId: true,
              size: true,
            },
          },
        },
      },
    },
  });

  if (!order) return null;

  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      clubName: order.clubName ?? null,
      locked: order.rosterLockedAt !== null,
      namesUppercase: order.namesUppercase,
      garments: order.garments.map(toRosterGarment),
    },
    members: order.rosterMembers.map(toPublicMember),
  };
}

export async function addSelf(rawToken: string, data: AddRosterMemberInput): Promise<PublicMember> {
  const { order } = await getRosterOrderOrThrow(rawToken);
  if (order.rosterLockedAt) rosterLocked();

  const [{ maxSort, count }] = await db
    .select({
      maxSort: sql<number>`coalesce(max(${rosterMembers.sortOrder}), -1)`,
      count: sql<number>`count(*)`,
    })
    .from(rosterMembers)
    .where(eq(rosterMembers.orderId, order.id));

  if (Number(count) >= MAX_ROSTER_MEMBERS) rosterFull();

  const [member] = await db
    .insert(rosterMembers)
    .values({
      orderId: order.id,
      name: applyNameCase(order.namesUppercase, data.name),
      playerNumber: data.playerNumber ?? null,
      email: data.email ?? null,
      sortOrder: Number(maxSort) + 1,
    })
    .returning({
      id: rosterMembers.id,
      name: rosterMembers.name,
      playerNumber: rosterMembers.playerNumber,
      submittedAt: rosterMembers.submittedAt,
    });

  return { ...member, sizes: [] };
}

export async function submitMemberSizes(
  rawToken: string,
  memberId: string,
  input: SubmitMemberSizesInput,
): Promise<PublicMember> {
  const { order } = await getRosterOrderOrThrow(rawToken);
  if (order.rosterLockedAt) rosterLocked();

  const member = await db.query.rosterMembers.findFirst({
    where: and(eq(rosterMembers.id, memberId), eq(rosterMembers.orderId, order.id)),
    columns: {
      id: true,
      name: true,
      playerNumber: true,
    },
  });
  if (!member) throw new Error('member_not_found');

  return writeMemberSizes(order.id, member, input, order.namesUppercase);
}

// ---------------------------------------------------------------------------
// "Got Your Back" name list — manager-edited via the shared roster link only
// (GOT_YOUR_BACK_PLAN.md: one person finalizes the list, not per-member
// submissions like sizes above). No per-member-token variant.
// ---------------------------------------------------------------------------

async function assertNameListGarment(orderId: string, garmentId: string): Promise<void> {
  const garment = await db.query.garments.findFirst({
    where: and(eq(garments.id, garmentId), eq(garments.orderId, orderId)),
    columns: { id: true, nameListEnabled: true },
  });
  if (!garment || !garment.nameListEnabled) throw new Error('garment_not_found');
}

export async function updateGarmentNameList(rawToken: string, garmentId: string, entries: UpsertNameListInput) {
  const { order } = await getRosterOrderOrThrow(rawToken);
  if (order.rosterLockedAt) rosterLocked();
  await assertNameListGarment(order.id, garmentId);

  try {
    return await upsertNameListEntries(garmentId, entries);
  } catch (err) {
    if (err instanceof NameListFullError) throw new Error('name_list_full');
    throw err;
  }
}

export async function updateGarmentNameListRows(rawToken: string, garmentId: string, rows: number | null) {
  const { order } = await getRosterOrderOrThrow(rawToken);
  if (order.rosterLockedAt) rosterLocked();
  await assertNameListGarment(order.id, garmentId);

  await db.update(garments).set({ nameListRows: rows, updatedAt: new Date() }).where(eq(garments.id, garmentId));
}

export async function importGarmentNameListFromRoster(rawToken: string, garmentId: string) {
  const { order } = await getRosterOrderOrThrow(rawToken);
  if (order.rosterLockedAt) rosterLocked();
  await assertNameListGarment(order.id, garmentId);

  try {
    return await importNameListFromRoster(garmentId);
  } catch (err) {
    if (err instanceof NameListFullError) throw new Error('name_list_full');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// v2 — per-member individual link (TEAM_ROSTER_PLAN.md Phase 9). The token
// resolves directly to one roster_member_id, so there's no "pick your name"
// step and no memberId route param — the token itself scopes everything.
// ---------------------------------------------------------------------------

function getActiveMemberAccess(rawToken: string) {
  return resolveActiveToken(rosterMemberAccess, rawToken);
}

export async function getRosterForMemberByMemberToken(rawToken: string) {
  const access = await getActiveMemberAccess(rawToken);
  if (!access) return null;

  await db
    .update(rosterMemberAccess)
    .set({ lastViewedAt: new Date() })
    .where(eq(rosterMemberAccess.id, access.id));

  const member = await db.query.rosterMembers.findFirst({
    where: eq(rosterMembers.id, access.rosterMemberId),
    columns: {
      id: true,
      orderId: true,
      name: true,
      playerNumber: true,
      submittedAt: true,
    },
    with: {
      sizing: {
        orderBy: [asc(garmentSizing.sortOrder)],
        columns: { garmentId: true, size: true },
      },
    },
  });
  if (!member) return null;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, member.orderId),
    columns: {
      id: true,
      orderNumber: true,
      clubName: true,
      rosterLockedAt: true,
      namesUppercase: true,
    },
    with: {
      garments: {
        orderBy: [asc(garments.sortOrder)],
        columns: { id: true, name: true, notes: true, nameListEnabled: true, nameListRows: true },
        with: {
          sizeChartLinks: {
            with: {
              sizeChart: { columns: { name: true, storageKey: true, kind: true, sizes: true } },
            },
          },
          nameListEntries: {
            orderBy: (e, { asc }) => [asc(e.sortOrder)],
            columns: { id: true, name: true, playerNumber: true },
          },
        },
      },
    },
  });
  if (!order) return null;

  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      clubName: order.clubName ?? null,
      locked: order.rosterLockedAt !== null,
      namesUppercase: order.namesUppercase,
      garments: order.garments.map(toRosterGarment),
    },
    member: toPublicMember(member),
  };
}

export async function submitMemberSizesByMemberToken(
  rawToken: string,
  input: SubmitMemberSizesInput,
): Promise<PublicMember> {
  const access = await getActiveMemberAccess(rawToken);
  if (!access) invalidToken();

  const member = await db.query.rosterMembers.findFirst({
    where: eq(rosterMembers.id, access.rosterMemberId),
    columns: { id: true, orderId: true, name: true, playerNumber: true },
  });
  if (!member) invalidToken();

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, member.orderId),
    columns: { id: true, rosterLockedAt: true, namesUppercase: true },
  });
  if (!order) invalidToken();
  if (order.rosterLockedAt) rosterLocked();

  return writeMemberSizes(order.id, member, input, order.namesUppercase);
}

async function writeMemberSizes(
  orderId: string,
  member: { id: string; name: string; playerNumber: string | null },
  input: SubmitMemberSizesInput,
  namesUppercase: boolean,
): Promise<PublicMember> {
  // "Got Your Back" name-list garments (GOT_YOUR_BACK_PLAN.md) are excluded —
  // they carry no size, and members never submit against them individually;
  // the manager edits the name list directly (updateGarmentNameList above).
  const orderGarments = await db.query.garments.findMany({
    where: and(eq(garments.orderId, orderId), eq(garments.nameListEnabled, false)),
    columns: { id: true },
    orderBy: [asc(garments.sortOrder)],
  });
  if (orderGarments.length === 0) invalidSizes();

  const expectedIds = new Set(orderGarments.map((garment) => garment.id));
  if (input.sizes.length !== expectedIds.size) invalidSizes();
  for (const row of input.sizes) {
    if (!expectedIds.has(row.garmentId)) invalidSizes();
  }

  const garmentIds = orderGarments.map((garment) => garment.id);
  const existingRows = await db.query.garmentSizing.findMany({
    where: and(
      eq(garmentSizing.rosterMemberId, member.id),
      inArray(garmentSizing.garmentId, garmentIds),
    ),
    columns: {
      id: true,
      garmentId: true,
    },
  });
  const existingByGarment = new Map(existingRows.map((row) => [row.garmentId, row]));

  const submittedAt = new Date();
  const normalizedSizes = input.sizes.map((row) => ({
    garmentId: row.garmentId,
    size: row.size.trim(),
  }));

  // Batched writes: instead of one UPDATE (or SELECT max + INSERT) per garment
  // in a loop, group the rows up-front and issue set-based statements.
  const memberFields = {
    // Member names are already cased at their own write; re-applying keeps
    // this writer safe against rows that predate the flag (src/lib/names.ts).
    playerName: applyNameCase(namesUppercase, member.name),
    playerNumber: member.playerNumber ?? null,
    notes: null,
  };
  const updates = normalizedSizes.filter((row) => existingByGarment.has(row.garmentId));
  const inserts = normalizedSizes.filter((row) => !existingByGarment.has(row.garmentId));

  await db.transaction(async (tx) => {
    // One UPDATE per distinct submitted size (rows sharing a size share a statement).
    const updateIdsBySize = new Map<string, string[]>();
    for (const row of updates) {
      const id = existingByGarment.get(row.garmentId)!.id;
      const ids = updateIdsBySize.get(row.size);
      if (ids) ids.push(id);
      else updateIdsBySize.set(row.size, [id]);
    }
    for (const [size, ids] of updateIdsBySize) {
      await tx
        .update(garmentSizing)
        .set({ size, ...memberFields })
        .where(inArray(garmentSizing.id, ids));
    }

    if (inserts.length > 0) {
      // One grouped max(sort_order) lookup replaces the per-garment queries.
      const maxRows = await tx
        .select({
          garmentId: garmentSizing.garmentId,
          maxSort: sql<number>`coalesce(max(${garmentSizing.sortOrder}), -1)`,
        })
        .from(garmentSizing)
        .where(inArray(garmentSizing.garmentId, inserts.map((row) => row.garmentId)))
        .groupBy(garmentSizing.garmentId);
      const maxSortByGarment = new Map(maxRows.map((r) => [r.garmentId, Number(r.maxSort)]));

      await tx.insert(garmentSizing).values(
        inserts.map((row) => ({
          garmentId: row.garmentId,
          rosterMemberId: member.id,
          size: row.size,
          ...memberFields,
          sortOrder: (maxSortByGarment.get(row.garmentId) ?? -1) + 1,
        })),
      );
    }

    await tx
      .update(rosterMembers)
      .set({ submittedAt })
      .where(eq(rosterMembers.id, member.id));
  });

  return {
    id: member.id,
    name: member.name,
    playerNumber: member.playerNumber ?? null,
    submittedAt,
    sizes: normalizedSizes.map((row) => ({
      garmentId: row.garmentId,
      size: row.size,
    })),
  };
}
