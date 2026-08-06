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
import { applyNameCase } from '@/lib/names';
import { customerChartLinks, unionChartSizes } from '@/lib/sizes';
import { signImageRefs, signChartRefs } from '@/lib/signed-urls';
import {
  upsertNameListEntries,
  importNameListFromRoster,
  NameListFullError,
} from '@/server/orders/service';
import type { UpsertNameListInput } from '@/server/orders/name-list-contract';
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
  customerEmail: string;
  rosterPassword: string | null;
  rosterAdminPasswordHash: string | null;
  rosterLockedAt: Date | null;
  /** Names print in CAPITALS — applied at every name write (src/lib/names.ts). */
  namesUppercase: boolean;
}

/**
 * The roster-enabled order behind a short URL, or null (generic 404).
 * The slug is the BARE numeric order number by preference (David:
 * /roster/10023) — a run of digits resolves as `OC-<digits>`; anything else
 * (legacy random numbers) matches the stored order number verbatim.
 */
export async function getRosterPageOrder(slug: string): Promise<RosterPageOrder | null> {
  const orderNumber = /^\d+$/.test(slug) ? `OC-${slug}` : slug;
  const order = await db.query.orders.findFirst({
    where: eq(orders.orderNumber, orderNumber),
    columns: {
      id: true,
      orderNumber: true,
      clubName: true,
      name: true,
      customerEmail: true,
      rosterPassword: true,
      rosterAdminPasswordHash: true,
      rosterLockedAt: true,
      rosterEnabledAt: true,
      namesUppercase: true,
    },
  });
  if (!order || !order.rosterEnabledAt) return null;
  return order;
}

/**
 * Pass the gate and become a guest: password (or token link) + email → the
 * guest row, upserted on (order, lowercased email). Callers set the session
 * cookie from the result.
 *
 * CLUB ADMIN (David, 2026-08-03): the guest whose email matches the order's
 * customer email may edit anyone's players — so that email alone must not be
 * enough. Their first visit SETS their own password (`adminPassword` with
 * `settingAdminPassword`); later visits must present it. Staff reset clears
 * the hash, returning them to the first-visit flow.
 */
export async function enterRoster(params: {
  orderNumber: string;
  email: string;
  name?: string | null;
  password?: string | null;
  token?: string | null;
  adminPassword?: string | null;
  settingAdminPassword?: boolean;
}): Promise<{ order: RosterPageOrder; guestId: string; role: 'guest' | 'admin' }> {
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
  const isClubAdminEmail = email === order.customerEmail.trim().toLowerCase();

  let role: 'guest' | 'admin' = 'guest';
  if (isClubAdminEmail) {
    const bcrypt = (await import('bcryptjs')).default;
    if (!order.rosterAdminPasswordHash) {
      // First visit: they must CHOOSE a password before becoming the admin.
      if (!params.settingAdminPassword || !params.adminPassword || params.adminPassword.length < 6) {
        throw new Error('admin_password_setup_required');
      }
      const hash = await bcrypt.hash(params.adminPassword, 12);
      await db
        .update(orders)
        .set({ rosterAdminPasswordHash: hash })
        .where(eq(orders.id, order.id));
      order.rosterAdminPasswordHash = hash;
      role = 'admin';
    } else {
      if (!params.adminPassword) throw new Error('admin_password_required');
      const ok = await bcrypt.compare(params.adminPassword, order.rosterAdminPasswordHash);
      if (!ok) throw new Error('bad_admin_password');
      role = 'admin';
    }
  }

  const [guest] = await db
    .insert(rosterGuests)
    .values({ orderId: order.id, email, name })
    .onConflictDoUpdate({
      target: [rosterGuests.orderId, rosterGuests.email],
      set: { lastSeenAt: new Date(), ...(name ? { name } : {}) },
    })
    .returning({ id: rosterGuests.id });

  return { order, guestId: guest.id, role };
}

export interface RosterStateMember {
  id: string;
  name: string;
  playerNumber: string | null;
  submittedAt: Date | null;
  /** Added by the signed-in guest. */
  mine: boolean;
  /** Editable by the signed-in guest — their own, or anyone's for the club admin. */
  canEdit: boolean;
  addedBy: string | null;
  /**
   * garmentId → the row as it will print. Name/number are PER GARMENT
   * (David, 2026-08-04: a player may want different names/numbers on
   * different gear); the member's own name is just their list identity.
   */
  sizes: Record<
    string,
    {
      size: string | null;
      playerName: string | null;
      playerNumber: string | null;
      customValues: Record<string, string> | null;
    }
  >;
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
  /**
   * "Got Your Back" style (GOT_YOUR_BACK_PLAN.md) — many names on one shared
   * design, excluded from the per-member sizing flow above. Club-admin-edited
   * only (updateGuestGarmentNameList / importGuestGarmentNameListFromRoster).
   */
  nameListEnabled: boolean;
  nameListRows: number | null;
  nameListEntries: { id: string; name: string; playerNumber: string | null }[];
}

export interface RosterState {
  order: {
    orderNumber: string;
    clubName: string | null;
    name: string | null;
    locked: boolean;
    /** Drives the "printed in CAPITALS" / "printed as entered" notice. */
    namesUppercase: boolean;
  };
  guest: { id: string; email: string; name: string | null; isAdmin: boolean };
  garments: RosterStateGarment[];
  members: RosterStateMember[];
}

/** Everything the page renders, scoped to a verified guest. */
export async function getRosterState(
  orderNumber: string,
  guestId: string,
  isAdmin = false,
): Promise<RosterState> {
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
      nameListEntries: { orderBy: (e, { asc: a }) => [a(e.sortOrder)] },
    },
  });

  const stateGarments: RosterStateGarment[] = await Promise.all(
    orderGarments.map(async (g) => {
      // Customer surface — production charts (factory detail) never show here.
      const linkedCharts = customerChartLinks(g.sizeChartLinks);
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
        nameListEnabled: g.nameListEnabled,
        nameListRows: g.nameListRows,
        nameListEntries: g.nameListEntries.map((e) => ({
          id: e.id,
          name: e.name,
          playerNumber: e.playerNumber,
        })),
      };
    }),
  );

  const members = await db.query.rosterMembers.findMany({
    where: eq(rosterMembers.orderId, order.id),
    orderBy: [asc(rosterMembers.sortOrder), asc(rosterMembers.createdAt)],
    with: {
      sizing: {
        columns: {
          garmentId: true,
          size: true,
          playerName: true,
          playerNumber: true,
          customValues: true,
        },
      },
      guest: { columns: { id: true, email: true, name: true } },
    },
  });

  return {
    order: {
      orderNumber: order.orderNumber,
      clubName: order.clubName,
      name: order.name,
      locked: order.rosterLockedAt !== null,
      namesUppercase: order.namesUppercase,
    },
    guest: { id: guest.id, email: guest.email, name: guest.name, isAdmin },
    garments: stateGarments,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      playerNumber: m.playerNumber ?? null,
      submittedAt: m.submittedAt ?? null,
      mine: m.guestId === guestId,
      canEdit: isAdmin || m.guestId === guestId,
      addedBy: m.guest ? (m.guest.name || m.guest.email) : null,
      sizes: Object.fromEntries(
        m.sizing.map((row) => [
          row.garmentId,
          {
            size: row.size ?? null,
            playerName: row.playerName ?? null,
            playerNumber: row.playerNumber ?? null,
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
    /** Name/number ON THIS GARMENT — falls back to the member's name. */
    playerName?: string | null;
    playerNumber?: string | null;
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
      name: applyNameCase(order.namesUppercase, input.name.trim()),
      playerNumber: input.playerNumber?.trim() || null,
      guestId,
      sortOrder: Number(maxSort) + 1,
    })
    .returning({ id: rosterMembers.id, name: rosterMembers.name, playerNumber: rosterMembers.playerNumber });

  await writeGuestMemberSizes(order.id, member, input.sizes, order.namesUppercase);
  return { memberId: member.id };
}

/** Update a member — their creator's, or anyone's for the club admin. */
export async function updateGuestMember(
  orderNumber: string,
  guestId: string,
  memberId: string,
  input: { name?: string; playerNumber?: string | null; sizes: GuestMemberSizesInput['sizes'] },
  isAdmin = false,
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
  // Ownership: the creator, or the club admin (David: the club admin can
  // edit anyone's sizes; everyone else only their own).
  if (!isAdmin && member.guestId !== guestId) forbidden();

  const name = input.name?.trim()
    ? applyNameCase(order.namesUppercase, input.name.trim())
    : undefined;
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
    order.namesUppercase,
  );
}

/** Remove a member — their creator's, or anyone's for the club admin. */
export async function removeGuestMember(
  orderNumber: string,
  guestId: string,
  memberId: string,
  isAdmin = false,
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
  if (!isAdmin && member.guestId !== guestId) forbidden();

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
  namesUppercase: boolean,
): Promise<void> {
  // "Got Your Back" name-list garments (GOT_YOUR_BACK_PLAN.md) are excluded —
  // they carry no size, and no per-member submission applies to them; the
  // club admin edits the name list directly (updateGuestGarmentNameList below).
  const orderGarments = await db.query.garments.findMany({
    where: and(eq(garments.orderId, orderId), eq(garments.nameListEnabled, false)),
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

  const normalized = sizes.map((row) => ({
    garmentId: row.garmentId,
    size: row.size.trim(),
    // Per-garment name/number (David, 2026-08-04); the member's own name is
    // the default when a garment doesn't override it.
    playerName: applyNameCase(namesUppercase, row.playerName?.trim() || member.name),
    playerNumber: row.playerNumber?.trim() || null,
    customValues: sanitizeCustomValues(
      row.customValues,
      (byGarment.get(row.garmentId)!.sizingColumns ?? []) as GarmentTypeOption[],
    ),
  }));

  await db.transaction(async (tx) => {
    for (const row of normalized) {
      const existing = existingByGarment.get(row.garmentId);
      const rowFields = {
        size: row.size,
        playerName: row.playerName,
        playerNumber: row.playerNumber,
        customValues: row.customValues,
        notes: null,
      };
      if (existing) {
        await tx.update(garmentSizing).set(rowFields).where(eq(garmentSizing.id, existing.id));
      } else {
        const [{ maxSort }] = await tx
          .select({ maxSort: sql<number>`coalesce(max(${garmentSizing.sortOrder}), -1)` })
          .from(garmentSizing)
          .where(eq(garmentSizing.garmentId, row.garmentId));
        await tx.insert(garmentSizing).values({
          garmentId: row.garmentId,
          rosterMemberId: member.id,
          ...rowFields,
          sortOrder: Number(maxSort) + 1,
        });
      }
    }

    await tx.update(rosterMembers).set({ submittedAt }).where(eq(rosterMembers.id, member.id));
  });
}

// ---------------------------------------------------------------------------
// "Got Your Back" name list — CLUB ADMIN ONLY (unlike sizes above, which each
// guest owns their own player's). The list is order-wide print content, not
// one guest's property, so it follows the same "club admin edits anyone's"
// rule already used for member sizes rather than introducing a new one.
// ---------------------------------------------------------------------------

async function assertNameListGarment(orderId: string, garmentId: string): Promise<void> {
  const garment = await db.query.garments.findFirst({
    where: and(eq(garments.id, garmentId), eq(garments.orderId, orderId)),
    columns: { id: true, nameListEnabled: true },
  });
  if (!garment || !garment.nameListEnabled) notFound();
}

export async function updateGuestGarmentNameList(
  orderNumber: string,
  guestId: string,
  isAdmin: boolean,
  garmentId: string,
  entries: UpsertNameListInput,
) {
  if (!isAdmin) throw new Error('admin_only');
  const order = await getRosterPageOrder(orderNumber);
  if (!order) notFound();
  if (order.rosterLockedAt) rosterLocked();
  await assertGuest(order.id, guestId);
  await assertNameListGarment(order.id, garmentId);

  try {
    return await upsertNameListEntries(garmentId, entries);
  } catch (err) {
    if (err instanceof NameListFullError) throw new Error('name_list_full');
    throw err;
  }
}

export async function updateGuestGarmentNameListRows(
  orderNumber: string,
  guestId: string,
  isAdmin: boolean,
  garmentId: string,
  rows: number | null,
) {
  if (!isAdmin) throw new Error('admin_only');
  const order = await getRosterPageOrder(orderNumber);
  if (!order) notFound();
  if (order.rosterLockedAt) rosterLocked();
  await assertGuest(order.id, guestId);
  await assertNameListGarment(order.id, garmentId);

  await db.update(garments).set({ nameListRows: rows, updatedAt: new Date() }).where(eq(garments.id, garmentId));
}

export async function importGuestGarmentNameListFromRoster(
  orderNumber: string,
  guestId: string,
  isAdmin: boolean,
  garmentId: string,
) {
  if (!isAdmin) throw new Error('admin_only');
  const order = await getRosterPageOrder(orderNumber);
  if (!order) notFound();
  if (order.rosterLockedAt) rosterLocked();
  await assertGuest(order.id, guestId);
  await assertNameListGarment(order.id, garmentId);

  try {
    return await importNameListFromRoster(garmentId);
  } catch (err) {
    if (err instanceof NameListFullError) throw new Error('name_list_full');
    throw err;
  }
}
