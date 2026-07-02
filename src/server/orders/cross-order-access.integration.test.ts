/**
 * Explicit negative test (CLAUDE.md: "The customer surface must never expose
 * other orders"): proves that a customer's magic-link token can only ever
 * resolve to that customer's own order, never another order, whether guessed,
 * reused after revocation, or presented against the wrong order's routes.
 */
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
import { createOrder, revokeAccessToken, generateAccessToken } from '@/server/orders/service';
import { getOrderForCustomer, requestOrderChanges } from '@/server/orders/customer-service';
import { POST as requestChangesPOST } from '@/app/api/o/request-changes/route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

let ipCounter = 0;
function uniqueIp() {
  ipCounter++;
  return `10.2.0.${ipCounter}`;
}

describe('cross-order token isolation', () => {
  it('getOrderForCustomer never returns order B when a similarly-shaped but unknown token is guessed', async () => {
    await createOrder(minimalOrderInput({ customer: { name: 'Bob', email: 'bob@example.com' } }));

    // A guessed token of the right shape/length that was never issued.
    const guessed = 'a'.repeat(43);
    expect(await getOrderForCustomer(guessed)).toBeNull();
  });

  it("order A's token only ever resolves order A's data, never order B's", async () => {
    const orderA = await createOrder(minimalOrderInput({ customer: { name: 'Jane', email: 'jane@example.com' } }));
    const orderB = await createOrder(minimalOrderInput({ customer: { name: 'Bob', email: 'bob@example.com' } }));

    const result = await getOrderForCustomer(orderA.token);

    expect(result).not.toBeNull();
    expect(result!.order.id).toBe(orderA.orderId);
    expect(result!.order.id).not.toBe(orderB.orderId);
    expect(result!.order.customerEmail).toBe('jane@example.com');
  });

  it("order B's token cannot be used to request changes on order A", async () => {
    const orderA = await createOrder(minimalOrderInput({ customer: { name: 'Jane', email: 'jane@example.com' } }));
    const orderB = await createOrder(minimalOrderInput({ customer: { name: 'Bob', email: 'bob@example.com' } }));

    const result = await requestOrderChanges({ rawToken: orderB.token, comment: 'change please' });

    expect(result.orderId).toBe(orderB.orderId);
    expect(result.orderId).not.toBe(orderA.orderId);
  });

  it('a revoked token can no longer resolve the order it used to grant access to', async () => {
    const created = await createOrder(minimalOrderInput());
    expect(await getOrderForCustomer(created.token)).not.toBeNull();

    await revokeAccessToken(created.orderId);

    expect(await getOrderForCustomer(created.token)).toBeNull();
  });

  it('a regenerated token invalidates the previously issued one, preventing stale-link access', async () => {
    const created = await createOrder(minimalOrderInput());
    const regenerated = await generateAccessToken(created.orderId);

    expect(await getOrderForCustomer(created.token)).toBeNull();
    expect((await getOrderForCustomer(regenerated.token))!.order.id).toBe(created.orderId);
  });

  it('POST /api/o/request-changes with a guessed/unknown token returns 404, not another order', async () => {
    await createOrder(minimalOrderInput({ customer: { name: 'Bob', email: 'bob@example.com' } }));

    const req = new NextRequest('http://localhost/api/o/request-changes', {
      method: 'POST',
      body: JSON.stringify({ token: 'x'.repeat(43), comment: 'change please' }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
    });
    const res = await requestChangesPOST(req);

    expect(res.status).toBe(404);
  });
});
