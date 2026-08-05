/**
 * Note scopes after production-file threads landed (David, 2026-08-05):
 * scope 'order' is the ORDER-WIDE thread and must exclude garment threads AND
 * per-file threads — file comments render under their files, and leaking them
 * into the order thread would double-show every "change this" message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrder } from './service';
import { createOrderSchema } from './contract';
import { addOrderNote, listOrderNotes } from './notes-service';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedThreads() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M' }] }],
    }),
  );
  const orderId = created.orderId;
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, orderId),
  }))!;

  // A production file to anchor the file thread. Inserted directly — this
  // test is about note scoping, not uploads.
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: 'Vast Apparel', supplierCode: 'VA' })
    .returning();
  const [po] = await db
    .insert(schema.purchaseOrders)
    .values({ poNumber: 'VA1', orderId, supplierId: supplier.id, status: 'sent' })
    .returning();
  const [file] = await db
    .insert(schema.poFiles)
    .values({
      poId: po.id,
      fileName: 'layout.pdf',
      storageKey: `po-files/${po.id}/layout.pdf`,
      uploadedByKind: 'supplier',
      uploadedByLabel: 'Ana (Vast Apparel)',
      statusAtUpload: 'sent',
    })
    .returning();

  await addOrderNote(orderId, { body: 'order-wide note', authorKind: 'staff' });
  await addOrderNote(orderId, {
    body: 'garment note',
    authorKind: 'staff',
    garmentId: garment.id,
  });
  await addOrderNote(orderId, {
    body: 'file comment',
    authorKind: 'supplier',
    authorLabel: 'Ana (Vast Apparel)',
    poFileId: file.id,
  });

  return { orderId, garmentId: garment.id, fileId: file.id };
}

describe('listOrderNotes scopes', () => {
  it("scope 'order' excludes garment threads AND file threads (regression)", async () => {
    const { orderId } = await seedThreads();

    const notes = await listOrderNotes(orderId, 'order');

    expect(notes.map((n) => n.body)).toEqual(['order-wide note']);
  });

  it("scope {poFileId} returns exactly that file's thread", async () => {
    const { orderId, fileId } = await seedThreads();

    const notes = await listOrderNotes(orderId, { poFileId: fileId });

    expect(notes.map((n) => n.body)).toEqual(['file comment']);
    expect(notes[0].poFileId).toBe(fileId);
    // Supplier-authored comments are forced shared — both sides read the thread.
    expect(notes[0].visibility).toBe('shared');
  });

  it("scope {garmentId} still returns only the garment thread", async () => {
    const { orderId, garmentId } = await seedThreads();

    const notes = await listOrderNotes(orderId, { garmentId });

    expect(notes.map((n) => n.body)).toEqual(['garment note']);
    expect(notes[0].poFileId).toBeNull();
  });

  it("scope 'all' sees every thread, and the DTO carries poFileId", async () => {
    const { orderId, fileId } = await seedThreads();

    const notes = await listOrderNotes(orderId, 'all');

    expect(notes.map((n) => n.body).sort()).toEqual([
      'file comment',
      'garment note',
      'order-wide note',
    ]);
    const fileNote = notes.find((n) => n.body === 'file comment')!;
    expect(fileNote.poFileId).toBe(fileId);
  });
});
