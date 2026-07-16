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
} from '@/db/schema';
import { hashToken } from '@/lib/tokens';
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

async function getActiveRosterAccess(rawToken: string) {
  const access = await db.query.rosterAccess.findFirst({
    where: and(eq(rosterAccess.tokenHash, hashToken(rawToken)), isNull(rosterAccess.revokedAt)),
  });

  if (!access) return null;
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) return null;
  return access;
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
    },
    with: {
      garments: {
        orderBy: [asc(garments.sortOrder)],
        columns: {
          id: true,
          name: true,
          notes: true,
        },
        with: {
          sizeChartLinks: {
            with: {
              sizeChart: {
                columns: {
                  name: true,
                  storageKey: true,
                },
              },
            },
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
      garments: order.garments.map((garment) => ({
        id: garment.id,
        name: garment.name,
        notes: garment.notes ?? null,
        sizeCharts: garment.sizeChartLinks
          .filter((link) => link.sizeChart)
          .map((link) => ({
            name: link.sizeChart!.name,
            storageKey: link.sizeChart!.storageKey ?? null,
          })),
      })),
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
      name: data.name,
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

  return writeMemberSizes(order.id, member, input);
}

// ---------------------------------------------------------------------------
// v2 — per-member individual link (TEAM_ROSTER_PLAN.md Phase 9). The token
// resolves directly to one roster_member_id, so there's no "pick your name"
// step and no memberId route param — the token itself scopes everything.
// ---------------------------------------------------------------------------

async function getActiveMemberAccess(rawToken: string) {
  const access = await db.query.rosterMemberAccess.findFirst({
    where: and(eq(rosterMemberAccess.tokenHash, hashToken(rawToken)), isNull(rosterMemberAccess.revokedAt)),
  });

  if (!access) return null;
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) return null;
  return access;
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
    },
    with: {
      garments: {
        orderBy: [asc(garments.sortOrder)],
        columns: { id: true, name: true, notes: true },
        with: {
          sizeChartLinks: {
            with: {
              sizeChart: { columns: { name: true, storageKey: true } },
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
      garments: order.garments.map((garment) => ({
        id: garment.id,
        name: garment.name,
        notes: garment.notes ?? null,
        sizeCharts: garment.sizeChartLinks
          .filter((link) => link.sizeChart)
          .map((link) => ({
            name: link.sizeChart!.name,
            storageKey: link.sizeChart!.storageKey ?? null,
          })),
      })),
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
    columns: { id: true, rosterLockedAt: true },
  });
  if (!order) invalidToken();
  if (order.rosterLockedAt) rosterLocked();

  return writeMemberSizes(order.id, member, input);
}

async function writeMemberSizes(
  orderId: string,
  member: { id: string; name: string; playerNumber: string | null },
  input: SubmitMemberSizesInput,
): Promise<PublicMember> {
  const orderGarments = await db.query.garments.findMany({
    where: eq(garments.orderId, orderId),
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

  await db.transaction(async (tx) => {
    for (const row of normalizedSizes) {
      const existing = existingByGarment.get(row.garmentId);

      if (existing) {
        await tx
          .update(garmentSizing)
          .set({
            size: row.size,
            playerName: member.name,
            playerNumber: member.playerNumber ?? null,
            notes: null,
          })
          .where(eq(garmentSizing.id, existing.id));
        continue;
      }

      const [{ maxSort }] = await tx
        .select({ maxSort: sql<number>`coalesce(max(${garmentSizing.sortOrder}), -1)` })
        .from(garmentSizing)
        .where(eq(garmentSizing.garmentId, row.garmentId));

      await tx.insert(garmentSizing).values({
        garmentId: row.garmentId,
        rosterMemberId: member.id,
        size: row.size,
        playerName: member.name,
        playerNumber: member.playerNumber ?? null,
        notes: null,
        sortOrder: Number(maxSort) + 1,
      });
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
