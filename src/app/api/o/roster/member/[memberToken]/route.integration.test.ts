import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { addRosterMember, generateMemberToken } from '@/server/roster/service';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com', clubName: 'Wildcats' },
    garments: [{ name: 'Home Jersey' }],
    orderValue: { amount: 999, currency: 'NZD' },
    invoiceUrl: 'https://example.com/invoice',
    shipping: { mode: 'prefilled', address: { line1: '123 Test St' } },
    generalNotes: 'internal',
    ...overrides,
  });
}

function getRequest(token: string) {
  return new NextRequest(`http://localhost/api/o/roster/member/${token}`);
}

describe('GET /api/o/roster/member/[memberToken]', () => {
  it('returns 404 for an invalid token', async () => {
    const res = await GET(getRequest('bogus'), { params: Promise.resolve({ memberToken: 'bogus' }) });
    expect(res.status).toBe(404);
  });

  it('returns this member\'s scoped data without leaking manager-only fields or other members', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    await addRosterMember(created.orderId, { name: 'Sam' });
    const { token } = await generateMemberToken(member.id);

    const res = await GET(getRequest(token), { params: Promise.resolve({ memberToken: token }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.order.orderNumber).toBe(created.orderNumber);
    expect(json.member.name).toBe('Alex');
    expect(json.members).toBeUndefined();
    expect(json.order.orderValueAmount).toBeUndefined();
    expect(json.order.invoiceUrl).toBeUndefined();
    expect(json.order.shippingAddress).toBeUndefined();
    expect(json.order.generalNotes).toBeUndefined();
    expect(json.order.internalNotes).toBeUndefined();
  });
});
