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
import * as schema from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, setRosterPage } from '@/server/orders/service';
import { ROSTER_SESSION_COOKIE } from '@/lib/roster-session';
import { POST as ENTER } from './enter/route';
import { GET as STATE } from './state/route';
import { POST as ADD_MEMBER } from './members/route';
import { PATCH as UPDATE_MEMBER, DELETE as DELETE_MEMBER } from './members/[memberId]/route';

afterEach(async () => {
  await resetTestDb(db);
});

let ipCounter = 0;
function uniqueIp() {
  ipCounter++;
  return `10.1.0.${ipCounter}`;
}

async function seedRosterOrder(opts: { password?: string | null } = {}) {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [
        {
          name: 'Home Jersey',
          sizingColumns: [{ label: 'Colour', type: 'select', options: ['Red', 'Blue'] }],
        },
        { name: 'Shorts' },
      ],
    }),
  );
  await setRosterPage(created.orderId, {
    enabled: true,
    password: opts.password === undefined ? 'seahawks' : opts.password,
  });
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, created.orderId),
  });
  const garments = await db.query.garments.findMany({
    where: eq(schema.garments.orderId, created.orderId),
  });
  return { orderId: created.orderId, orderNumber: order!.orderNumber, garments };
}

function jsonRequest(url: string, body: unknown, opts: { cookie?: string; method?: string } = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: opts.method ?? 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': uniqueIp(),
      ...(opts.cookie ? { cookie: `${ROSTER_SESSION_COOKIE}=${opts.cookie}` } : {}),
    },
  });
}

function params(orderNumber: string, memberId?: string) {
  return {
    params: Promise.resolve(memberId ? { orderNumber, memberId } : { orderNumber }),
  } as never;
}

/** Enter and hand back the session cookie value. */
async function enterAs(orderNumber: string, email: string, password = 'seahawks') {
  const res = await ENTER(
    jsonRequest(`/api/roster/${orderNumber}/enter`, { email, password }),
    params(orderNumber),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('set-cookie')!;
  return decodeURIComponent(setCookie.split(`${ROSTER_SESSION_COOKIE}=`)[1].split(';')[0]);
}

function memberBody(garments: { id: string }[], name: string) {
  return {
    name,
    sizes: garments.map((g, i) => ({
      garmentId: g.id,
      size: i === 0 ? 'L' : 'M',
      customValues: i === 0 ? { Colour: 'Red', Hacked: 'nope' } : {},
    })),
  };
}

describe('the short-URL roster page', () => {
  it('404s for an order without the page enabled', async () => {
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'X', email: 'x@example.com' },
        garments: [{ name: 'Jersey' }],
      }),
    );
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });

    const res = await ENTER(
      jsonRequest(`/x`, { email: 'a@b.nz', password: 'whatever' }),
      params(order!.orderNumber),
    );
    expect(res.status).toBe(404);
  });

  it('refuses a wrong password and accepts the right one', async () => {
    const { orderNumber } = await seedRosterOrder();

    const wrong = await ENTER(
      jsonRequest(`/x`, { email: 'a@b.nz', password: 'nope' }),
      params(orderNumber),
    );
    expect(wrong.status).toBe(403);

    const cookie = await enterAs(orderNumber, 'a@b.nz');
    expect(cookie.length).toBeGreaterThan(10);
  });

  it('a guest adds a player with sizes + allowed custom values; foreign keys are dropped', async () => {
    const { orderNumber, garments } = await seedRosterOrder();
    const cookie = await enterAs(orderNumber, 'parent@example.com');

    const res = await ADD_MEMBER(
      jsonRequest(`/x`, memberBody(garments, 'Sam Player'), { cookie }),
      params(orderNumber),
    );
    expect(res.status).toBe(201);

    const state = await STATE(
      jsonRequest(`/x`, undefined, { cookie, method: 'GET' }),
      params(orderNumber),
    );
    const body = await state.json();
    expect(state.status).toBe(200);
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({ name: 'Sam Player', mine: true });
    const jersey = garments.find((g) => g.name === 'Home Jersey')!;
    expect(body.members[0].sizes[jersey.id]).toEqual({
      size: 'L',
      // 'Hacked' is not a defined column — the allowlist drops it.
      customValues: { Colour: 'Red' },
    });
  });

  it("another guest can see but not edit or remove someone else's player", async () => {
    const { orderNumber, garments } = await seedRosterOrder();
    const ownerCookie = await enterAs(orderNumber, 'owner@example.com');
    const added = await ADD_MEMBER(
      jsonRequest(`/x`, memberBody(garments, 'Kai Player'), { cookie: ownerCookie }),
      params(orderNumber),
    );
    const { memberId } = await added.json();

    const otherCookie = await enterAs(orderNumber, 'other@example.com');

    const state = await STATE(
      jsonRequest(`/x`, undefined, { cookie: otherCookie, method: 'GET' }),
      params(orderNumber),
    );
    const body = await state.json();
    expect(body.members[0]).toMatchObject({ name: 'Kai Player', mine: false });

    const patch = await UPDATE_MEMBER(
      jsonRequest(`/x`, memberBody(garments, 'Hijacked'), { cookie: otherCookie, method: 'PATCH' }),
      params(orderNumber, memberId),
    );
    expect(patch.status).toBe(403);

    const del = await DELETE_MEMBER(
      jsonRequest(`/x`, undefined, { cookie: otherCookie, method: 'DELETE' }),
      params(orderNumber, memberId),
    );
    expect(del.status).toBe(403);
  });

  it('the owner can update their player, and a locked roster refuses writes', async () => {
    const { orderId, orderNumber, garments } = await seedRosterOrder();
    const cookie = await enterAs(orderNumber, 'owner@example.com');
    const added = await ADD_MEMBER(
      jsonRequest(`/x`, memberBody(garments, 'Riley Player'), { cookie }),
      params(orderNumber),
    );
    const { memberId } = await added.json();

    const ok = await UPDATE_MEMBER(
      jsonRequest(
        `/x`,
        { ...memberBody(garments, 'Riley Player'), playerNumber: '9' },
        { cookie, method: 'PATCH' },
      ),
      params(orderNumber, memberId),
    );
    expect(ok.status).toBe(200);

    await db
      .update(schema.orders)
      .set({ rosterLockedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    const locked = await UPDATE_MEMBER(
      jsonRequest(`/x`, memberBody(garments, 'Riley Player'), { cookie, method: 'PATCH' }),
      params(orderNumber, memberId),
    );
    expect(locked.status).toBe(409);
  });

  it('rotating the page password invalidates outstanding sessions', async () => {
    const { orderId, orderNumber } = await seedRosterOrder();
    const cookie = await enterAs(orderNumber, 'a@b.nz');

    await setRosterPage(orderId, { password: 'newword' });

    const res = await STATE(
      jsonRequest(`/x`, undefined, { cookie, method: 'GET' }),
      params(orderNumber),
    );
    expect(res.status).toBe(401);
  });

  it('a valid roster token skips the password', async () => {
    const { orderId, orderNumber } = await seedRosterOrder();
    const { generateRosterToken } = await import('@/server/roster/service');
    const { url } = await generateRosterToken(orderId);
    const token = url.split('/').pop()!;

    const res = await ENTER(
      jsonRequest(`/x`, { email: 'via-token@example.com', token }),
      params(orderNumber),
    );
    expect(res.status).toBe(200);

    // Sanity: the token really was required — no password, no token → 403.
    const bare = await ENTER(
      jsonRequest(`/x`, { email: 'nope@example.com' }),
      params(orderNumber),
    );
    expect(bare.status).toBe(403);

    // The tokened guest exists like any other.
    const guest = await db.query.rosterGuests.findFirst({
      where: and(
        eq(schema.rosterGuests.orderId, orderId),
        eq(schema.rosterGuests.email, 'via-token@example.com'),
      ),
    });
    expect(guest).toBeDefined();
  });
});
