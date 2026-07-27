import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/server/purchase-orders/hub-sync', () => ({
  syncOrderProductionStatus: vi.fn(async () => {}),
}));

vi.mock('@/lib/session', () => {
  const store: Record<string, unknown> = {};
  const session = new Proxy(store, {
    get(target, prop) {
      if (prop === 'save') return async () => {};
      if (prop === 'destroy')
        return () => {
          for (const k of Object.keys(target)) delete target[k];
        };
      return target[prop as string];
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return {
    getSession: vi.fn(async () => session),
    requireAdmin: vi.fn(async () => {
      if (!session.userId)
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin')
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { GET as BOARD_GET } from './board/route';
import { POST as MOVE_POST } from './move/route';

const NO_PARAMS = { params: Promise.resolve({} as Record<string, never>) };

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
  session.email = 'sam@x.com';
});

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function clearSession() {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
}

async function seedOrder(status?: 'draft' | 'sent' | 'confirmed' | 'cancelled') {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey' }],
    }),
  );
  if (status) {
    await db
      .update(schema.orders)
      .set({ status })
      .where(eq(schema.orders.id, created.orderId));
  }
  return created.orderId;
}

function boardRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/workflow/board${query}`);
}

function moveRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/workflow/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/admin/workflow/board', () => {
  it('returns the order board with a column per active stage', async () => {
    await seedOrder('confirmed');

    const res = await BOARD_GET(boardRequest(), NO_PARAMS);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.boardKey).toBe('order');
    expect(json.columns.map((c: { slug: string }) => c.slug)).toContain('artwork');
  });

  it('places an unstaged order in its status default column', async () => {
    await seedOrder('confirmed');

    const json = await (await BOARD_GET(boardRequest(), NO_PARAMS)).json();

    const confirmed = json.columns.find((c: { slug: string }) => c.slug === 'confirmed');
    expect(confirmed.cards).toHaveLength(1);
    expect(confirmed.cards[0].stageEnteredAt).toBeNull();
  });

  it('returns the purchase-order board when asked', async () => {
    const json = await (await BOARD_GET(boardRequest('?boardKey=purchase_order'), NO_PARAMS)).json();

    expect(json.boardKey).toBe('purchase_order');
    expect(json.columns).toHaveLength(10);
  });

  it('400s on an unknown board key', async () => {
    const res = await BOARD_GET(boardRequest('?boardKey=nonsense'), NO_PARAMS);
    expect(res.status).toBe(400);
  });

  // Cancelled work would otherwise dominate the board over time.
  it('hides cancelled orders unless asked for', async () => {
    await seedOrder('cancelled');

    const hidden = await (await BOARD_GET(boardRequest(), NO_PARAMS)).json();
    expect(hidden.columns.flatMap((c: { cards: unknown[] }) => c.cards)).toHaveLength(0);

    const shown = await (await BOARD_GET(boardRequest('?includeCancelled=1'), NO_PARAMS)).json();
    expect(shown.columns.flatMap((c: { cards: unknown[] }) => c.cards)).toHaveLength(1);
  });

  it('401s when not signed in', async () => {
    await clearSession();
    const res = await BOARD_GET(boardRequest(), NO_PARAMS);
    expect(res.status).toBe(401);
  });

  // Sales staff must be able to read the board; an admin-only board is useless
  // to the people whose work it shows.
  it('is readable by a non-admin staff user', async () => {
    const res = await BOARD_GET(boardRequest(), NO_PARAMS);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/admin/workflow/move', () => {
  it('moves a card and reports the new stage', async () => {
    const orderId = await seedOrder('confirmed');

    const res = await MOVE_POST(
      moveRequest({ boardKey: 'order', entityId: orderId, toStageSlug: 'artwork' }),
      NO_PARAMS,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.toStageSlug).toBe('artwork');
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(row.workflowStageSlug).toBe('artwork');
  });

  it('is permitted for a non-admin staff user', async () => {
    const orderId = await seedOrder('confirmed');

    const res = await MOVE_POST(
      moveRequest({ boardKey: 'order', entityId: orderId, toStageSlug: 'artwork' }),
      NO_PARAMS,
    );

    expect(res.status).toBe(200);
  });

  it('401s when not signed in', async () => {
    const orderId = await seedOrder('confirmed');
    await clearSession();

    const res = await MOVE_POST(
      moveRequest({ boardKey: 'order', entityId: orderId, toStageSlug: 'artwork' }),
      NO_PARAMS,
    );

    expect(res.status).toBe(401);
  });

  // A 409 carries `details` so the dialog can list what blocked the move.
  it('409s with a reason when the transition is not allowed', async () => {
    const orderId = await seedOrder('confirmed');

    const res = await MOVE_POST(
      moveRequest({ boardKey: 'order', entityId: orderId, toStageSlug: 'draft' }),
      NO_PARAMS,
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/only be cancelled/i);
    expect(json.details).toMatchObject({ from: 'confirmed', to: 'draft' });
  });

  it('409s when staff try to forge a confirmation', async () => {
    const orderId = await seedOrder('sent');

    const res = await MOVE_POST(
      moveRequest({ boardKey: 'order', entityId: orderId, toStageSlug: 'confirmed' }),
      NO_PARAMS,
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/only the customer/i);
  });

  it('404s for an unknown stage', async () => {
    const orderId = await seedOrder('confirmed');

    const res = await MOVE_POST(
      moveRequest({ boardKey: 'order', entityId: orderId, toStageSlug: 'nope' }),
      NO_PARAMS,
    );

    expect(res.status).toBe(404);
  });

  it('404s for an unknown entity', async () => {
    const res = await MOVE_POST(
      moveRequest({
        boardKey: 'order',
        entityId: '00000000-0000-0000-0000-000000000000',
        toStageSlug: 'sent',
      }),
      NO_PARAMS,
    );

    expect(res.status).toBe(404);
  });

  it('400s on a malformed body', async () => {
    const res = await MOVE_POST(
      moveRequest({ boardKey: 'order', entityId: 'not-a-uuid', toStageSlug: 'artwork' }),
      NO_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  // boardKey selects which table is written, so an unchecked value there would
  // be a way to aim a move at the wrong entity type.
  it('400s on an unknown board key', async () => {
    const orderId = await seedOrder('confirmed');

    const res = await MOVE_POST(
      moveRequest({ boardKey: 'orders', entityId: orderId, toStageSlug: 'artwork' }),
      NO_PARAMS,
    );

    expect(res.status).toBe(400);
  });
});
