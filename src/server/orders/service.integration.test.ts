import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { createOrderSchema } from './contract';
import {
  createOrder,
  listOrders,
  getOrderAdmin,
  getOrderById,
  updateOrder,
  deleteOrder,
  addGarment,
  updateGarment,
  deleteGarment,
  upsertSizingRows,
  addMockupImage,
  updateGarmentSizeChartLinks,
  deleteMockupImage,
  generateAccessToken,
  revokeAccessToken,
  getOrderByToken,
  NotFoundError,
  ConflictError,
} from './service';
import { tokensMatch } from '@/lib/tokens';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedSizeChart(name = 'Adult Unisex') {
  const [chart] = await db.insert(schema.sizeCharts).values({ name }).returning();
  return chart;
}

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

describe('createOrder', () => {
  it('creates rows across orders/garments/sizing/mockups/sizeChartLinks/orderAccess in one transaction', async () => {
    const chart = await seedSizeChart();
    const input = minimalInput({
      garments: [
        {
          name: 'Home Jersey',
          sizing: [{ size: 'M', playerName: 'A. Smith', playerNumber: '7' }],
          mockupStorageKeys: ['mockups/front.png', 'mockups/back.png'],
          sizeChartIds: [chart.id],
        },
        { name: 'Away Jersey' },
      ],
    });

    const result = await createOrder(input);

    expect(result.orderNumber).toMatch(/^OC-[0-9A-F]{8}$/);
    expect(tokensMatch(result.token, (await db.query.orderAccess.findFirst())!.tokenHash)).toBe(
      true,
    );

    const order = await getOrderAdmin(result.orderId);
    expect(order!.garments).toHaveLength(2);
    expect(order!.garments[0].name).toBe('Home Jersey');
    expect(order!.garments[0].sortOrder).toBe(0);
    expect(order!.garments[1].sortOrder).toBe(1);
    expect(order!.garments[0].sizing).toHaveLength(1);
    expect(order!.garments[0].images).toHaveLength(2);
    expect(order!.garments[0].sizeChartLinks).toHaveLength(1);
    expect(order!.garments[1].sizing).toHaveLength(0);
  });

  it('skips child inserts for a garment with no sizing/mockups/sizeChartIds', async () => {
    const result = await createOrder(minimalInput());
    const order = await getOrderAdmin(result.orderId);
    expect(order!.garments[0].sizing).toHaveLength(0);
    expect(order!.garments[0].images).toHaveLength(0);
    expect(order!.garments[0].sizeChartLinks).toHaveLength(0);
  });

  it('rolls back the whole transaction if a later insert fails', async () => {
    const input = minimalInput({
      garments: [
        { name: 'Home Jersey' },
        // references a size chart that doesn't exist -> FK violation on the second garment,
        // after the order + first garment have already been inserted in this same tx.
        { name: 'Away Jersey', sizeChartIds: ['00000000-0000-0000-0000-000000000000'] },
      ],
    });

    await expect(createOrder(input)).rejects.toThrow();

    const allOrders = await db.select().from(schema.orders);
    const allGarments = await db.select().from(schema.garments);
    expect(allOrders).toHaveLength(0);
    expect(allGarments).toHaveLength(0);
  });
});

describe('listOrders', () => {
  it('filters by status and search, and paginates', async () => {
    const a = await createOrder(
      minimalInput({ customer: { name: 'Alpha Club', email: 'a@example.com' } }),
    );
    await createOrder(
      minimalInput({ customer: { name: 'Beta Club', email: 'b@example.com' } }),
    );
    await updateOrder(a.orderId, { status: 'sent' });

    const sentOnly = await listOrders({ status: 'sent' });
    expect(sentOnly.orders).toHaveLength(1);
    expect(sentOnly.orders[0].customerName).toBe('Alpha Club');

    const searched = await listOrders({ search: 'beta' });
    expect(searched.orders).toHaveLength(1);
    expect(searched.orders[0].customerName).toBe('Beta Club');

    const paginated = await listOrders({ limit: 1, offset: 0 });
    expect(paginated.orders).toHaveLength(1);
    expect(paginated.total).toBe(2);
  });

  it('reflects hasActiveToken correctly', async () => {
    const created = await createOrder(minimalInput());
    const withToken = await listOrders();
    expect(withToken.orders[0].hasActiveToken).toBe(true);

    await revokeAccessToken(created.orderId);
    const withoutToken = await listOrders();
    expect(withoutToken.orders[0].hasActiveToken).toBe(false);
  });
});

describe('getOrderAdmin / getOrderById', () => {
  it('returns null for an unknown id', async () => {
    expect(await getOrderAdmin('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await getOrderById('00000000-0000-0000-0000-000000000000')).toBeUndefined();
  });

  it('nests sizing/images/sizeChartLinks ordered by sortOrder', async () => {
    const chart = await seedSizeChart();
    const created = await createOrder(
      minimalInput({
        garments: [
          {
            name: 'Home Jersey',
            sizing: [
              { size: 'L', playerName: 'Z' },
              { size: 'S', playerName: 'A' },
            ],
            mockupStorageKeys: ['b.png', 'a.png'],
            sizeChartIds: [chart.id],
          },
        ],
      }),
    );
    const order = await getOrderAdmin(created.orderId);
    expect(order!.garments[0].sizing.map((s) => s.sortOrder)).toEqual([0, 1]);
    expect(order!.garments[0].images.map((i) => i.sortOrder)).toEqual([0, 1]);
  });

  it('currentAccess is null once the only token is revoked', async () => {
    const created = await createOrder(minimalInput());
    await revokeAccessToken(created.orderId);
    const order = await getOrderAdmin(created.orderId);
    expect(order!.currentAccess).toBeNull();
  });
});

describe('updateOrder', () => {
  it('patches only the provided fields and writes an audit event', async () => {
    const created = await createOrder(minimalInput());
    await updateOrder(created.orderId, { clubName: 'New Club' }, { actorEmail: 'staff@x.com' });

    const order = await getOrderById(created.orderId);
    expect(order!.clubName).toBe('New Club');
    expect(order!.customerName).toBe('Jane Coach'); // untouched

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const updateEvent = events.find((e) => e.eventType === 'order.updated');
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.status).toBe('delivered');
    expect((updateEvent!.payload as { actorEmail: string }).actorEmail).toBe('staff@x.com');
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(
      updateOrder('00000000-0000-0000-0000-000000000000', { clubName: 'X' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('deleteOrder', () => {
  it('deletes a draft order and cascades to garments', async () => {
    const created = await createOrder(minimalInput());
    await deleteOrder(created.orderId);
    expect(await getOrderById(created.orderId)).toBeUndefined();
    const garmentRows = await db
      .select()
      .from(schema.garments)
      .where(eq(schema.garments.orderId, created.orderId));
    expect(garmentRows).toHaveLength(0);
  });

  it('throws ConflictError for a non-draft order', async () => {
    const created = await createOrder(minimalInput());
    await updateOrder(created.orderId, { status: 'sent' });
    await expect(deleteOrder(created.orderId)).rejects.toThrow(ConflictError);
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(deleteOrder('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('garment CRUD', () => {
  it('addGarment auto-increments sortOrder from the current max', async () => {
    const created = await createOrder(minimalInput());
    const second = await addGarment(created.orderId, { name: 'Away Jersey' });
    expect(second.sortOrder).toBe(1);
  });

  it('updateGarment patches fields and throws NotFoundError for unknown id', async () => {
    const created = await createOrder(minimalInput());
    const order = await getOrderAdmin(created.orderId);
    const garmentId = order!.garments[0].id;

    await updateGarment(garmentId, { name: 'Renamed Jersey' });
    const updated = await getOrderAdmin(created.orderId);
    expect(updated!.garments[0].name).toBe('Renamed Jersey');

    await expect(
      updateGarment('00000000-0000-0000-0000-000000000000', { name: 'X' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('deleteGarment cascades to sizing/images/links', async () => {
    const chart = await seedSizeChart();
    const created = await createOrder(
      minimalInput({
        garments: [
          {
            name: 'Home Jersey',
            sizing: [{ size: 'M' }],
            mockupStorageKeys: ['a.png'],
            sizeChartIds: [chart.id],
          },
        ],
      }),
    );
    const order = await getOrderAdmin(created.orderId);
    const garmentId = order!.garments[0].id;

    await deleteGarment(garmentId);

    expect(
      await db.select().from(schema.garmentSizing).where(eq(schema.garmentSizing.garmentId, garmentId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.mockupImages).where(eq(schema.mockupImages.garmentId, garmentId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.garmentSizeChartLinks)
        .where(eq(schema.garmentSizeChartLinks.garmentId, garmentId)),
    ).toHaveLength(0);
  });

  it('deleteGarment throws NotFoundError for unknown id', async () => {
    await expect(deleteGarment('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('upsertSizingRows', () => {
  it('replaces existing rows (delete-then-insert semantics)', async () => {
    const created = await createOrder(
      minimalInput({ garments: [{ name: 'Jersey', sizing: [{ size: 'M' }, { size: 'L' }] }] }),
    );
    const order = await getOrderAdmin(created.orderId);
    const garmentId = order!.garments[0].id;

    await upsertSizingRows(garmentId, [{ size: 'S' }]);

    const rows = await db
      .select()
      .from(schema.garmentSizing)
      .where(eq(schema.garmentSizing.garmentId, garmentId));
    expect(rows).toHaveLength(1);
    expect(rows[0].size).toBe('S');
  });

  it('clears all rows when given an empty array', async () => {
    const created = await createOrder(
      minimalInput({ garments: [{ name: 'Jersey', sizing: [{ size: 'M' }] }] }),
    );
    const order = await getOrderAdmin(created.orderId);
    const garmentId = order!.garments[0].id;

    await upsertSizingRows(garmentId, []);

    const rows = await db
      .select()
      .from(schema.garmentSizing)
      .where(eq(schema.garmentSizing.garmentId, garmentId));
    expect(rows).toHaveLength(0);
  });
});

describe('addMockupImage', () => {
  it('auto-increments sortOrder', async () => {
    const created = await createOrder(
      minimalInput({ garments: [{ name: 'Jersey', mockupStorageKeys: ['a.png'] }] }),
    );
    const order = await getOrderAdmin(created.orderId);
    const garmentId = order!.garments[0].id;

    const image = await addMockupImage(garmentId, { storageKey: 'b.png' });
    expect(image.sortOrder).toBe(1);
  });
});

describe('updateGarmentSizeChartLinks', () => {
  it('bulk-replaces links without violating the unique pair index', async () => {
    const chartA = await seedSizeChart('Chart A');
    const chartB = await seedSizeChart('Chart B');
    const created = await createOrder(
      minimalInput({ garments: [{ name: 'Jersey', sizeChartIds: [chartA.id] }] }),
    );
    const order = await getOrderAdmin(created.orderId);
    const garmentId = order!.garments[0].id;

    await updateGarmentSizeChartLinks(garmentId, [chartB.id]);

    const links = await db
      .select()
      .from(schema.garmentSizeChartLinks)
      .where(eq(schema.garmentSizeChartLinks.garmentId, garmentId));
    expect(links).toHaveLength(1);
    expect(links[0].sizeChartId).toBe(chartB.id);
  });
});

describe('deleteMockupImage', () => {
  it('returns the storageKey and deletes the row', async () => {
    const created = await createOrder(
      minimalInput({ garments: [{ name: 'Jersey', mockupStorageKeys: ['a.png'] }] }),
    );
    const order = await getOrderAdmin(created.orderId);
    const imageId = order!.garments[0].images[0].id;

    const result = await deleteMockupImage(imageId);
    expect(result.storageKey).toBe('a.png');

    const remaining = await db.select().from(schema.mockupImages).where(eq(schema.mockupImages.id, imageId));
    expect(remaining).toHaveLength(0);
  });

  it('throws NotFoundError for unknown id', async () => {
    await expect(deleteMockupImage('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('generateAccessToken / revokeAccessToken', () => {
  it('revokes the prior token, advances draft -> sent, and emits token.generated', async () => {
    const created = await createOrder(minimalInput());
    const before = await db.select().from(schema.orderAccess);
    expect(before).toHaveLength(1);

    const { token } = await generateAccessToken(created.orderId, { actorEmail: 'staff@x.com' });

    const after = await db
      .select()
      .from(schema.orderAccess)
      .where(eq(schema.orderAccess.orderId, created.orderId));
    expect(after).toHaveLength(2);
    expect(after.filter((a) => a.revokedAt === null)).toHaveLength(1);

    const order = await getOrderById(created.orderId);
    expect(order!.status).toBe('sent');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    expect(events.some((e) => e.eventType === 'token.generated')).toBe(true);

    expect(await getOrderByToken(token)).not.toBeNull();
  });

  it('does not re-advance status on subsequent calls (only draft -> sent)', async () => {
    const created = await createOrder(minimalInput());
    await generateAccessToken(created.orderId);
    await updateOrder(created.orderId, { status: 'viewed' });
    await generateAccessToken(created.orderId);

    const order = await getOrderById(created.orderId);
    expect(order!.status).toBe('viewed');
  });

  it('revokeAccessToken sets revokedAt and emits token.revoked', async () => {
    const created = await createOrder(minimalInput());
    await revokeAccessToken(created.orderId, { actorEmail: 'staff@x.com' });

    const access = await db
      .select()
      .from(schema.orderAccess)
      .where(eq(schema.orderAccess.orderId, created.orderId));
    expect(access[0].revokedAt).not.toBeNull();

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    expect(events.some((e) => e.eventType === 'token.revoked')).toBe(true);
  });
});

describe('getOrderByToken', () => {
  it('returns null for an unknown or revoked token', async () => {
    expect(await getOrderByToken('unknown-token')).toBeNull();

    const created = await createOrder(minimalInput());
    const { token } = await generateAccessToken(created.orderId);
    await revokeAccessToken(created.orderId);
    expect(await getOrderByToken(token)).toBeNull();
  });

  it('returns the order for a valid token', async () => {
    const created = await createOrder(minimalInput());
    expect((await getOrderByToken(created.token))!.id).toBe(created.orderId);
  });
});
