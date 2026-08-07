/**
 * The awaiting-approval FLAG (David, 2026-08-06): the factory submits a
 * finished phase, the PO badges until we approve, approving tells them to
 * proceed. The point of the design is that the STATUS does not move on
 * submission — what changes is whose court the ball is in — so that is what
 * these tests pin hardest.
 */
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
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import {
  approveSubmission,
  createPurchaseOrder,
  updatePurchaseOrderStatus,
} from './service';
import { submitForApproval } from '@/server/supplier-portal/service';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedSentPo(status: 'test_print' | 'in_transit' | 'received' = 'test_print') {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: 'Dynasty', supplierCode: 'DY', portalPassword: 'fish-tuesday' })
    .returning();
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice' }] }],
    }),
  );
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  }))!;
  const po = await createPurchaseOrder({
    orderId: created.orderId,
    supplierId: supplier.id,
    garmentIds: [garment.id],
  });
  await updatePurchaseOrderStatus(po.id, status);
  return { supplier, po, orderId: created.orderId };
}

const person = { name: 'Ana' };

describe('submitForApproval', () => {
  it('raises the flag WITHOUT moving the status, recording who and what', async () => {
    const { supplier, po, orderId } = await seedSentPo('test_print');

    const result = await submitForApproval(
      { id: supplier.id, name: supplier.name },
      po.poNumber,
      person.name,
      '  Test print photos attached  ',
    );

    const row = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    // The whole point of the flag model: the phase is unchanged.
    expect(row.status).toBe('test_print');
    expect(row.awaitingApprovalAt).toBeInstanceOf(Date);
    expect(row.awaitingApprovalBy).toBe('Ana (Dynasty)');
    expect(row.awaitingApprovalNote).toBe('Test print photos attached');
    expect(row.awaitingApprovalStatus).toBe('test_print');
    expect(result.awaitingApprovalAt).toBeInstanceOf(Date);

    const events = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.submitted_for_approval'),
      ),
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ poId: po.id, status: 'test_print', actorLabel: 'Ana (Dynasty)' });
  });

  it('is a no-op when already awaiting — a supplier clicking twice has done nothing wrong', async () => {
    const { supplier, po } = await seedSentPo();
    const first = await submitForApproval({ id: supplier.id, name: supplier.name }, po.poNumber, 'Ana', 'one');
    const second = await submitForApproval({ id: supplier.id, name: supplier.name }, po.poNumber, 'Bo', 'two');

    expect(second.awaitingApprovalAt.getTime()).toBe(first.awaitingApprovalAt.getTime());
    const row = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    // The first submission stands — the second neither overwrites nor errors.
    expect(row.awaitingApprovalBy).toBe('Ana (Dynasty)');
    expect(row.awaitingApprovalNote).toBe('one');
  });

  it('refuses once the job is finished — there is nothing left to approve', async () => {
    const { supplier, po } = await seedSentPo('received');
    await expect(
      submitForApproval({ id: supplier.id, name: supplier.name }, po.poNumber, 'Ana', null),
    ).rejects.toThrow('locked_after_shipping');
  });
});

describe('approveSubmission', () => {
  it('clears the flag, tells the supplier in the shared thread, and audits who approved', async () => {
    const { supplier, po, orderId } = await seedSentPo('test_print');
    await submitForApproval({ id: supplier.id, name: supplier.name }, po.poNumber, 'Ana', 'photos attached');

    const result = await approveSubmission(po.id, { actorEmail: 'staff@example.com' });

    expect(result.approvedStatus).toBe('test_print');
    expect(result.advancedTo).toBeNull();
    const row = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    expect(row.awaitingApprovalAt).toBeNull();
    expect(row.awaitingApprovalBy).toBeNull();
    expect(row.awaitingApprovalNote).toBeNull();
    expect(row.status).toBe('test_print'); // no advance was asked for

    // The supplier's copy: a SHARED note, which is what their activity feed reads.
    const notes = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, orderId),
    });
    const approval = notes.find((n) => n.body.includes('Approved'));
    expect(approval).toBeDefined();
    expect(approval!.visibility).toBe('shared');
    expect(approval!.authorKind).toBe('system');

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.approval_given'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorEmail).toBe('staff@example.com');
  });

  it('advances the status in the same act when asked, and says so to the supplier', async () => {
    const { supplier, po, orderId } = await seedSentPo('test_print');
    await submitForApproval({ id: supplier.id, name: supplier.name }, po.poNumber, 'Ana', null);

    const result = await approveSubmission(po.id, {
      actorEmail: 'staff@example.com',
      advanceTo: 'prod_layout',
      comment: 'Colours look right.',
    });

    expect(result.advancedTo).toBe('prod_layout');
    const row = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    expect(row.status).toBe('prod_layout');
    expect(row.awaitingApprovalAt).toBeNull();

    const notes = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, orderId),
    });
    const approval = notes.find((n) => n.body.includes('Approved'))!;
    expect(approval.body).toContain('Colours look right.');
    expect(approval.body).toContain('prod layout');
  });

  it('refuses an illegal advance, leaving the flag up rather than half-applying', async () => {
    const { supplier, po } = await seedSentPo('test_print');
    await submitForApproval({ id: supplier.id, name: supplier.name }, po.poNumber, 'Ana', null);

    await expect(
      approveSubmission(po.id, { actorEmail: 'staff@example.com', advanceTo: 'sent' }),
    ).rejects.toThrow(/Cannot move a test_print purchase order to sent/);

    const row = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    expect(row.status).toBe('test_print');
    expect(row.awaitingApprovalAt).not.toBeNull(); // still waiting on us
  });

  it('refuses when nothing was submitted', async () => {
    const { po } = await seedSentPo();
    await expect(approveSubmission(po.id, { actorEmail: 'staff@example.com' })).rejects.toThrow(
      'not waiting for approval',
    );
  });
});
