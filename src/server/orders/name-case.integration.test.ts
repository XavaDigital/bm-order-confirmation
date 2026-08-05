/**
 * Player-name casing (David, 2026-08-05): `orders.namesUppercase`.
 *
 * Turning the flag ON retro-uppercases every name already saved for THAT order
 * (garment_sizing.playerName, garment_name_list_entries.name,
 * roster_members.name) in the same transaction; turning it OFF converts
 * nothing back — the original casing is gone and inventing one would be worse
 * than leaving capitals standing. Writers are expected to apply the case at
 * write time (applyNameCase in src/lib/names.ts) so what is saved IS what
 * prints.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from './contract';
import {
  createOrder,
  getRosterPageSettings,
  setRosterPage,
  upsertNameListEntries,
  upsertSizingRows,
} from './service';
import { addRosterMember } from '@/server/roster/service';

afterEach(async () => {
  await resetTestDb(db);
});

/** An order with lowercase names in all three name stores. */
async function seedOrderWithNames() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [
        {
          name: 'Team Hoodie',
          sizing: [
            { size: 'M', playerName: 'ava smith' },
            { size: 'L', playerName: 'billy o’neil' },
            { size: 'S' }, // no name — must survive the conversion as null
          ],
        },
      ],
    }),
  );
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  }))!;
  await upsertNameListEntries(garment.id, [{ name: 'carla' }, { name: 'dee jones' }]);
  await addRosterMember(created.orderId, { name: 'evan lee' });
  return { orderId: created.orderId, garmentId: garment.id };
}

async function readNames(orderId: string, garmentId: string) {
  const sizing = await db.query.garmentSizing.findMany({
    where: eq(schema.garmentSizing.garmentId, garmentId),
    orderBy: (s, { asc }) => [asc(s.sortOrder)],
  });
  const nameList = await db.query.garmentNameListEntries.findMany({
    where: eq(schema.garmentNameListEntries.garmentId, garmentId),
    orderBy: (n, { asc }) => [asc(n.sortOrder)],
  });
  const members = await db.query.rosterMembers.findMany({
    where: eq(schema.rosterMembers.orderId, orderId),
  });
  return {
    playerNames: sizing.map((s) => s.playerName),
    listNames: nameList.map((n) => n.name),
    memberNames: members.map((m) => m.name),
  };
}

describe('setRosterPage namesUppercase', () => {
  it('turning CAPITALS on converts every saved name store for the order, in one go', async () => {
    const { orderId, garmentId } = await seedOrderWithNames();

    const result = await setRosterPage(orderId, { namesUppercase: true }, { actorEmail: 'staff@x.com' });
    expect(result.namesUppercase).toBe(true);

    const names = await readNames(orderId, garmentId);
    expect(names.playerNames).toEqual(['AVA SMITH', 'BILLY O’NEIL', null]);
    expect(names.listNames).toEqual(['CARLA', 'DEE JONES']);
    expect(names.memberNames).toEqual(['EVAN LEE']);
  });

  it('records the conversion in the audit payload', async () => {
    const { orderId } = await seedOrderWithNames();

    await setRosterPage(orderId, { namesUppercase: true }, { actorEmail: 'staff@x.com' });

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'roster.page_updated'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({
      namesUppercase: true,
      convertedExistingNames: true,
    });
    expect(audits[0].actorEmail).toBe('staff@x.com');
  });

  it('does not touch another order’s names', async () => {
    const { orderId } = await seedOrderWithNames();
    const other = await seedOrderWithNames();

    await setRosterPage(orderId, { namesUppercase: true });

    const otherNames = await readNames(other.orderId, other.garmentId);
    expect(otherNames.playerNames).toEqual(['ava smith', 'billy o’neil', null]);
    expect(otherNames.listNames).toEqual(['carla', 'dee jones']);
    expect(otherNames.memberNames).toEqual(['evan lee']);
  });

  it('updating other settings with the flag off converts nothing', async () => {
    const { orderId, garmentId } = await seedOrderWithNames();

    await setRosterPage(orderId, { enabled: true });

    const names = await readNames(orderId, garmentId);
    expect(names.playerNames).toEqual(['ava smith', 'billy o’neil', null]);
    expect(names.listNames).toEqual(['carla', 'dee jones']);
    expect(names.memberNames).toEqual(['evan lee']);
  });

  it('setting the flag when it is already on does not re-report a conversion', async () => {
    const { orderId } = await seedOrderWithNames();
    await setRosterPage(orderId, { namesUppercase: true });

    await setRosterPage(orderId, { namesUppercase: true });

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'roster.page_updated'),
      ),
      orderBy: (a, { asc }) => [asc(a.createdAt)],
    });
    expect(audits).toHaveLength(2);
    expect(audits[1].payload).not.toHaveProperty('convertedExistingNames');
  });

  it('turning the flag OFF converts nothing back — capitals stand', async () => {
    const { orderId, garmentId } = await seedOrderWithNames();
    await setRosterPage(orderId, { namesUppercase: true });

    const result = await setRosterPage(orderId, { namesUppercase: false });
    expect(result.namesUppercase).toBe(false);

    const names = await readNames(orderId, garmentId);
    expect(names.playerNames).toEqual(['AVA SMITH', 'BILLY O’NEIL', null]);
    expect(names.listNames).toEqual(['CARLA', 'DEE JONES']);
    expect(names.memberNames).toEqual(['EVAN LEE']);
  });

  it('throws NotFound for an unknown order', async () => {
    await expect(
      setRosterPage('00000000-0000-4000-8000-000000000000', { namesUppercase: true }),
    ).rejects.toThrow('Order not found');
  });
});

describe('getRosterPageSettings', () => {
  it('round-trips namesUppercase and defaults to false', async () => {
    const { orderId } = await seedOrderWithNames();

    expect((await getRosterPageSettings(orderId)).namesUppercase).toBe(false);

    await setRosterPage(orderId, { namesUppercase: true });
    expect((await getRosterPageSettings(orderId)).namesUppercase).toBe(true);

    await setRosterPage(orderId, { namesUppercase: false });
    expect((await getRosterPageSettings(orderId)).namesUppercase).toBe(false);
  });
});

/**
 * Write-time enforcement: with the flag ON, a name saved through any writer
 * lands uppercase (David: "no matter whether you type lowercase or not … it
 * will always … be saved as capitals"). These codify the intended behavior of
 * the applyNameCase wiring in the writers.
 */
describe('writers save capitals while namesUppercase is on', () => {
  it('upsertSizingRows saves playerName uppercase when the flag is on, as typed when off', async () => {
    const { orderId, garmentId } = await seedOrderWithNames();
    await setRosterPage(orderId, { namesUppercase: true });

    await upsertSizingRows(garmentId, [{ size: 'M', playerName: 'freddie new' }]);
    let rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.garmentId, garmentId),
    });
    expect(rows.map((r) => r.playerName)).toEqual(['FREDDIE NEW']);

    await setRosterPage(orderId, { namesUppercase: false });
    await upsertSizingRows(garmentId, [{ size: 'M', playerName: 'gina typed' }]);
    rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.garmentId, garmentId),
    });
    expect(rows.map((r) => r.playerName)).toEqual(['gina typed']);
  });

  it('upsertNameListEntries saves names uppercase when the flag is on', async () => {
    const { orderId, garmentId } = await seedOrderWithNames();
    await setRosterPage(orderId, { namesUppercase: true });

    await upsertNameListEntries(garmentId, [{ name: 'harry lower' }]);

    const entries = await db.query.garmentNameListEntries.findMany({
      where: eq(schema.garmentNameListEntries.garmentId, garmentId),
    });
    expect(entries.map((e) => e.name)).toEqual(['HARRY LOWER']);
  });

  it('addRosterMember saves the member name uppercase when the flag is on', async () => {
    const { orderId } = await seedOrderWithNames();
    await setRosterPage(orderId, { namesUppercase: true });

    const member = await addRosterMember(orderId, { name: 'iris lower' });

    expect(member.name).toBe('IRIS LOWER');
  });
});
