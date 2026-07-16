import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    uploadFile: vi.fn().mockResolvedValue('mock-signature-key'),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from './contract';
import { createOrder, generateAccessToken, revokeAccessToken, updateOrder, setOrderAccessCode } from './service';
import {
  getOrderForCustomer,
  recordOrderViewed,
  requestOrderChanges,
  requestColorSample,
  confirmOrder,
  verifyOrderAccessCode,
  REQUIRED_ACK_KEYS,
  ACK_TEXT_VERSION,
  type AckInput,
} from './customer-service';
import { buildAccessCodeCookie } from '@/lib/access-code';
import { uploadFile } from '@/lib/storage';
import { addRosterMember } from '@/server/roster/service';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(uploadFile).mockClear();
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

function allAcks(): AckInput[] {
  return REQUIRED_ACK_KEYS.map((key) => ({ key, text: `ack for ${key}` }));
}

describe('getOrderForCustomer', () => {
  it('returns null for an unknown token', async () => {
    expect(await getOrderForCustomer('unknown')).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    const created = await createOrder(minimalInput());
    await revokeAccessToken(created.orderId);
    expect(await getOrderForCustomer(created.token)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const created = await createOrder(minimalInput());
    await db
      .update(schema.orderAccess)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orderAccess.orderId, created.orderId));
    expect(await getOrderForCustomer(created.token)).toBeNull();
  });

  it('returns the full nested shape, including resolved size-chart names, for a valid token', async () => {
    const chart = await seedSizeChart('Womens Chart');
    const created = await createOrder(
      minimalInput({
        garments: [{ name: 'Jersey', sizing: [{ size: 'M' }], sizeChartIds: [chart.id] }],
      }),
    );

    const result = await getOrderForCustomer(created.token);
    expect(result).not.toBeNull();
    expect(result!.order.garments[0].sizing).toHaveLength(1);
    expect(result!.order.garments[0].sizeChartLinks[0].sizeChart.name).toBe('Womens Chart');
  });

  it('includes roster progress counts and keeps roster-submitted sizing rows in the read model', async () => {
    const created = await createOrder(
      minimalInput({
        garments: [{ name: 'Jersey' }],
      }),
    );
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const submittedMember = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });
    await addRosterMember(created.orderId, { name: 'Sam', playerNumber: '9' });
    await db
      .update(schema.rosterMembers)
      .set({ submittedAt: new Date() })
      .where(eq(schema.rosterMembers.id, submittedMember.id));
    await db.insert(schema.garmentSizing).values({
      garmentId: order!.garments[0].id,
      rosterMemberId: submittedMember.id,
      size: 'M',
      playerName: 'Alex',
      playerNumber: '7',
      sortOrder: 0,
    });

    const result = await getOrderForCustomer(created.token);

    expect(result).not.toBeNull();
    expect(result!.order.rosterSummary).toEqual({ total: 2, submitted: 1, pending: 1 });
    expect(result!.order.garments[0].sizing[0].rosterMemberId).toBe(submittedMember.id);
  });
});

describe('recordOrderViewed', () => {
  it('transitions sent -> viewed, updates lastViewedAt, and emits order.viewed on first view', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateAccessToken(created.orderId); // draft -> sent, revokes created.token
    const { order, access } = (await getOrderForCustomer(token))!;

    await recordOrderViewed(order.id, access.id, order.status);

    const updated = await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
    expect(updated!.status).toBe('viewed');

    const updatedAccess = await db.query.orderAccess.findFirst({
      where: eq(schema.orderAccess.id, access.id),
    });
    expect(updatedAccess!.lastViewedAt).not.toBeNull();

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, order.id));
    expect(events.filter((e) => e.eventType === 'order.viewed')).toHaveLength(1);
  });

  it('is idempotent on a second view (no duplicate order.viewed event)', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateAccessToken(created.orderId);
    const first = (await getOrderForCustomer(token))!;
    await recordOrderViewed(first.order.id, first.access.id, first.order.status);

    const second = (await getOrderForCustomer(token))!;
    await recordOrderViewed(second.order.id, second.access.id, second.order.status);

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, first.order.id));
    expect(events.filter((e) => e.eventType === 'order.viewed')).toHaveLength(1);
  });
});

describe('per-order access code', () => {
  /** Create an order with a code enabled; return the token, raw code, and a valid cookie. */
  async function seedCodedOrder() {
    const created = await createOrder(minimalInput());
    const { code } = await setOrderAccessCode(created.orderId);
    const access = await db.query.orderAccess.findFirst({
      where: eq(schema.orderAccess.orderId, created.orderId),
    });
    const cookie = buildAccessCodeCookie({ id: access!.id, accessCodeHash: access!.accessCodeHash! });
    return { ...created, code, cookieValue: cookie.value };
  }

  describe('verifyOrderAccessCode', () => {
    it('returns ok for the right code and wrong_code for anything else', async () => {
      const seeded = await seedCodedOrder();

      const good = await verifyOrderAccessCode({ rawToken: seeded.token, code: seeded.code });
      expect(good.status).toBe('ok');

      const bad = await verifyOrderAccessCode({ rawToken: seeded.token, code: '000000' });
      // 1-in-a-million collision guard: only assert when the guess differs from the real code
      if (seeded.code !== '000000') expect(bad.status).toBe('wrong_code');
    });

    it('returns invalid_token for unknown or revoked tokens', async () => {
      expect((await verifyOrderAccessCode({ rawToken: 'bogus', code: '123456' })).status).toBe(
        'invalid_token',
      );

      const seeded = await seedCodedOrder();
      await revokeAccessToken(seeded.orderId);
      expect(
        (await verifyOrderAccessCode({ rawToken: seeded.token, code: seeded.code })).status,
      ).toBe('invalid_token');
    });

    it('returns ok without requiring a code when none is enabled', async () => {
      const created = await createOrder(minimalInput());
      const result = await verifyOrderAccessCode({ rawToken: created.token, code: 'anything' });
      expect(result.status).toBe('ok');
      expect(result.status === 'ok' && result.access.accessCodeHash).toBeNull();
    });
  });

  it('confirmOrder throws code_required without a valid cookie and succeeds with one', async () => {
    const seeded = await seedCodedOrder();

    await expect(
      confirmOrder({ rawToken: seeded.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('code_required');
    await expect(
      confirmOrder({
        rawToken: seeded.token,
        acks: allAcks(),
        signatureType: 'none',
        codeCookie: 'tampered-cookie',
      }),
    ).rejects.toThrow('code_required');

    const result = await confirmOrder({
      rawToken: seeded.token,
      acks: allAcks(),
      signatureType: 'none',
      codeCookie: seeded.cookieValue,
    });
    expect(result.orderNumber).toBe(seeded.orderNumber);
  });

  it('requestOrderChanges throws code_required without a valid cookie and succeeds with one', async () => {
    const seeded = await seedCodedOrder();

    await expect(
      requestOrderChanges({ rawToken: seeded.token, comment: 'change please' }),
    ).rejects.toThrow('code_required');

    const result = await requestOrderChanges({
      rawToken: seeded.token,
      comment: 'change please',
      codeCookie: seeded.cookieValue,
    });
    expect(result.orderId).toBe(seeded.orderId);
  });

  it('orders without a code are unaffected — no cookie needed', async () => {
    const created = await createOrder(minimalInput());
    const result = await requestOrderChanges({ rawToken: created.token, comment: 'no code here' });
    expect(result.orderId).toBe(created.orderId);
  });

  it('requestColorSample throws code_required without a valid cookie and succeeds with one', async () => {
    const seeded = await seedCodedOrder();

    await expect(
      requestColorSample({ rawToken: seeded.token }),
    ).rejects.toThrow('code_required');

    const result = await requestColorSample({
      rawToken: seeded.token,
      codeCookie: seeded.cookieValue,
    });
    expect(result.orderId).toBe(seeded.orderId);
  });
});

describe('requestOrderChanges', () => {
  it('transitions the order to changes_requested and emits an event with the comment', async () => {
    const created = await createOrder(minimalInput());
    const result = await requestOrderChanges({
      rawToken: created.token,
      comment: 'Please fix the sizing',
    });
    expect(result.orderId).toBe(created.orderId);

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.status).toBe('changes_requested');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const event = events.find((e) => e.eventType === 'order.changes_requested');
    expect(event).toBeDefined();
    expect((event!.payload as { comment: string }).comment).toBe('Please fix the sizing');
  });

  it('throws invalid_token for an unknown token', async () => {
    await expect(
      requestOrderChanges({ rawToken: 'bogus', comment: 'x' }),
    ).rejects.toThrow('invalid_token');
  });

  it('throws already_confirmed if the order is already confirmed', async () => {
    const created = await createOrder(minimalInput());
    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
    });
    await expect(
      requestOrderChanges({ rawToken: created.token, comment: 'x' }),
    ).rejects.toThrow('already_confirmed');
  });

  it('never leaves the order on changes_requested when it races a concurrent confirm on the same token', async () => {
    const created = await createOrder(minimalInput());

    const [confirmResult, changesResult] = await Promise.allSettled([
      confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' }),
      requestOrderChanges({ rawToken: created.token, comment: 'racing request' }),
    ]);

    // confirmOrder only ever refuses to run if the order is *already* confirmed,
    // so it must succeed here regardless of which transaction commits first.
    expect(confirmResult.status).toBe('fulfilled');

    // requestOrderChanges either loses the race (already_confirmed) or commits
    // before the confirm and gets overwritten by it — either way the order
    // must never be left stuck on 'changes_requested' with a confirmation row
    // also present, which is the inconsistency finding #7 guards against.
    if (changesResult.status === 'rejected') {
      expect((changesResult.reason as Error).message).toBe('already_confirmed');
    }

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.status).toBe('confirmed');

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows).toHaveLength(1);
  });
});

describe('requestColorSample', () => {
  it('sets colorSampleRequestedAt and emits a single order.color_sample_requested event', async () => {
    const created = await createOrder(minimalInput());
    const result = await requestColorSample({ rawToken: created.token });
    expect(result.orderId).toBe(created.orderId);
    expect(result.alreadyRequested).toBe(false);

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.colorSampleRequestedAt).not.toBeNull();
    // Confirming it does NOT transition order status — orthogonal to the
    // status machine, unlike requestOrderChanges.
    expect(order!.status).not.toBe('changes_requested');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const matching = events.filter((e) => e.eventType === 'order.color_sample_requested');
    expect(matching).toHaveLength(1);
    expect((matching[0].payload as { orderNumber: string }).orderNumber).toBe(created.orderNumber);
  });

  it('is idempotent: a second call does not re-set the timestamp or emit a second event', async () => {
    const created = await createOrder(minimalInput());
    await requestColorSample({ rawToken: created.token });
    const firstOrder = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });

    const second = await requestColorSample({ rawToken: created.token });
    expect(second.alreadyRequested).toBe(true);

    const secondOrder = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(secondOrder!.colorSampleRequestedAt!.getTime()).toBe(firstOrder!.colorSampleRequestedAt!.getTime());

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    expect(events.filter((e) => e.eventType === 'order.color_sample_requested')).toHaveLength(1);
  });

  it('throws invalid_token for an unknown token', async () => {
    await expect(requestColorSample({ rawToken: 'bogus' })).rejects.toThrow('invalid_token');
  });

  it('throws already_confirmed if the order is already confirmed', async () => {
    const created = await createOrder(minimalInput());
    await confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' });
    await expect(requestColorSample({ rawToken: created.token })).rejects.toThrow('already_confirmed');
  });
});

describe('confirmOrder', () => {
  it('full happy path: writes acks, confirmation snapshot, conversion event, domain event, and marks confirmed', async () => {
    const chart = await seedSizeChart('Adult Unisex');
    const created = await createOrder(
      minimalInput({
        orderValue: { amount: 500, currency: 'NZD' },
        garments: [
          {
            name: 'Home Jersey',
            sizing: [{ size: 'M', playerName: 'A. Smith', playerNumber: '7' }],
            sizeChartIds: [chart.id],
          },
        ],
      }),
    );

    const result = await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      concerns: 'None',
      signatureType: 'none',
      ipAddress: '203.0.113.5',
      userAgent: 'vitest',
    });

    expect(result.orderId).toBe(created.orderId);

    const ackRows = await db
      .select()
      .from(schema.acknowledgments)
      .where(eq(schema.acknowledgments.orderId, created.orderId));
    expect(ackRows).toHaveLength(REQUIRED_ACK_KEYS.length);
    expect(ackRows.every((a) => a.accepted && a.ackTextVersion === ACK_TEXT_VERSION)).toBe(true);

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows).toHaveLength(1);
    const snapshot = confirmationRows[0].confirmedSnapshot as {
      garments: { size_chart_names: string[] }[];
    };
    expect(snapshot.garments[0].size_chart_names).toEqual(['Adult Unisex']);

    const conversionRows = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.orderId, created.orderId));
    expect(conversionRows).toHaveLength(1);
    expect(conversionRows[0].status).toBe('pending');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    expect(events.filter((e) => e.eventType === 'order.confirmed')).toHaveLength(1);

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.status).toBe('confirmed');
    expect(order!.confirmedAt).not.toBeNull();

    const access = await db.query.orderAccess.findFirst({
      where: eq(schema.orderAccess.orderId, created.orderId),
    });
    expect(access!.lastViewedAt).not.toBeNull();
  });

  it('confirm snapshot/event reflect a colour sample already requested via requestColorSample beforehand', async () => {
    const created = await createOrder(minimalInput());
    await requestColorSample({ rawToken: created.token });

    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
      ipAddress: '203.0.113.5',
      userAgent: 'vitest',
    });

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    const snapshot = confirmationRows[0].confirmedSnapshot as { color_sample_requested: boolean };
    expect(snapshot.color_sample_requested).toBe(true);

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    // Exactly one — emitted by requestColorSample(), not duplicated at confirm time.
    expect(events.filter((e) => e.eventType === 'order.color_sample_requested')).toHaveLength(1);
    const confirmedEvent = events.find((e) => e.eventType === 'order.confirmed');
    expect((confirmedEvent!.payload as { colorSampleRequested: boolean }).colorSampleRequested).toBe(true);
  });

  it('confirm without a prior colour sample request leaves the snapshot flag false and emits no sample event', async () => {
    const created = await createOrder(minimalInput());

    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
      ipAddress: '203.0.113.5',
      userAgent: 'vitest',
    });

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.colorSampleRequestedAt).toBeNull();

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    const snapshot = confirmationRows[0].confirmedSnapshot as { color_sample_requested: boolean };
    expect(snapshot.color_sample_requested).toBe(false);

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    expect(events.filter((e) => e.eventType === 'order.color_sample_requested')).toHaveLength(0);
  });

  it('includes roster-submitted sizing rows in the immutable confirmation snapshot', async () => {
    const created = await createOrder(
      minimalInput({
        garments: [{ name: 'Home Jersey' }],
      }),
    );
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const rosterMember = await addRosterMember(created.orderId, { name: 'Alex Player', playerNumber: '7' });
    await db
      .update(schema.rosterMembers)
      .set({ submittedAt: new Date() })
      .where(eq(schema.rosterMembers.id, rosterMember.id));
    await db.insert(schema.garmentSizing).values({
      garmentId: order!.garments[0].id,
      rosterMemberId: rosterMember.id,
      size: 'M',
      playerName: 'Alex Player',
      playerNumber: '7',
      notes: null,
      sortOrder: 0,
    });

    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
      ipAddress: '203.0.113.5',
      userAgent: 'vitest',
    });

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    const snapshot = confirmationRows[0].confirmedSnapshot as {
      garments: { sizing: { size: string | null; player_name: string | null; player_number: string | null }[] }[];
    };

    expect(snapshot.garments[0].sizing).toEqual([
      {
        size: 'M',
        player_name: 'Alex Player',
        player_number: '7',
        notes: null,
      },
    ]);
  });

  it('never leaks staff-only internalNotes into the customer-facing confirmation snapshot', async () => {
    const created = await createOrder(minimalInput());
    await updateOrder(created.orderId, { internalNotes: 'Discount approved by manager — do not disclose' });

    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
      ipAddress: '203.0.113.5',
      userAgent: 'vitest',
    });

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    const snapshot = confirmationRows[0].confirmedSnapshot as Record<string, unknown>;

    expect(snapshot.internal_notes).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('Discount approved by manager');
  });

  it('uploads a drawn signature and stores the returned storage key', async () => {
    const created = await createOrder(minimalInput());

    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'drawn',
      signatureBase64: 'data:image/png;base64,aGVsbG8=',
    });

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [key, buffer, mime] = vi.mocked(uploadFile).mock.calls[0];
    expect(buffer.toString()).toBe('hello');
    expect(mime).toBe('image/png');
    expect(key).toMatch(new RegExp(`^signatures/${created.orderId}/.+\\.png$`));

    // confirmOrder stores the pure signatureKey() result, not uploadFile's
    // (discarded) return value.
    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows[0].signatureStorageKey).toBe(key);
  });

  it('rejects when a required ack is missing, writing no rows', async () => {
    const created = await createOrder(minimalInput());
    const incomplete = allAcks().slice(0, 6);

    await expect(
      confirmOrder({ rawToken: created.token, acks: incomplete, signatureType: 'none' }),
    ).rejects.toThrow(/^missing_ack:/);

    const ackRows = await db
      .select()
      .from(schema.acknowledgments)
      .where(eq(schema.acknowledgments.orderId, created.orderId));
    expect(ackRows).toHaveLength(0);
    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows).toHaveLength(0);
  });

  it('rejects a second confirm attempt on an already-confirmed order', async () => {
    const created = await createOrder(minimalInput());
    await confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' });

    await expect(
      confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('already_confirmed');

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows).toHaveLength(1);
  });

  it('only lets one of two concurrent confirm attempts succeed, writing a single confirmation row', async () => {
    const created = await createOrder(minimalInput());

    const results = await Promise.allSettled([
      confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' }),
      confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe('already_confirmed');

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows).toHaveLength(1);

    const conversionRows = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.orderId, created.orderId));
    expect(conversionRows).toHaveLength(1);
  });

  it('rejects unknown, revoked, and expired tokens', async () => {
    await expect(
      confirmOrder({ rawToken: 'bogus', acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('invalid_token');

    const revoked = await createOrder(minimalInput());
    await revokeAccessToken(revoked.orderId);
    await expect(
      confirmOrder({ rawToken: revoked.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('invalid_token');

    const expired = await createOrder(minimalInput());
    await db
      .update(schema.orderAccess)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orderAccess.orderId, expired.orderId));
    await expect(
      confirmOrder({ rawToken: expired.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('invalid_token');
  });

  it('updates orders.shippingAddress only when shippingMode is customer_entered', async () => {
    const customerEntered = await createOrder(
      minimalInput({ shipping: { mode: 'customer_entered' } }),
    );
    await confirmOrder({
      rawToken: customerEntered.token,
      acks: allAcks(),
      signatureType: 'none',
      shippingAddress: { line1: '1 Beast St' },
    });
    const order1 = await db.query.orders.findFirst({
      where: eq(schema.orders.id, customerEntered.orderId),
    });
    expect(order1!.shippingAddress).toEqual({ line1: '1 Beast St' });

    const prefilled = await createOrder(minimalInput({ shipping: { mode: 'prefilled' } }));
    await confirmOrder({
      rawToken: prefilled.token,
      acks: allAcks(),
      signatureType: 'none',
      shippingAddress: { line1: 'should be ignored' },
    });
    const order2 = await db.query.orders.findFirst({
      where: eq(schema.orders.id, prefilled.orderId),
    });
    expect(order2!.shippingAddress).toBeNull();
  });

  it('rolls back the whole transaction if an insert fails mid-way (atomicity)', async () => {
    const created = await createOrder(minimalInput());
    // Pre-insert a confirmations row directly (bypassing confirmOrder) without
    // flipping order status, so confirmOrder's own insert of `confirmations`
    // (which has a unique orderId constraint) fails mid-transaction.
    await db.insert(schema.confirmations).values({
      orderId: created.orderId,
      confirmedSnapshot: { pre: 'existing' },
    });

    await expect(
      confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow();

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.status).not.toBe('confirmed');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    expect(events.filter((e) => e.eventType === 'order.confirmed')).toHaveLength(0);

    const ackRows = await db
      .select()
      .from(schema.acknowledgments)
      .where(eq(schema.acknowledgments.orderId, created.orderId));
    expect(ackRows).toHaveLength(0);
  });
});
