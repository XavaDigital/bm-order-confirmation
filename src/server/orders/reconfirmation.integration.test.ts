/**
 * Re-confirmation end to end (David, 2026-08-07).
 *
 * The feature exists because a confirmation is evidence of what someone agreed
 * to, and editing the order afterwards quietly makes that evidence false. So
 * the hardest-pinned facts here are the ones that protect the evidence: the
 * original snapshot survives a second agreement, the sale is not counted twice,
 * and a confirmed order stays closed to its own link unless staff opened it.
 */
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
  return { ...actual, uploadFile: vi.fn().mockResolvedValue('mock-signature-key') };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from './contract';
import { createOrder, updateOrder, upsertSizingRows } from './service';
import { createPurchaseOrder } from '@/server/purchase-orders/service';
import { getPoChecklist, setChecklistItem } from '@/server/purchase-orders/checklist-service';
import { confirmOrder, REQUIRED_ACK_KEYS, type AckInput } from './customer-service';
import {
  cancelReconfirmationRequest,
  getReconfirmationState,
  latestConfirmation,
  requestReconfirmation,
} from './reconfirmation-service';

afterEach(async () => {
  await resetTestDb(db);
});

function allAcks(): AckInput[] {
  return REQUIRED_ACK_KEYS.map((key) => ({ key, text: `ack for ${key}` }));
}

async function seedConfirmedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      orderValue: { amount: 1200, currency: 'NZD' },
      garments: [
        {
          name: 'Home Jersey',
          sizing: [
            { size: 'M', quantity: 10 },
            { size: 'L', quantity: 10 },
          ],
        },
      ],
    }),
  );
  await confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' });
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  }))!;
  return { ...created, garmentId: garment.id };
}

/** The change staff actually make: more of one size than was agreed. */
async function bumpQuantity(garmentId: string) {
  await upsertSizingRows(garmentId, [
    { size: 'M', quantity: 10 },
    { size: 'L', quantity: 14 },
  ]);
}

describe('getReconfirmationState', () => {
  it('says an untouched confirmed order is in sync', async () => {
    const { orderId } = await seedConfirmedOrder();

    const state = await getReconfirmationState(orderId);

    expect(state.status).toBe('in_sync');
    expect(state.changes).toEqual([]);
    expect(state.confirmedRevision).toBe(1);
  });

  it('has nothing to say about an order that was never confirmed', async () => {
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane Coach', email: 'jane@example.com' },
        garments: [{ name: 'Home Jersey' }],
      }),
    );

    const state = await getReconfirmationState(created.orderId);

    expect(state.status).toBe('not_confirmed');
    expect(state.confirmedRevision).toBeNull();
  });

  it('reports a changed quantity as drifted, naming the garment', async () => {
    const { orderId, garmentId } = await seedConfirmedOrder();

    await bumpQuantity(garmentId);

    const state = await getReconfirmationState(orderId);
    expect(state.status).toBe('drifted');
    expect(state.hasMaterialChanges).toBe(true);
    expect(state.changes.map((c) => c.label)).toContain('Home Jersey: quantity 20 → 24');
  });

  // Staff move a ship date routinely; that must not read the same as changing
  // what is being made.
  it('reports a moved ship date as a minor change, not drift', async () => {
    const { orderId } = await seedConfirmedOrder();

    await updateOrder(orderId, { expectedShipDate: '2026-10-01' });

    const state = await getReconfirmationState(orderId);
    expect(state.status).toBe('minor_changes');
    expect(state.hasMaterialChanges).toBe(false);
  });
});

describe('requestReconfirmation', () => {
  it('raises the flag with who asked and their note, and records both sinks', async () => {
    const { orderId, garmentId } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);

    const state = await requestReconfirmation(orderId, {
      note: 'We added four larges as you asked on the phone.',
      actorEmail: 'sam@example.com',
    });

    expect(state.status).toBe('awaiting_customer');
    expect(state.requestedBy).toBe('sam@example.com');
    expect(state.requestedNote).toContain('four larges');

    const outbox = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.eventType, 'order.reconfirm_requested'));
    expect(outbox).toHaveLength(1);
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'order.reconfirm_requested'));
    expect(audit).toHaveLength(1);
  });

  it('refuses on an order the customer never confirmed', async () => {
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane Coach', email: 'jane@example.com' },
        garments: [{ name: 'Home Jersey' }],
      }),
    );

    await expect(requestReconfirmation(created.orderId, {})).rejects.toThrow(/not been confirmed/i);
  });

  // Staff chase. Asking twice is not an error.
  it('re-asking refreshes the note rather than failing', async () => {
    const { orderId, garmentId } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, { note: 'first ask' });

    const state = await requestReconfirmation(orderId, { note: 'second ask' });

    expect(state.status).toBe('awaiting_customer');
    expect(state.requestedNote).toBe('second ask');
  });

  it('withdrawing the request puts the order back to drifted', async () => {
    const { orderId, garmentId } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});

    const state = await cancelReconfirmationRequest(orderId, { actorEmail: 'sam@example.com' });

    expect(state.status).toBe('drifted');
    expect(state.requestedAt).toBeNull();
  });
});

/**
 * David chose to BLOCK sending rather than only warn, through the existing
 * pre-send checklist so it sits beside the other checks and can be sidestepped
 * with a reason — a customer who goes quiet on holiday must not be able to
 * stall a job with no way forward.
 */
describe('the hold on sending a purchase order', () => {
  async function poFor(orderId: string) {
    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: 'Dynasty', supplierCode: 'DY', email: 'dy@example.com' })
      .returning();
    const garment = (await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, orderId),
    }))!;
    return createPurchaseOrder({ orderId, supplierId: supplier.id, garmentIds: [garment.id] });
  }

  async function confirmationCheck(poId: string) {
    const entries = await getPoChecklist(poId);
    return entries.find((e) => e.autoRule === 'customer_confirmed_current_version')!;
  }

  it('is satisfied while the order matches what the customer agreed to', async () => {
    const { orderId } = await seedConfirmedOrder();
    const po = await poFor(orderId);

    expect((await confirmationCheck(po.id)).satisfied).toBe(true);
  });

  it('is NOT satisfied once the order has drifted', async () => {
    const { orderId, garmentId } = await seedConfirmedOrder();
    const po = await poFor(orderId);

    await bumpQuantity(garmentId);

    expect((await confirmationCheck(po.id)).satisfied).toBe(false);
  });

  it('stays unsatisfied while we are waiting on the customer', async () => {
    const { orderId, garmentId } = await seedConfirmedOrder();
    const po = await poFor(orderId);
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});

    expect((await confirmationCheck(po.id)).satisfied).toBe(false);
  });

  it('clears once the customer has agreed again', async () => {
    const { orderId, garmentId, token } = await seedConfirmedOrder();
    const po = await poFor(orderId);
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});

    await confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' });

    expect((await confirmationCheck(po.id)).satisfied).toBe(true);
  });

  // A purchase order raised before the customer ever confirmed is a different
  // question, governed elsewhere. Failing it here would block normal practice.
  it('does not hold an order that was never confirmed', async () => {
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane Coach', email: 'jane@example.com' },
        garments: [{ name: 'Home Jersey', sizing: [{ size: 'M', quantity: 5 }] }],
      }),
    );
    const po = await poFor(created.orderId);

    expect((await confirmationCheck(po.id)).satisfied).toBe(true);
  });

  it('can be sidestepped with a reason, like the other checks', async () => {
    const { orderId, garmentId } = await seedConfirmedOrder();
    const po = await poFor(orderId);
    await bumpQuantity(garmentId);
    const check = await confirmationCheck(po.id);

    expect(check.allowSidestep).toBe(true);
    await setChecklistItem(po.id, check.id, true, {
      actorEmail: 'sam@example.com',
      sidestepReason: 'customer agreed by phone this morning',
    });

    const after = await confirmationCheck(po.id);
    expect(after.satisfied).toBe(true);
    expect(after.sidestepped).toBe(true);
  });
});

describe('the customer confirming again', () => {
  it('is refused while no one has asked — a confirmed order is closed', async () => {
    const { token } = await seedConfirmedOrder();

    await expect(
      confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('already_confirmed');
  });

  it('adds a SECOND confirmation rather than overwriting the first', async () => {
    const { orderId, garmentId, token } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});

    await confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' });

    const rows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, orderId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.revision).sort()).toEqual([1, 2]);

    // The ORIGINAL agreement is still readable, and still says 20.
    const first = rows.find((r) => r.revision === 1)!;
    const firstGarments = first.confirmedSnapshot.garments as Array<{
      sizing: Array<{ quantity: number }>;
    }>;
    expect(firstGarments[0].sizing.reduce((n, s) => n + s.quantity, 0)).toBe(20);
  });

  it('clears the flag and reads as in sync afterwards', async () => {
    const { orderId, garmentId, token } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});

    await confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' });

    const state = await getReconfirmationState(orderId);
    expect(state.status).toBe('in_sync');
    expect(state.confirmedRevision).toBe(2);
    expect(state.requestedAt).toBeNull();
  });

  it('emits order.reconfirmed, NOT a second order.confirmed', async () => {
    const { orderId, garmentId, token } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});

    await confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' });

    const confirmed = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.eventType, 'order.confirmed'));
    const reconfirmed = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.eventType, 'order.reconfirmed'));
    expect(confirmed).toHaveLength(1);
    expect(reconfirmed).toHaveLength(1);
  });

  // Agreeing again to an edited order is the SAME sale. A second conversion
  // would overstate revenue in Google Ads.
  it('does not count the sale a second time', async () => {
    const { orderId, garmentId, token } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});

    await confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' });

    const conversions = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.orderId, orderId));
    expect(conversions).toHaveLength(1);
  });

  it('the agreement in force is the latest revision', async () => {
    const { orderId, garmentId, token } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});
    await confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' });

    const inForce = await latestConfirmation(orderId);

    expect(inForce!.revision).toBe(2);
  });

  it('a second confirm attempt after re-confirming is refused again', async () => {
    const { orderId, garmentId, token } = await seedConfirmedOrder();
    await bumpQuantity(garmentId);
    await requestReconfirmation(orderId, {});
    await confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' });

    await expect(
      confirmOrder({ rawToken: token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('already_confirmed');
  });
});
