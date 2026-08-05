/**
 * Route-level tests for the supplier-side production files surface
 * (/api/supplier/[code]/po/[poNumber]/files*). Lives beside the [code]
 * directory — same convention as portal-routes.integration.test.ts — so the
 * bracket segment never meets a test glob.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

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
    isStorageConfigured: vi.fn().mockReturnValue(true),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { buildSupplierSessionCookie } from '@/lib/supplier-session';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import {
  createPurchaseOrder,
  updatePurchaseOrderStatus,
} from '@/server/purchase-orders/service';
import { GET as GET_FILES, POST as POST_FILE } from './[code]/po/[poNumber]/files/route';
import { POST as POST_COMMENT } from './[code]/po/[poNumber]/files/[fileId]/route';
import { GET as GET_ZIP } from './[code]/po/[poNumber]/files.zip/route';

afterEach(async () => {
  await resetTestDb(db);
  storage.store.clear();
});

const PASSWORD = 'fish-tuesday';

async function seedSupplier(overrides: Partial<typeof schema.suppliers.$inferInsert> = {}) {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      name: 'Vast Apparel',
      supplierCode: 'VA',
      portalPassword: PASSWORD,
      ...overrides,
    })
    .returning();
  return supplier;
}

async function seedPo(supplierId: string, opts: { sent?: boolean } = { sent: true }) {
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
    supplierId,
    garmentIds: [garment.id],
  });
  if (opts.sent !== false) await updatePurchaseOrderStatus(po.id, 'sent');
  return { po, orderId: created.orderId };
}

function cookieHeaderFor(supplier: { id: string; portalPassword: string | null }, name = 'Ana') {
  const cookie = buildSupplierSessionCookie({ supplier, name });
  return `${cookie.name}=${cookie.value}`;
}

function getRequest(url: string, cookie?: string | null) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${url}`, { method: 'GET', headers });
}

function jsonRequest(url: string, body: unknown, cookie?: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

function uploadRequest(url: string, cookie: string | null, file?: File, category?: string) {
  const formData = new FormData();
  if (file) formData.set('file', file);
  if (category !== undefined) formData.set('category', category);
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  // Content-type is set by the runtime from the FormData boundary.
  return new NextRequest(`http://localhost${url}`, { method: 'POST', body: formData, headers });
}

function pdfFile(name = 'layout-v1.pdf') {
  return new File([Buffer.from('%PDF-fake layout bytes')], name, { type: 'application/pdf' });
}

const withParams = <P,>(params: P) => ({ params: Promise.resolve(params) });

describe('supplier session gate', () => {
  it('401s every files route without the session cookie', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedPo(supplier.id);
    const params = withParams({ code: 'VA', poNumber: po.poNumber });

    expect((await GET_FILES(getRequest('/x'), params)).status).toBe(401);
    expect((await POST_FILE(uploadRequest('/x', null, pdfFile()), params)).status).toBe(401);
    expect(
      (
        await POST_COMMENT(
          jsonRequest('/x', { body: 'hi' }),
          withParams({ code: 'VA', poNumber: po.poNumber, fileId: po.id }),
        )
      ).status,
    ).toBe(401);
    expect((await GET_ZIP(getRequest('/x'), params)).status).toBe(401);
  });

  it('404s a DRAFT po — not yet the supplier’s business — and another supplier’s number', async () => {
    const supplier = await seedSupplier();
    const rival = await seedSupplier({ name: 'Goal Sports', supplierCode: 'GOAL' });
    const { po: draft } = await seedPo(supplier.id, { sent: false });
    const { po: sent } = await seedPo(supplier.id);

    const draftRes = await GET_FILES(
      getRequest('/x', cookieHeaderFor(supplier)),
      withParams({ code: 'VA', poNumber: draft.poNumber }),
    );
    expect(draftRes.status).toBe(404);

    const crossRes = await GET_FILES(
      getRequest('/x', cookieHeaderFor(rival)),
      withParams({ code: 'GOAL', poNumber: sent.poNumber }),
    );
    expect(crossRes.status).toBe(404);
  });
});

describe('POST /api/supplier/[code]/po/[poNumber]/files', () => {
  it('uploads a production file attributed to the named person at the supplier', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedPo(supplier.id);

    const res = await POST_FILE(
      uploadRequest('/x', cookieHeaderFor(supplier), pdfFile(), 'layout'),
      withParams({ code: 'VA', poNumber: po.poNumber }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toMatchObject({
      poId: po.id,
      fileName: 'layout-v1.pdf',
      category: 'layout',
      uploadedByKind: 'supplier',
      uploadedByLabel: 'Ana (Vast Apparel)',
      statusAtUpload: 'sent',
    });
    expect(storage.store.size).toBe(1);
  });

  it('rejects an extension outside the allowlist with 400', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedPo(supplier.id);

    const res = await POST_FILE(
      uploadRequest('/x', cookieHeaderFor(supplier), pdfFile('malware.exe')),
      withParams({ code: 'VA', poNumber: po.poNumber }),
    );
    expect(res.status).toBe(400);
    expect(storage.store.size).toBe(0);
  });
});

describe('GET files + comment thread', () => {
  it('lists the files with threads; a comment is attributed and lands shared', async () => {
    const supplier = await seedSupplier();
    const { po, orderId } = await seedPo(supplier.id);
    const upload = await POST_FILE(
      uploadRequest('/x', cookieHeaderFor(supplier), pdfFile()),
      withParams({ code: 'VA', poNumber: po.poNumber }),
    );
    const file = await upload.json();

    const comment = await POST_COMMENT(
      jsonRequest('/x', { body: 'Fabric arrives Tuesday.' }, cookieHeaderFor(supplier)),
      withParams({ code: 'VA', poNumber: po.poNumber, fileId: file.id }),
    );
    expect(comment.status).toBe(201);

    const notes = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, orderId),
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].poFileId).toBe(file.id);
    expect(notes[0].visibility).toBe('shared');
    expect(notes[0].authorKind).toBe('supplier');
    expect(notes[0].authorLabel).toBe('Ana (Vast Apparel)');

    const list = await GET_FILES(
      getRequest('/x', cookieHeaderFor(supplier)),
      withParams({ code: 'VA', poNumber: po.poNumber }),
    );
    const { items } = await list.json();
    expect(list.status).toBe(200);
    expect(items).toHaveLength(1);
    expect(items[0].comments.map((c: { body: string }) => c.body)).toEqual([
      'Fabric arrives Tuesday.',
    ]);
  });
});

describe('GET /api/supplier/[code]/po/[poNumber]/files.zip', () => {
  it('serves the bundle to a session holder', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedPo(supplier.id);
    await POST_FILE(
      uploadRequest('/x', cookieHeaderFor(supplier), pdfFile(), 'layout'),
      withParams({ code: 'VA', poNumber: po.poNumber }),
    );

    const res = await GET_ZIP(
      getRequest('/x', cookieHeaderFor(supplier)),
      withParams({ code: 'VA', poNumber: po.poNumber }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain(`${po.poNumber}-files.zip`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('409s when the PO has nothing to bundle', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedPo(supplier.id);

    const res = await GET_ZIP(
      getRequest('/x', cookieHeaderFor(supplier)),
      withParams({ code: 'VA', poNumber: po.poNumber }),
    );
    expect(res.status).toBe(409);
  });
});
