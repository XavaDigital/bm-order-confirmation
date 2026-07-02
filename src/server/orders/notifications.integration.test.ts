import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

const { sendStaffConfirmationEmail, sendStaffChangeRequestEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendStaffConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendStaffChangeRequestEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/email', () => ({ sendStaffConfirmationEmail, sendStaffChangeRequestEmail, isEmailConfigured }));

vi.mock('@/lib/env', () => ({
  env: {
    APP_BASE_URL: 'http://localhost:3000',
    STAFF_NOTIFICATIONS_CC: undefined as string | undefined,
  },
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { notifyStaffOfChangeRequest, notifyStaffOfConfirmation } from './notifications';

afterEach(async () => {
  await resetTestDb(db);
  sendStaffConfirmationEmail.mockClear();
  sendStaffChangeRequestEmail.mockClear();
  isEmailConfigured.mockReturnValue(true);
  env.STAFF_NOTIFICATIONS_CC = undefined;
});

async function seedStaff(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({ email: 'sales@example.com', passwordHash: 'x', name: 'Sales Rep', ...overrides })
    .returning();
  return staff;
}

async function seedOrder(overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: 'OC-NOTIF1',
      customerName: 'Jane Coach',
      customerEmail: 'jane@example.com',
      ...overrides,
    })
    .returning();
  return order;
}

describe('notifyStaffOfChangeRequest', () => {
  it('does nothing when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const staff = await seedStaff();
    const order = await seedOrder({ createdBy: staff.id });

    await notifyStaffOfChangeRequest(order.id, order.orderNumber, 'please change it');

    expect(sendStaffChangeRequestEmail).not.toHaveBeenCalled();
  });

  it('does nothing when the order has no createdBy', async () => {
    const order = await seedOrder();

    await notifyStaffOfChangeRequest(order.id, order.orderNumber, 'please change it');

    expect(sendStaffChangeRequestEmail).not.toHaveBeenCalled();
  });

  it('emails the order-creating staff member with the customer comment and admin url', async () => {
    const staff = await seedStaff();
    const order = await seedOrder({ createdBy: staff.id });

    await notifyStaffOfChangeRequest(order.id, order.orderNumber, 'please change it');

    expect(sendStaffChangeRequestEmail).toHaveBeenCalledTimes(1);
    expect(sendStaffChangeRequestEmail).toHaveBeenCalledWith({
      to: staff.email,
      toName: staff.name,
      customerName: 'Jane Coach',
      orderNumber: order.orderNumber,
      comment: 'please change it',
      adminOrderUrl: `http://localhost:3000/admin/orders/${order.id}`,
      cc: undefined,
    });
  });

  it('passes STAFF_NOTIFICATIONS_CC through when set', async () => {
    env.STAFF_NOTIFICATIONS_CC = 'team@example.com';
    const staff = await seedStaff();
    const order = await seedOrder({ createdBy: staff.id });

    await notifyStaffOfChangeRequest(order.id, order.orderNumber, 'please change it');

    expect(sendStaffChangeRequestEmail.mock.calls[0][0]).toMatchObject({ cc: 'team@example.com' });
  });
});

describe('notifyStaffOfConfirmation', () => {
  it('does nothing when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const staff = await seedStaff();
    const order = await seedOrder({ createdBy: staff.id });

    await notifyStaffOfConfirmation(order.id, order.orderNumber, new Date());

    expect(sendStaffConfirmationEmail).not.toHaveBeenCalled();
  });

  it('does nothing when the order has no createdBy', async () => {
    const order = await seedOrder();

    await notifyStaffOfConfirmation(order.id, order.orderNumber, new Date());

    expect(sendStaffConfirmationEmail).not.toHaveBeenCalled();
  });

  it('emails the order-creating staff member with the confirmation details', async () => {
    const staff = await seedStaff();
    const order = await seedOrder({ createdBy: staff.id });
    const confirmedAt = new Date('2026-01-15T10:30:00Z');

    await notifyStaffOfConfirmation(order.id, order.orderNumber, confirmedAt);

    expect(sendStaffConfirmationEmail).toHaveBeenCalledWith({
      to: staff.email,
      toName: staff.name,
      customerName: 'Jane Coach',
      orderNumber: order.orderNumber,
      confirmedAt,
      adminOrderUrl: `http://localhost:3000/admin/orders/${order.id}`,
      cc: undefined,
    });
  });
});
