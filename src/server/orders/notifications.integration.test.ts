import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

const { sendStaffConfirmationEmail, sendStaffChangeRequestEmail, sendStaffColorSampleRequestEmail, sendCustomerReceiptEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendStaffConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendStaffChangeRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendStaffColorSampleRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendCustomerReceiptEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/email', () => ({
  sendStaffConfirmationEmail,
  sendStaffChangeRequestEmail,
  sendStaffColorSampleRequestEmail,
  sendCustomerReceiptEmail,
  isEmailConfigured,
}));

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
import {
  notifyStaffOfChangeRequest,
  notifyStaffOfColorSampleRequest,
  notifyStaffOfConfirmation,
  notifyCustomerOfConfirmation,
} from './notifications';

afterEach(async () => {
  await resetTestDb(db);
  sendStaffConfirmationEmail.mockClear();
  sendStaffChangeRequestEmail.mockClear();
  sendStaffColorSampleRequestEmail.mockClear();
  sendCustomerReceiptEmail.mockClear();
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

async function seedConfirmation(orderId: string, snapshot: Record<string, unknown>) {
  const [row] = await db
    .insert(schema.confirmations)
    .values({ orderId, confirmedSnapshot: snapshot })
    .returning();
  return row;
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

describe('notifyStaffOfColorSampleRequest', () => {
  it('does nothing when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const staff = await seedStaff();
    const order = await seedOrder({ createdBy: staff.id });

    await notifyStaffOfColorSampleRequest(order.id, order.orderNumber);

    expect(sendStaffColorSampleRequestEmail).not.toHaveBeenCalled();
  });

  it('does nothing when the order has no createdBy', async () => {
    const order = await seedOrder();

    await notifyStaffOfColorSampleRequest(order.id, order.orderNumber);

    expect(sendStaffColorSampleRequestEmail).not.toHaveBeenCalled();
  });

  it('emails the order-creating staff member with the admin url', async () => {
    const staff = await seedStaff();
    const order = await seedOrder({ createdBy: staff.id });

    await notifyStaffOfColorSampleRequest(order.id, order.orderNumber);

    expect(sendStaffColorSampleRequestEmail).toHaveBeenCalledTimes(1);
    expect(sendStaffColorSampleRequestEmail).toHaveBeenCalledWith({
      to: staff.email,
      toName: staff.name,
      customerName: 'Jane Coach',
      orderNumber: order.orderNumber,
      adminOrderUrl: `http://localhost:3000/admin/orders/${order.id}`,
      cc: undefined,
    });
  });

  it('passes STAFF_NOTIFICATIONS_CC through when set', async () => {
    env.STAFF_NOTIFICATIONS_CC = 'team@example.com';
    const staff = await seedStaff();
    const order = await seedOrder({ createdBy: staff.id });

    await notifyStaffOfColorSampleRequest(order.id, order.orderNumber);

    expect(sendStaffColorSampleRequestEmail.mock.calls[0][0]).toMatchObject({ cc: 'team@example.com' });
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
      colorSampleRequested: false,
      cc: undefined,
    });
  });

  it('passes colorSampleRequested when the order has a colour sample request on record', async () => {
    const staff = await seedStaff();
    const order = await seedOrder({
      createdBy: staff.id,
      colorSampleRequestedAt: new Date('2026-01-15T10:30:00Z'),
    });

    await notifyStaffOfConfirmation(order.id, order.orderNumber, new Date('2026-01-15T10:30:00Z'));

    expect(sendStaffConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ colorSampleRequested: true }),
    );
  });
});

describe('notifyCustomerOfConfirmation', () => {
  it('does nothing when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const order = await seedOrder();

    await notifyCustomerOfConfirmation(order.id, order.orderNumber, new Date());

    expect(sendCustomerReceiptEmail).not.toHaveBeenCalled();
  });

  it('does nothing when the order does not exist', async () => {
    await notifyCustomerOfConfirmation('00000000-0000-0000-0000-000000000000', 'OC-X', new Date());

    expect(sendCustomerReceiptEmail).not.toHaveBeenCalled();
  });

  it('emails the customer directly (no staff lookup) with a quantity summary, order value, and ship date derived from the confirmed snapshot', async () => {
    const order = await seedOrder();
    await seedConfirmation(order.id, {
      garments: [
        { name: 'Home Jersey', sizing: [{ size: 'M' }, { size: 'L' }] },
        { name: 'Away Jersey', sizing: [{ size: 'S' }] },
      ],
      order_value_amount: '1240.00',
      order_value_currency: 'NZD',
      expected_ship_date: '2026-08-01',
    });
    const confirmedAt = new Date('2026-01-15T10:30:00Z');

    await notifyCustomerOfConfirmation(order.id, order.orderNumber, confirmedAt);

    expect(sendCustomerReceiptEmail).toHaveBeenCalledWith({
      to: order.customerEmail,
      toName: order.customerName,
      orderNumber: order.orderNumber,
      confirmedAt,
      garments: [
        { name: 'Home Jersey', quantity: 2 },
        { name: 'Away Jersey', quantity: 1 },
      ],
      orderValueAmount: '1240.00',
      orderValueCurrency: 'NZD',
      expectedShipDate: '2026-08-01',
    });
  });

  it('sends an empty garment list and null order value/ship date when there is no confirmation snapshot yet', async () => {
    const order = await seedOrder();

    await notifyCustomerOfConfirmation(order.id, order.orderNumber, new Date());

    expect(sendCustomerReceiptEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        garments: [],
        orderValueAmount: null,
        orderValueCurrency: null,
        expectedShipDate: null,
      }),
    );
  });
});
