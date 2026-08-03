/**
 * The short-URL roster page (David, 2026-08-03): /roster/<order-number>,
 * typeable, optionally password-gated, with EMAIL as the guest identity.
 *
 * Access model, replacing the anyone-with-the-link-edits-anyone shared page:
 *  - The GATE is the page's password (staff-set, readable, may be a word) or
 *    a token link (?t=… — the existing roster_access token, which skips the
 *    password but not the email step).
 *  - The IDENTITY is an email: whoever enters it becomes that guest on this
 *    order and owns the players they add. Everyone can SEE the whole team;
 *    only a member's creator can edit or remove them (staff-imported members
 *    have no creator and are read-only here).
 *
 * The trade-off is deliberate and David's: an email is not authenticated, so
 * this is politeness-grade isolation for teammates, not a security boundary —
 * the page gate (password/token) is the actual boundary, exactly like the
 * old shared link.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  garments,
  garmentSizing,
  orders,
  rosterAccess,
  rosterGuests,
  rosterMembers,
  type GarmentTypeOption,
  type SizeChartSize,
} from '@/db/schema';
import { resolveActiveToken } from '@/server/access/tokens';
import { unionChartSizes } from '@/lib/sizes';
import { signImageRefs, signChartRefs } from '@/lib/signed-urls';
import { MAX_ROSTER_MEMBERS } from './service';

// Thrown-string convention mirrors customer-service.ts — routes map them.
function notFound(): never {
  throw new Error('roster_not_found');
}
function badGate(): never {
  throw new Error('bad_gate');
}
function rosterLocked(): never {
  throw new Error('roster_locked');
}
function forbidden(): never {
  throw new Error('not_your_member');
}
function invalidSizes(): never {
  throw new Error('invalid_sizes');
}
function rosterFull(): never {
  throw new Error('roster_full');
}

export interface RosterPageOrder {
  id: string;
  orderNumber: string;
  clubName: string | null;
  name: string | null;
  rosterPassword: string | null;
  rosterLockedAt: Date | null;
}

/** The roster-enabled order behind a short URL, or null (generic 404). */
export async function getRosterPageOrder(orderNumber: string): Promise<RosterPageOrder | null> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.orderNumber, orderNumber),
    columns: {
      id: true,
      orderNumber: true,
      clubName: true,
      name: true,
      rosterPassword: true,
      rosterLockedAt: true,
      rosterEnabledAt: true,
    },
  });
  if (!order || !order.rosterEnabledAt) return null;
  return order;
}

/**
 * Pass the gate and become a guest: password (or token link) + email → the
 * guest row, upserted on (order, lowercased email). Callers set the session
 * cookie from the result.
 */
export async function enterRoster(params: {
  orderNumber: string;
  email: string;
  name?: string | null;
  password?: string | null;
  token?: string | null;
}): Promise<{ order: RosterPageOrder; guestId: string }> {
  const order = await getRosterPageOrder(params.orderNumber);
  if (!order) notFound();

  if (order.rosterPassword) {
    const byPassword = params.password != null && params.password === order.rosterPassword;
    const byToken =
      !byPassword &&
      params.token != null &&
      (await resolveActiveToken(rosterAccess, params.token))?.orderId === order.id;
    if (!byPassword && !byToken) badGate();
  }

  const email = params.email.trim().toLowerCase();
  const name = params.name?.trim() || null;

  const [guest] = await db
    .insert(rosterGuests)
    .values({ orderId: order.id, email, name })
    .onConflictDoUpdate({
      target: [rosterGuests.orderId, rosterGuests.email],
      set: { lastSeenAt: new Date(), ...(name ? { name } : {}) },
    })
    .returning({ id: rosterGuests.id });

  return { order, guestId: guest.id };
}

export interface RosterStateMember {
  id: string;
  name: string;
  playerNumber: string | null;
  submittedAt: Date | null;
  /** The signed-in guest may edit only their own members. */
  mine: boolean;
  addedBy: string | null;
  /** garmentId → { size, customValues } */
  sizes: Record<string, { size: string | null; customValues: Record<string, string> | null }>;
}

export interface RosterStateGarment {
  id: string;
  name: string;
  notes: string | null;
  /** Chart-defined sizes for the dropdown ({label, tall}). */
  sizes: SizeChartSize[];
  /** Custom sizing columns (e.g. Colour) — rendered as inputs per member. */
  sizingColumns: GarmentTypeOption[];
  images: { url: string; caption: string | null }[];
  sizeCharts: { name: string; url: string | null }[];
}

export interface RosterState {
  order: { orderNumber: string; clubName: string | null; name: string | null; locked: boolean };
  guest: { id: string; email: string; name: string | null };
  garments: RosterStateGarment[];
  members: RosterStateMember[];
}

/** Everything the page renders, scoped to a verified guest. */
export async function getRosterState(orderNumber: string, guestId: string): Promise<RosterState> {
  const order = await getRosterPageOrder(orderNumber);
  if (!order) notFound();

  const guest = await db.query.rosterGuests.findFirst({
    where: and(eq(rosterGuests.id, guestId), eq(rosterGuests.orderId, order.id)),
  });
  if (!guest) badGate();

  const orderGarments = await db.query.garments.findMany({
    where: eq(garments.orderId, order.id),
    orderBy: [asc(garments.sortOrder)],
    with: {
      images: { orderBy: (i, { asc: a }) => [a(i.sortOrder)] },
      sizeChartLinks: { with: { sizeChart: true } },
    },
  });

  const stateGarments: RosterStateGarment[] = await Promise.all(
    orderGarments.map(async (g) => {
      const linkedCharts = g.sizeChartLinks.filter((l) => l.sizeChart);
      return {
        id: g.id,
        name: g.name,
        notes: g.notes ?? null,
        sizes: unionChartSizes(
          linkedCharts.map((l) => ({ sizes: (l.sizeChart!.sizes ?? []) as SizeChartSize[] })),
        ),
        sizingColumns: (g.sizingColumns ?? []) as GarmentTypeOption[],
        images: (await signImageRefs(g.images)).map((img) => ({
          url: img.thumbnailUrl ?? img.url,
          caption: img.caption ?? null,
        })),
        sizeCharts: (
          await signChartRefs(linkedCharts.map((l) => l.sizeChart!))
        ).map((c) => ({ name: c.name, url: c.url ?? c.downloadUrl ?? null })),
      };
    }),
  );

  const members = await db.query.rosterMembers.findMany({
    where: eq(rosterMembers.orderId, order.id),
    orderBy: [asc(rosterMembers.sortOrder), asc(rosterMembers.createdAt)],
    with: {
      sizing: { columns: { garmentId: true, size: true, customValues: true } },
      guest: { columns: { id: true, email: true, name: true } },
    },
  });

  return {
    order: {
      orderNumber: order.orderNumber,
      clubName: order.clubName,
      name: order.name,
      locked: order.rosterLockedAt !== null,
    },
    guest: { id: guest.id, email: guest.email, name: guest.name },
    garments: stateGarments,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      playerNumber: m.playerNumber ?? null,
      submittedAt: m.submittedAt ?? null,
      mine: m.guestId === guestId,
      addedBy: m.guest ? (m.guest.name || m.guest.email) : null,
      sizes: Object.fromEntries(
        m.sizing.map((row) => [
          row.garmentId,
          {
            size: row.size ?? null,
            customValues: (row.customValues as Record<string, string> | null) ?? null,
          },
        ]),
      ),
    })),
  };
}

export interface GuestMemberSizesInput {
  /** One entry per garment on the order. */
  sizes: {
    garmentId: string;
    size: string;
    customValues?: Record<string, string> | null;
  }[];
}

/**
 * Keep only custom values whose label matches a defined sizing column — the
 * definitions are the allowlist (same rule as the admin sizing writes), so a
 * hostile client can't stuff arbitrary keys into the jsonb.
 */
function sanitizeCustomValues(
  values: Record<string, string> | null | undefined,
  columns: GarmentTypeOption[],
): Record<string, string> | null {
  if (!values) return null;
  const allowed = new Set(columns.map((c) => c.label));
  const kept: Record<string, string> = {};
  for (const [label, value] of Object.entries(values)) {
    if (!allowed.has(label)) continue;
    const trimmed = String(value).trim();
    if (trimmed) kept[label] = trimmed.slice(0, 200);
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

async function assertGuest(orderId: string, guestId: string) {
  const guest = await db.query.rosterGuests.findFirst({
    where: and(eq(rosterGuests.id, guestId), eq(rosterGuests.orderId, orderId)),
    columns: { id: true },
  });
  if (!guest) badGate();
}

/** Add a player owned by this guest, with their sizes in the same submission. */
export async function addGuestMember(
  orderNumber: string,
  guestId: string,
  input: { name: string; playerNumber?: string | null; sizes: GuestMemberSizesInput['sizes'] },
): Promise<{ memberId: string }> {
  const order = await getRosterPageOrder(orderNumber);
  if (!order) notFound();
  if (order.rosterLockedAt) rosterLocked();
  await assertGuest(order.id, guestId);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(rosterMembers)
    .where(eq(rosterMembers.orderId, order.id));
  if (Number(total) >= MAX_ROSTER_MEMBERS) rosterFull();

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${rosterMembers.sortOrder}), -1)` })
    .from(rosterMembers)
    .where(eq(rosterMembers.orderId, order.id));

  const [member] = await db
    .insert(rosterMembers)
    .values({
      orderId: order.id,
      name: input.name.trim(),
      playerNumber: input.playerNumber?.trim() || null,
      guestId,
      sortOrder: Number(maxSort) + 1,
    })
    .returning({ id: rosterMembers.id, name: rosterMembers.name, playerNumber: rosterMembers.playerNumber });

  await writeGuestMemberSizes(order.id, member, input.sizes);
  return { memberId: member.id };
}

/** Update a member this guest owns — name, number, sizes. */
export async function updateGuestMember(
  orderNumber: string,
  guestId: string,
  memberId: string,
  input: { name?: string; playerNumber?: string | null; sizes: GuestMemberSizesInput['sizes'] },
): Promise<void> {
  const order = await getRosterPageOrder(orderNumber);
  if (!order) notFound();
  if (order.rosterLockedAt) rosterLocked();
  await assertGuest(order.id, guestId);

  const member = await db.query.rosterMembers.findFirst({
    where: and(eq(rosterMembers.id, memberId), eq(rosterMembers.orderId, order.id)),
    columns: { id: true, name: true, playerNumber: true, guestId: true },
  });
  if (!member) notFound();
  // Ownership: only the creator edits (David: no changing other people's sizes).
  if (member.guestId !== guestId) forbidden();

  const name = input.name?.trim();
  const playerNumber = input.playerNumber === undefined ? undefined : input.playerNumber?.trim() || null;
  if (name || playerNumber !== undefined) {
    await db
      .update(rosterMembers)
      .set({ ...(name && { name }), ...(playerNumber !== undefined && { playerNumber }) })
      .where(eq(rosterMembers.id, member.id));
  }

  await writeGuestMemberSizes(
    order.id,
    { id: member.id, name: name || member.name, playerNumber: playerNumber === undefined ? member.playerNumber : playerNumber },
    input.sizes,
  );
}

/** Remove a member this guest owns (with their sizing rows). */
export async function removeGuestMember(
  orderNumber: string,
  guestId: string,
  memberId: string,
): Promise<void> {
  const order = await getRosterPageOrder(orderNumber);
  if (!order) notFound();
  if (order.rosterLockedAt) rosterLocked();
  await assertGuest(order.id, guestId);

  const member = await db.query.rosterMembers.findFirst({
    where: and(eq(rosterMembers.id, memberId), eq(rosterMembers.orderId, order.id)),
    columns: { id: true, guestId: true },
  });
  if (!member) notFound();
  if (member.guestId !== guestId) forbidden();

  await db.transaction(async (tx) => {
    await tx.delete(garmentSizing).where(eq(garmentSizing.rosterMemberId, member.id));
    await tx.delete(rosterMembers).where(eq(rosterMembers.id, member.id));
  });
}

/**
 * The guest write path — same shape as customer-service writeMemberSizes but
 * carrying customValues per garment (David: the page must offer every option
 * the garment defines, e.g. a Colour column).
 */
async function writeGuestMemberSizes(
  orderId: string,
  member: { id: string; name: string; playerNumber: string | null },
  sizes: GuestMemberSizesInput['sizes'],
): Promise<void> {
  const orderGarments = await db.query.garments.findMany({
    where: eq(garments.orderId, orderId),
    columns: { id: true, sizingColumns: true },
    orderBy: [asc(garments.sortOrder)],
  });
  if (orderGarments.length === 0) invalidSizes();

  const byGarment = new Map(orderGarments.map((g) => [g.id, g]));
  if (sizes.length !== byGarment.size) invalidSizes();
  for (const row of sizes) {
    if (!byGarment.has(row.garmentId)) invalidSizes();
  }

  const existingRows = await db.query.garmentSizing.findMany({
    where: and(
      eq(garmentSizing.rosterMemberId, member.id),
      inArray(garmentSizing.garmentId, orderGarments.map((g) => g.id)),
    ),
    columns: { id: true, garmentId: true },
  });
  const existingByGarment = new Map(existingRows.map((row) => [row.garmentId, row]));

  const submittedAt = new Date();
  const memberFields = {
    playerName: member.name,
    playerNumber: member.playerNumber ?? null,
    notes: null,
  };

  const normalized = sizes.map((row) => ({
    garmentId: row.garmentId,
    size: row.size.trim(),
    customValues: sanitizeCustomValues(
      row.customValues,
      (byGarment.get(row.garmentId)!.sizingColumns ?? []) as GarmentTypeOption[],
    ),
  }));

  await db.transaction(async (tx) => {
    for (const row of normalized) {
      const existing = existingByGarment.get(row.garmentId);
      if (existing) {
        await tx
          .update(garmentSizing)
          .set({ size: row.size, customValues: row.customValues, ...memberFields })
          .where(eq(garmentSizing.id, existing.id));
      } else {
        const [{ maxSort }] = await tx
          .select({ maxSort: sql<number>`coalesce(max(${garmentSizing.sortOrder}), -1)` })
          .from(garmentSizing)
          .where(eq(garmentSizing.garmentId, row.garmentId));
        await tx.insert(garmentSizing).values({
          garmentId: row.garmentId,
          rosterMemberId: member.id,
          size: row.size,
          customValues: row.customValues,
          ...memberFields,
          sortOrder: Number(maxSort) + 1,
        });
      }
    }

    await tx.update(rosterMembers).set({ submittedAt }).where(eq(rosterMembers.id, member.id));
  });
}
