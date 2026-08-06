import { randomUUID } from 'node:crypto';
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
import { createOrder, updateOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createPurchaseOrder, updatePurchaseOrderStatus } from '@/server/purchase-orders/service';
import { processOutbox } from '@/server/events/processor';
import {
  cancelStatusReminder,
  createStatusReminder,
  fireDueStatusReminders,
  listStatusReminders,
} from './status-reminders';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedStaff(email: string, overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ email, name: email.split('@')[0], passwordHash: 'x', role: 'sales', ...overrides })
    .returning();
  return row;
}

async function seedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey', sizing: [{ size: 'M', playerName: 'Alice' }] }],
    }),
  );
  return created.orderId;
}

async function seedPo(orderId: string) {
  const supplier = await db
    .insert(schema.suppliers)
    .values({ name: 'Vast Apparel', supplierCode: 'VA' })
    .returning();
  const garments = await db.query.garments.findMany({ where: eq(schema.garments.orderId, orderId) });
  const po = await createPurchaseOrder({
    orderId,
    supplierId: supplier[0].id,
    garmentIds: garments.map((g) => g.id),
  });
  return po;
}

describe('createStatusReminder / listStatusReminders', () => {
  it('creates a pending reminder and audits it', async () => {
    const staff = await seedStaff('sam@example.com');
    const orderId = await seedOrder();

    const created = await createStatusReminder(
      'order',
      orderId,
      'confirmed',
      'Send customer a test print for approval',
      staff.id,
    );

    expect(created.resolvedAt).toBeNull();
    expect(created.firedAt).toBeNull();

    const listed = await listStatusReminders('order', orderId);
    expect(listed).toHaveLength(1);
    expect(listed[0].note).toBe('Send customer a test print for approval');

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'workflow.status_reminder_created'),
      ),
    });
    expect(audits).toHaveLength(1);
  });
});

describe('fireDueStatusReminders — purchase orders (via updatePurchaseOrderStatus)', () => {
  it('fires when the PO reaches the trigger status, notifying the creator', async () => {
    const staff = await seedStaff('sam@example.com');
    const orderId = await seedOrder();
    const po = await seedPo(orderId);
    await createStatusReminder(
      'purchase_order',
      po.id,
      'test_print',
      'Send customer a test print for approval',
      staff.id,
    );

    await updatePurchaseOrderStatus(po.id, 'test_print');

    const [reminder] = await listStatusReminders('purchase_order', po.id);
    expect(reminder.resolvedAt).not.toBeNull();
    expect(reminder.firedAt).not.toBeNull();

    const events = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'workflow.status_reminder_due'),
      ),
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      entityType: 'purchase_order',
      entityId: po.id,
      triggerStatus: 'test_print',
      note: 'Send customer a test print for approval',
      staffUserId: staff.id,
    });

    await processOutbox();
    const items = await db.select().from(schema.inboxItems);
    expect(items).toHaveLength(1);
    expect(items[0].staffUserId).toBe(staff.id);
    expect(items[0].title).toBe('Reminder: Send customer a test print for approval');
  });

  it('does not fire on a different status', async () => {
    const staff = await seedStaff('sam@example.com');
    const orderId = await seedOrder();
    const po = await seedPo(orderId);
    await createStatusReminder('purchase_order', po.id, 'in_production', 'chase the factory', staff.id);

    await updatePurchaseOrderStatus(po.id, 'test_print');

    const [reminder] = await listStatusReminders('purchase_order', po.id);
    expect(reminder.resolvedAt).toBeNull();

    const events = await db.query.domainEvents.findMany({
      where: eq(schema.domainEvents.eventType, 'workflow.status_reminder_due'),
    });
    expect(events).toHaveLength(0);
  });

  it('is safe to evaluate twice — fires exactly once', async () => {
    const staff = await seedStaff('sam@example.com');
    const orderId = randomUUID();
    const entityId = randomUUID();
    await createStatusReminder('order', entityId, 'confirmed', 'chase the factory', staff.id);

    await db.transaction((tx) => fireDueStatusReminders(tx, 'order', entityId, 'confirmed', orderId));
    await db.transaction((tx) => fireDueStatusReminders(tx, 'order', entityId, 'confirmed', orderId));

    const events = await db.query.domainEvents.findMany({
      where: eq(schema.domainEvents.eventType, 'workflow.status_reminder_due'),
    });
    expect(events).toHaveLength(1);
  });
});

describe('fireDueStatusReminders — orders (via updateOrder admin PATCH)', () => {
  it('fires when an admin PATCH moves the order to the trigger status', async () => {
    const staff = await seedStaff('sam@example.com');
    const orderId = await seedOrder();
    await createStatusReminder('order', orderId, 'sent', 'kick off artwork', staff.id);

    await updateOrder(orderId, { status: 'sent' });

    const [reminder] = await listStatusReminders('order', orderId);
    expect(reminder.resolvedAt).not.toBeNull();

    await processOutbox();
    const items = await db
      .select()
      .from(schema.inboxItems)
      .where(eq(schema.inboxItems.eventKey, 'workflow.status_reminder'));
    expect(items).toHaveLength(1);
    expect(items[0].body).toBe('Reached status "sent".');
  });
});

describe('cancelStatusReminder', () => {
  it('lets the creator cancel their own pending reminder', async () => {
    const staff = await seedStaff('sam@example.com');
    const orderId = await seedOrder();
    const created = await createStatusReminder('order', orderId, 'confirmed', 'note', staff.id);

    await cancelStatusReminder(created.id, { staffUserId: staff.id, isAdmin: false });

    const [reminder] = await listStatusReminders('order', orderId);
    expect(reminder.resolvedAt).not.toBeNull();
    expect(reminder.firedAt).toBeNull();
  });

  it('lets an admin cancel someone else\'s reminder', async () => {
    const staff = await seedStaff('sam@example.com');
    const admin = await seedStaff('avery@example.com', { role: 'admin' });
    const orderId = await seedOrder();
    const created = await createStatusReminder('order', orderId, 'confirmed', 'note', staff.id);

    await cancelStatusReminder(created.id, { staffUserId: admin.id, isAdmin: true });

    const [reminder] = await listStatusReminders('order', orderId);
    expect(reminder.resolvedAt).not.toBeNull();
  });

  it('refuses a non-creator, non-admin', async () => {
    const staff = await seedStaff('sam@example.com');
    const other = await seedStaff('other@example.com');
    const orderId = await seedOrder();
    const created = await createStatusReminder('order', orderId, 'confirmed', 'note', staff.id);

    await expect(
      cancelStatusReminder(created.id, { staffUserId: other.id, isAdmin: false }),
    ).rejects.toThrow(/only the person who set this reminder/i);
  });

  it('a cancelled reminder never fires', async () => {
    const staff = await seedStaff('sam@example.com');
    const orderId = await seedOrder();
    const created = await createStatusReminder('order', orderId, 'sent', 'note', staff.id);
    await cancelStatusReminder(created.id, { staffUserId: staff.id, isAdmin: false });

    await updateOrder(orderId, { status: 'sent' });

    const events = await db.query.domainEvents.findMany({
      where: eq(schema.domainEvents.eventType, 'workflow.status_reminder_due'),
    });
    expect(events).toHaveLength(0);
  });
});
