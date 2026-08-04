import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
import { createOrder, setRosterPage } from '@/server/orders/service';
import { addGuestMember, getRosterState } from './guest-service';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Jersey' }],
    ...overrides,
  });
}

async function seedGuestOrder() {
  const created = await createOrder(
    minimalInput({ garments: [{ name: 'Jersey' }, { name: 'Tribute Tee' }] }),
  );
  await setRosterPage(created.orderId, { enabled: true });
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, created.orderId),
    with: { garments: { orderBy: (g, { asc }) => [asc(g.sortOrder)] } },
  });
  const [sizedGarment, nameListGarment] = order!.garments;
  await db
    .update(schema.garments)
    .set({ nameListEnabled: true })
    .where(eq(schema.garments.id, nameListGarment.id));

  const [guest] = await db
    .insert(schema.rosterGuests)
    .values({ orderId: created.orderId, email: 'guest@example.com' })
    .returning();

  return { orderNumber: order!.orderNumber, sizedGarment, nameListGarment, guestId: guest.id };
}

describe('guest-service — "Got Your Back" name-list garments', () => {
  it('addGuestMember succeeds submitting a size only for the non-name-list garment', async () => {
    const { orderNumber, sizedGarment, guestId } = await seedGuestOrder();

    const result = await addGuestMember(orderNumber, guestId, {
      name: 'Alex',
      sizes: [{ garmentId: sizedGarment.id, size: 'M' }],
    });

    expect(result.memberId).toBeDefined();
    const rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.rosterMemberId, result.memberId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].garmentId).toBe(sizedGarment.id);
  });

  it('getRosterState exposes nameListEnabled/nameListEntries and keeps them out of sizing', async () => {
    const { orderNumber, nameListGarment, guestId } = await seedGuestOrder();

    const state = await getRosterState(orderNumber, guestId, true);
    const g = state.garments.find((garment) => garment.id === nameListGarment.id)!;

    expect(g.nameListEnabled).toBe(true);
    expect(g.nameListEntries).toEqual([]);
  });
});
