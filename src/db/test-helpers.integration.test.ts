import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, resetTestDb } from './test-helpers';
import * as schema from './schema';

describe('createTestDb (PGlite migration replay spike)', () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  it('replays all migrations and creates the confirmation schema', async () => {
    ctx = await createTestDb();
    const result = await ctx.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'confirmation' order by table_name`,
    );
    const tableNames = result.rows.map((r) => (r as { table_name: string }).table_name);
    expect(tableNames).toContain('orders');
    expect(tableNames).toContain('garments');
    expect(tableNames).toContain('confirmations');
    expect(tableNames).toContain('domain_events');
  });

  it('supports the partial unique index on orders.external_ref', async () => {
    const [staff] = await ctx.db
      .insert(schema.staffUsers)
      .values({ email: 'spike@example.com', passwordHash: 'x', name: 'Spike' })
      .returning();

    await ctx.db.insert(schema.orders).values({
      orderNumber: 'OC-SPIKE001',
      customerName: 'A',
      customerEmail: 'a@example.com',
      externalRef: null,
      createdBy: staff.id,
    });
    // second row with externalRef: null must NOT collide (partial unique index)
    await ctx.db.insert(schema.orders).values({
      orderNumber: 'OC-SPIKE002',
      customerName: 'B',
      customerEmail: 'b@example.com',
      externalRef: null,
      createdBy: staff.id,
    });

    await expect(
      ctx.db.insert(schema.orders).values({
        orderNumber: 'OC-SPIKE003',
        customerName: 'C',
        customerEmail: 'c@example.com',
        externalRef: 'dup-ref',
        createdBy: staff.id,
      }),
    ).resolves.toBeDefined();

    await expect(
      ctx.db.insert(schema.orders).values({
        orderNumber: 'OC-SPIKE004',
        customerName: 'D',
        customerEmail: 'd@example.com',
        externalRef: 'dup-ref',
        createdBy: staff.id,
      }),
    ).rejects.toThrow();
  });

  it('supports the inet column on confirmations.ip_address', async () => {
    const [staff] = await ctx.db
      .insert(schema.staffUsers)
      .values({ email: 'spike2@example.com', passwordHash: 'x', name: 'Spike2' })
      .returning();
    const [order] = await ctx.db
      .insert(schema.orders)
      .values({
        orderNumber: 'OC-SPIKE-INET',
        customerName: 'E',
        customerEmail: 'e@example.com',
        createdBy: staff.id,
      })
      .returning();

    await expect(
      ctx.db.insert(schema.confirmations).values({
        orderId: order.id,
        confirmedSnapshot: { foo: 'bar' },
        ipAddress: '203.0.113.5',
      }),
    ).resolves.toBeDefined();
  });

  it('supports the relational query API (db.query.*)', async () => {
    const order = await ctx.db.query.orders.findFirst({
      with: { garments: true },
    });
    expect(order).toBeDefined();
  });

  it('resetTestDb truncates all tables', async () => {
    await resetTestDb(ctx.db);
    const remaining = await ctx.db.select().from(schema.orders);
    expect(remaining).toHaveLength(0);
  });

  afterAll(async () => {
    await ctx.teardown();
  });
});
