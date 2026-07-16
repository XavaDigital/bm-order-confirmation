import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { addRosterMember, generateRosterToken, revokeRosterToken, generateMemberToken, MAX_ROSTER_MEMBERS } from './service';
import {
  addSelf,
  getRosterForMember,
  submitMemberSizes,
  getRosterForMemberByMemberToken,
  submitMemberSizesByMemberToken,
} from './customer-service';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedSizeChart(name = 'Adult Unisex') {
  const [chart] = await db.insert(schema.sizeCharts).values({ name }).returning();
  return chart;
}

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com', clubName: 'Wildcats' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

describe('getRosterForMember', () => {
  it('returns null for an unknown token', async () => {
    expect(await getRosterForMember('bogus')).toBeNull();
  });

  it('returns null for revoked or expired tokens', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateRosterToken(created.orderId);

    await revokeRosterToken(created.orderId);
    expect(await getRosterForMember(token)).toBeNull();

    const { token: token2 } = await generateRosterToken(created.orderId);
    await db
      .update(schema.rosterAccess)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.rosterAccess.orderId, created.orderId));
    expect(await getRosterForMember(token2)).toBeNull();
  });

  it('returns the roster-scoped order data, member sizes, and touches lastViewedAt', async () => {
    const chart = await seedSizeChart('Women Chart');
    const created = await createOrder(
      minimalInput({
        orderValue: { amount: 1200, currency: 'NZD' },
        invoiceUrl: 'https://example.com/invoice',
        shipping: { mode: 'prefilled', address: { line1: '123 Test St' } },
        generalNotes: 'Manager only',
        garments: [
          { name: 'Jersey', sizeChartIds: [chart.id] },
          { name: 'Shorts' },
        ],
      }),
    );
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: { orderBy: (g, { asc }) => [asc(g.sortOrder)] } },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });
    await db
      .insert(schema.garmentSizing)
      .values({
        garmentId: order!.garments[0].id,
        rosterMemberId: member.id,
        playerName: 'Alex',
        playerNumber: '7',
        size: 'M',
        sortOrder: 0,
      });
    await db
      .update(schema.rosterMembers)
      .set({ submittedAt: new Date() })
      .where(eq(schema.rosterMembers.id, member.id));
    const { token } = await generateRosterToken(created.orderId);

    const result = await getRosterForMember(token);

    expect(result).not.toBeNull();
    expect(result!.order.orderNumber).toBe(created.orderNumber);
    expect(result!.order.clubName).toBe('Wildcats');
    expect(result!.order.locked).toBe(false);
    expect(result!.order.garments[0].sizeCharts[0].name).toBe('Women Chart');
    expect(result!.members[0].sizes).toEqual([{ garmentId: order!.garments[0].id, size: 'M' }]);
    expect('orderValueAmount' in result!.order).toBe(false);
    expect('invoiceUrl' in result!.order).toBe(false);
    expect('shippingAddress' in result!.order).toBe(false);

    const access = await db.query.rosterAccess.findFirst({
      where: and(eq(schema.rosterAccess.orderId, created.orderId), isNull(schema.rosterAccess.revokedAt)),
    });
    expect(access!.lastViewedAt).not.toBeNull();
  });
});

describe('addSelf', () => {
  it('rejects a revoked or expired token', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateRosterToken(created.orderId);
    await revokeRosterToken(created.orderId);

    await expect(addSelf(token, { name: 'Sam' })).rejects.toThrow('invalid_token');

    const { token: token2 } = await generateRosterToken(created.orderId);
    await db
      .update(schema.rosterAccess)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.rosterAccess.orderId, created.orderId));

    await expect(addSelf(token2, { name: 'Sam' })).rejects.toThrow('invalid_token');
  });

  it('adds a roster member for a valid token', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateRosterToken(created.orderId);

    const member = await addSelf(token, { name: 'Sam', playerNumber: '9', email: 'sam@example.com' });

    expect(member.name).toBe('Sam');
    expect(member.playerNumber).toBe('9');
    expect(member.submittedAt).toBeNull();
    expect(member.sizes).toEqual([]);
  });

  it('throws roster_locked when the order is locked', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateRosterToken(created.orderId);
    await db
      .update(schema.orders)
      .set({ rosterLockedAt: new Date() })
      .where(eq(schema.orders.id, created.orderId));

    await expect(addSelf(token, { name: 'Sam' })).rejects.toThrow('roster_locked');
  });

  it('throws roster_full once the roster is at MAX_ROSTER_MEMBERS', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateRosterToken(created.orderId);
    await db.insert(schema.rosterMembers).values(
      Array.from({ length: MAX_ROSTER_MEMBERS }, (_, i) => ({
        orderId: created.orderId,
        name: `Player ${i}`,
        sortOrder: i,
      })),
    );

    await expect(addSelf(token, { name: 'One Too Many' })).rejects.toThrow('roster_full');
  });
});

describe('submitMemberSizes', () => {
  it('inserts member sizing rows across all garments and marks the member submitted', async () => {
    const created = await createOrder(
      minimalInput({
        garments: [{ name: 'Jersey' }, { name: 'Shorts' }],
      }),
    );
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: { orderBy: (g, { asc }) => [asc(g.sortOrder)] } },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });
    const { token } = await generateRosterToken(created.orderId);

    const updatedMember = await submitMemberSizes(token, member.id, {
      sizes: [
        { garmentId: order!.garments[0].id, size: 'M' },
        { garmentId: order!.garments[1].id, size: 'L' },
      ],
    });

    expect(updatedMember.submittedAt).not.toBeNull();
    expect(updatedMember.sizes).toHaveLength(2);

    const rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.rosterMemberId, member.id),
      orderBy: (row, { asc }) => [asc(row.sortOrder)],
    });
    expect(rows.map((row) => row.size)).toEqual(['M', 'L']);
    expect(rows.every((row) => row.playerName === 'Alex')).toBe(true);
    expect(rows.every((row) => row.playerNumber === '7')).toBe(true);
  });

  it('updates existing rows instead of creating duplicates on resubmit', async () => {
    const created = await createOrder(minimalInput());
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const { token } = await generateRosterToken(created.orderId);

    await submitMemberSizes(token, member.id, {
      sizes: [{ garmentId: order!.garments[0].id, size: 'M' }],
    });
    await submitMemberSizes(token, member.id, {
      sizes: [{ garmentId: order!.garments[0].id, size: 'L' }],
    });

    const rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.rosterMemberId, member.id),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].size).toBe('L');
  });

  it('rejects a revoked roster token', async () => {
    const created = await createOrder(minimalInput());
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const { token } = await generateRosterToken(created.orderId);
    await revokeRosterToken(created.orderId);

    await expect(
      submitMemberSizes(token, member.id, {
        sizes: [{ garmentId: order!.garments[0].id, size: 'M' }],
      }),
    ).rejects.toThrow('invalid_token');
  });

  it('rejects invalid tokens, locked rosters, and cross-order members', async () => {
    const created = await createOrder(minimalInput());
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const other = await createOrder(minimalInput());
    const otherMember = await addRosterMember(other.orderId, { name: 'Sam' });
    const { token } = await generateRosterToken(created.orderId);

    await expect(
      submitMemberSizes('bogus', member.id, {
        sizes: [{ garmentId: order!.garments[0].id, size: 'M' }],
      }),
    ).rejects.toThrow('invalid_token');

    await expect(
      submitMemberSizes(token, otherMember.id, {
        sizes: [{ garmentId: order!.garments[0].id, size: 'M' }],
      }),
    ).rejects.toThrow('member_not_found');

    await db
      .update(schema.orders)
      .set({ rosterLockedAt: new Date() })
      .where(eq(schema.orders.id, created.orderId));

    await expect(
      submitMemberSizes(token, member.id, {
        sizes: [{ garmentId: order!.garments[0].id, size: 'M' }],
      }),
    ).rejects.toThrow('roster_locked');
  });
});

describe('getRosterForMemberByMemberToken', () => {
  it('returns null for an unknown token', async () => {
    expect(await getRosterForMemberByMemberToken('bogus')).toBeNull();
  });

  it('returns null for a revoked or expired token', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const { token } = await generateMemberToken(member.id);

    await db
      .update(schema.rosterMemberAccess)
      .set({ revokedAt: new Date() })
      .where(eq(schema.rosterMemberAccess.rosterMemberId, member.id));
    expect(await getRosterForMemberByMemberToken(token)).toBeNull();

    const { token: token2 } = await generateMemberToken(member.id);
    await db
      .update(schema.rosterMemberAccess)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.rosterMemberAccess.rosterMemberId, member.id));
    expect(await getRosterForMemberByMemberToken(token2)).toBeNull();
  });

  it('returns only this member\'s scoped data (no other members list) and touches lastViewedAt', async () => {
    const chart = await seedSizeChart('Women Chart');
    const created = await createOrder(
      minimalInput({
        orderValue: { amount: 1200, currency: 'NZD' },
        invoiceUrl: 'https://example.com/invoice',
        shipping: { mode: 'prefilled', address: { line1: '123 Test St' } },
        generalNotes: 'Manager only',
        garments: [{ name: 'Jersey', sizeChartIds: [chart.id] }],
      }),
    );
    const alex = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });
    await addRosterMember(created.orderId, { name: 'Sam' });
    const { token } = await generateMemberToken(alex.id);

    const result = await getRosterForMemberByMemberToken(token);

    expect(result).not.toBeNull();
    expect(result!.order.orderNumber).toBe(created.orderNumber);
    expect(result!.order.garments[0].sizeCharts[0].name).toBe('Women Chart');
    expect(result!.member.name).toBe('Alex');
    expect(result!.member.playerNumber).toBe('7');
    expect('members' in result!).toBe(false);
    expect('orderValueAmount' in result!.order).toBe(false);
    expect('invoiceUrl' in result!.order).toBe(false);
    expect('shippingAddress' in result!.order).toBe(false);

    const access = await db.query.rosterMemberAccess.findFirst({
      where: and(eq(schema.rosterMemberAccess.rosterMemberId, alex.id), isNull(schema.rosterMemberAccess.revokedAt)),
    });
    expect(access!.lastViewedAt).not.toBeNull();
  });
});

describe('submitMemberSizesByMemberToken', () => {
  it('inserts sizing rows and marks the member submitted, keyed by the token alone', async () => {
    const created = await createOrder(
      minimalInput({ garments: [{ name: 'Jersey' }, { name: 'Shorts' }] }),
    );
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: { orderBy: (g, { asc }) => [asc(g.sortOrder)] } },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });
    const { token } = await generateMemberToken(member.id);

    const updated = await submitMemberSizesByMemberToken(token, {
      sizes: [
        { garmentId: order!.garments[0].id, size: 'M' },
        { garmentId: order!.garments[1].id, size: 'L' },
      ],
    });

    expect(updated.submittedAt).not.toBeNull();
    expect(updated.sizes).toHaveLength(2);

    const rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.rosterMemberId, member.id),
    });
    expect(rows).toHaveLength(2);
  });

  it('updates existing rows instead of duplicating on resubmit', async () => {
    const created = await createOrder(minimalInput());
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const { token } = await generateMemberToken(member.id);

    await submitMemberSizesByMemberToken(token, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] });
    await submitMemberSizesByMemberToken(token, { sizes: [{ garmentId: order!.garments[0].id, size: 'L' }] });

    const rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.rosterMemberId, member.id),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].size).toBe('L');
  });

  it('rejects a bogus or revoked token', async () => {
    const created = await createOrder(minimalInput());
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const { token } = await generateMemberToken(member.id);

    await expect(
      submitMemberSizesByMemberToken('bogus', { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }),
    ).rejects.toThrow('invalid_token');

    await db
      .update(schema.rosterMemberAccess)
      .set({ revokedAt: new Date() })
      .where(eq(schema.rosterMemberAccess.rosterMemberId, member.id));

    await expect(
      submitMemberSizesByMemberToken(token, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }),
    ).rejects.toThrow('invalid_token');
  });

  it('rejects when the roster is locked', async () => {
    const created = await createOrder(minimalInput());
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const { token } = await generateMemberToken(member.id);
    await db
      .update(schema.orders)
      .set({ rosterLockedAt: new Date() })
      .where(eq(schema.orders.id, created.orderId));

    await expect(
      submitMemberSizesByMemberToken(token, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }),
    ).rejects.toThrow('roster_locked');
  });
});
