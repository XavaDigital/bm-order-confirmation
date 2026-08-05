/**
 * Production files on a PO (David, 2026-08-05) — src/server/purchase-orders/files-service.ts.
 *
 * Storage is mocked with an in-memory map so uploads, reads, unreadable
 * objects and the never-delete-the-object rule are all observable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

const storage = vi.hoisted(() => ({
  store: new Map<string, Buffer>(),
}));

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
    uploadFile: vi.fn(async (key: string, buffer: Buffer) => {
      storage.store.set(key, buffer);
      return key;
    }),
    getSignedUrl: vi.fn(async (key: string) => `https://signed.example.com/${key}`),
    getFileBuffer: vi.fn(async (key: string) => {
      const buf = storage.store.get(key);
      if (!buf) throw new Error(`NoSuchKey: ${key}`);
      return buf;
    }),
    deleteFile: vi.fn(async () => undefined),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { deleteFile } from '@/lib/storage';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createPurchaseOrder, updatePurchaseOrderStatus } from './service';
import {
  addPoFile,
  addPoFileComment,
  buildPoZip,
  listPoFiles,
  softDeletePoFile,
} from './files-service';

afterEach(async () => {
  await resetTestDb(db);
  storage.store.clear();
  vi.mocked(deleteFile).mockClear();
});

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function seedPo(code = 'VA') {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: `Supplier ${code}`, supplierCode: code })
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
  return { po, orderId: created.orderId, garmentId: garment.id, supplier };
}

function upload(poId: string, name: string, opts: { category?: string | null; kind?: 'staff' | 'supplier'; label?: string } = {}) {
  return addPoFile(poId, {
    fileName: name,
    data: Buffer.from(`bytes of ${name}`),
    contentType: 'application/pdf',
    category: opts.category ?? null,
    uploadedByKind: opts.kind ?? 'supplier',
    uploadedByLabel: opts.label ?? 'Ana (Vast Apparel)',
  });
}

/** Walk the zip's local file headers — the entry names, in order. */
function zipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const nameLen = zip.readUInt16LE(offset + 26);
    const size = zip.readUInt32LE(offset + 18);
    names.push(zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8'));
    offset += 30 + nameLen + size;
  }
  return names;
}

describe('addPoFile', () => {
  it('stores the bytes, stamps statusAtUpload from the PO’s CURRENT status, and returns the DTO', async () => {
    const { po } = await seedPo();

    const draft = await upload(po.id, 'layout-v1.pdf', { category: 'layout' });
    expect(draft.statusAtUpload).toBe('draft');
    expect(draft.category).toBe('layout');
    expect(draft.uploadedByKind).toBe('supplier');
    expect(draft.uploadedByLabel).toBe('Ana (Vast Apparel)');
    expect(draft.sizeBytes).toBe(Buffer.byteLength('bytes of layout-v1.pdf'));
    expect(draft.downloadUrl).toMatch(/^https:\/\/signed\.example\.com\/po-files\//);
    expect(draft.comments).toEqual([]);

    // The object landed under the PO's namespace with a per-upload prefix.
    const keys = [...storage.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^po-files/${po.id}/.+-layout-v1\\.pdf$`));

    // After the status moves, the NEXT upload stamps the new status — the
    // list reads as a timeline of when in the flow each file arrived.
    await updatePurchaseOrderStatus(po.id, 'sent');
    const sent = await upload(po.id, 'test-print.pdf');
    expect(sent.statusAtUpload).toBe('sent');
    expect(draft.statusAtUpload).toBe('draft'); // earlier stamp untouched
  });

  it('two uploads of the same filename keep distinct objects', async () => {
    const { po } = await seedPo();
    await upload(po.id, 'layout.pdf');
    await upload(po.id, 'layout.pdf');
    expect(storage.store.size).toBe(2);
  });

  it('emits the outbox event and the audit row, attributed to the uploader label', async () => {
    const { po, orderId } = await seedPo();

    const file = await upload(po.id, 'layout-v1.pdf', { category: 'layout' });

    const events = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.file_uploaded'),
      ),
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      poId: po.id,
      poNumber: po.poNumber,
      fileId: file.id,
      fileName: 'layout-v1.pdf',
      category: 'layout',
      uploadedByKind: 'supplier',
      uploadedByLabel: 'Ana (Vast Apparel)',
      statusAtUpload: 'draft',
    });

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.file_uploaded'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorEmail).toBe('Ana (Vast Apparel)');
  });

  it('404s an unknown purchase order before touching storage', async () => {
    await expect(upload(MISSING_ID, 'layout.pdf')).rejects.toThrow('Purchase order not found');
    expect(storage.store.size).toBe(0);
  });
});

describe('listPoFiles', () => {
  it('lists live files oldest first with each file’s own comment thread', async () => {
    const { po } = await seedPo();
    const first = await upload(po.id, 'layout-v1.pdf');
    // Force a strictly earlier createdAt so the ordering assertion cannot tie.
    await db
      .update(schema.poFiles)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.poFiles.id, first.id));
    const second = await upload(po.id, 'test-print.jpg');

    await addPoFileComment(po.id, first.id, 'Logo is too small', {
      authorKind: 'staff',
      authorLabel: 'staff@x.com',
    });
    await addPoFileComment(po.id, second.id, 'Print looks right', {
      authorKind: 'supplier',
      authorLabel: 'Ana (Vast Apparel)',
    });

    const files = await listPoFiles(po.id);

    expect(files.map((f) => f.fileName)).toEqual(['layout-v1.pdf', 'test-print.jpg']);
    // Threads are batched per file — a comment must appear on ITS file only.
    expect(files[0].comments.map((c) => c.body)).toEqual(['Logo is too small']);
    expect(files[1].comments.map((c) => c.body)).toEqual(['Print looks right']);
    expect(files[0].comments[0].poFileId).toBe(first.id);
    expect(files[0].comments[0].visibility).toBe('shared');
    expect(files.every((f) => f.downloadUrl?.startsWith('https://signed.example.com/'))).toBe(true);
  });

  it('answers empty for a PO with no files and 404s an unknown PO', async () => {
    const { po } = await seedPo();
    expect(await listPoFiles(po.id)).toEqual([]);
    await expect(listPoFiles(MISSING_ID)).rejects.toThrow('Purchase order not found');
  });
});

describe('addPoFileComment', () => {
  it('is always shared-visibility and lands on the PO’s order', async () => {
    const { po, orderId } = await seedPo();
    const file = await upload(po.id, 'layout.pdf');

    const note = await addPoFileComment(po.id, file.id, 'Move the crest up', {
      authorKind: 'supplier',
      authorLabel: 'Ana (Vast Apparel)',
    });

    expect(note.poFileId).toBe(file.id);
    expect(note.orderId).toBe(orderId);
    expect(note.visibility).toBe('shared');
    expect(note.authorKind).toBe('supplier');
    expect(note.authorLabel).toBe('Ana (Vast Apparel)');
  });

  it('404s a file id that belongs to ANOTHER po', async () => {
    const { po } = await seedPo();
    const other = await seedPo('GS');
    const foreign = await upload(other.po.id, 'other.pdf');

    await expect(
      addPoFileComment(po.id, foreign.id, 'hello', { authorKind: 'staff', authorLabel: null }),
    ).rejects.toThrow('File not found');
  });

  it('404s an unknown file and a soft-deleted file', async () => {
    const { po } = await seedPo();
    const file = await upload(po.id, 'layout.pdf');
    await softDeletePoFile(po.id, file.id);

    await expect(
      addPoFileComment(po.id, MISSING_ID, 'hello', { authorKind: 'staff', authorLabel: null }),
    ).rejects.toThrow('File not found');
    await expect(
      addPoFileComment(po.id, file.id, 'hello', { authorKind: 'staff', authorLabel: null }),
    ).rejects.toThrow('File not found');
  });
});

describe('softDeletePoFile', () => {
  it('hides the file from the list but NEVER deletes the stored object', async () => {
    const { po, orderId } = await seedPo();
    const file = await upload(po.id, 'mistake.pdf');

    await softDeletePoFile(po.id, file.id, { actorEmail: 'staff@x.com' });

    expect(await listPoFiles(po.id)).toEqual([]);
    expect(storage.store.size).toBe(1); // object untouched
    expect(deleteFile).not.toHaveBeenCalled();

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.file_removed'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({ fileId: file.id, fileName: 'mistake.pdf' });
    expect(audits[0].actorEmail).toBe('staff@x.com');
  });

  it('deleting twice is a no-op (no second audit row)', async () => {
    const { po, orderId } = await seedPo();
    const file = await upload(po.id, 'mistake.pdf');

    await softDeletePoFile(po.id, file.id);
    await softDeletePoFile(po.id, file.id);

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.file_removed'),
      ),
    });
    expect(audits).toHaveLength(1);
  });

  it('404s a file on another po and an unknown file', async () => {
    const { po } = await seedPo();
    const other = await seedPo('GS');
    const foreign = await upload(other.po.id, 'other.pdf');

    await expect(softDeletePoFile(po.id, foreign.id)).rejects.toThrow('File not found');
    await expect(softDeletePoFile(po.id, MISSING_ID)).rejects.toThrow('File not found');
  });
});

describe('buildPoZip', () => {
  /** A PO whose snapshot carries an asset, a size chart and a mock-up image. */
  async function seedRichPo() {
    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: 'Vast Apparel', supplierCode: 'VA' })
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

    await db.insert(schema.orderAssets).values({
      orderId: created.orderId,
      kind: 'font',
      name: 'Squad Font',
      storageKey: 'assets/o1/font.otf',
      includeOnPo: true,
    });
    const [chart] = await db
      .insert(schema.sizeCharts)
      .values({ name: 'Adult Chart', storageKey: 'size-charts/adult.pdf' })
      .returning();
    await db
      .insert(schema.garmentSizeChartLinks)
      .values({ garmentId: garment.id, sizeChartId: chart.id });
    await db.insert(schema.mockupImages).values({
      garmentId: garment.id,
      storageKey: 'mockups/g1/front.png',
      caption: 'Front',
    });

    storage.store.set('assets/o1/font.otf', Buffer.from('font-bytes'));
    storage.store.set('size-charts/adult.pdf', Buffer.from('chart-bytes'));
    storage.store.set('mockups/g1/front.png', Buffer.from('image-bytes'));

    const po = await createPurchaseOrder({
      orderId: created.orderId,
      supplierId: supplier.id,
      garmentIds: [garment.id],
    });
    return { po };
  }

  it('bundles snapshot assets, charts, images and LIVE production files, grouped by folder', async () => {
    const { po } = await seedRichPo();
    await upload(po.id, 'layout-v1.pdf', { category: 'layout' });
    await upload(po.id, 'test-print.jpg');
    const gone = await upload(po.id, 'mistake.pdf');
    await softDeletePoFile(po.id, gone.id);

    const { fileName, data } = await buildPoZip(po.id);

    expect(fileName).toBe(`${po.poNumber}-files.zip`);
    const names = zipEntryNames(data);
    expect(names).toContain('assets/Squad Font.otf');
    expect(names).toContain('size-charts/Adult Chart.pdf');
    expect(names).toContain('images/Team Hoodie/Front.png');
    expect(names).toContain('production-files/layout/layout-v1.pdf');
    expect(names).toContain('production-files/uncategorised/test-print.jpg');
    // The soft-deleted file must not ride along.
    expect(names.some((n) => n.includes('mistake'))).toBe(false);
    expect(names).toHaveLength(5);
  });

  it('skips an unreadable object but still delivers the rest', async () => {
    const { po } = await seedRichPo();
    await upload(po.id, 'layout-v1.pdf', { category: 'layout' });
    storage.store.delete('assets/o1/font.otf'); // the object store lost one

    const { data } = await buildPoZip(po.id);

    const names = zipEntryNames(data);
    expect(names).not.toContain('assets/Squad Font.otf');
    expect(names).toContain('production-files/layout/layout-v1.pdf');
    // chart + image + the one production file — everything except the lost asset.
    expect(names).toHaveLength(3);
  });

  it('409s when the PO has no files at all, and when nothing is readable', async () => {
    const { po } = await seedPo(); // bare snapshot: no assets/charts/images
    await expect(buildPoZip(po.id)).rejects.toThrow(
      'This purchase order has no files to download',
    );

    const file = await upload(po.id, 'layout.pdf');
    const row = await db.query.poFiles.findFirst({ where: eq(schema.poFiles.id, file.id) });
    storage.store.delete(row!.storageKey);
    await expect(buildPoZip(po.id)).rejects.toThrow('None of the files could be read from storage');
  });

  it('404s an unknown purchase order', async () => {
    await expect(buildPoZip(MISSING_ID)).rejects.toThrow('Purchase order not found');
  });
});
