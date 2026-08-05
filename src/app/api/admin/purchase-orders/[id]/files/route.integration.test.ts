/**
 * Route-level tests for the admin production-files surface (David, 2026-08-05):
 * GET/POST /api/admin/purchase-orders/[id]/files, POST/DELETE …/files/[fileId],
 * GET …/files.zip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/session', () => {
  const store: Record<string, unknown> = {};
  const session = new Proxy(store, {
    get(target, prop) {
      if (prop === 'save') return async () => {};
      if (prop === 'destroy') return () => { for (const k of Object.keys(target)) delete target[k]; };
      return target[prop as string];
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return { getSession: vi.fn(async () => session) };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { getSession } from '@/lib/session';
import { isStorageConfigured } from '@/lib/storage';
import * as schema from '@/db/schema';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createPurchaseOrder } from '@/server/purchase-orders/service';
import { GET, POST } from './route';
import { POST as POST_COMMENT, DELETE } from './[fileId]/route';
import { GET as GET_ZIP } from '../files.zip/route';

beforeEach(async () => {
  // A real row: file comments stamp authorStaffUserId from the session, and
  // that column is a uuid FK onto staff_users.
  const [user] = await db
    .insert(schema.staffUsers)
    .values({ email: 'staff@x.com', passwordHash: 'x', name: 'Sam Staff' })
    .returning();
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = user.id;
  session.role = 'sales';
  session.email = user.email;
});

afterEach(async () => {
  await resetTestDb(db);
  storage.store.clear();
  vi.mocked(isStorageConfigured).mockReturnValue(true);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function clearSession() {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
}

async function seedPo(code = 'VA') {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: `Supplier ${code}`, supplierCode: code })
    .returning();
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M' }] }],
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
  return { po, orderId: created.orderId };
}

function uploadRequest(file?: File, category?: string) {
  const formData = new FormData();
  if (file) formData.set('file', file);
  if (category !== undefined) formData.set('category', category);
  return new NextRequest('http://localhost/api/admin/purchase-orders/x/files', {
    method: 'POST',
    body: formData,
  });
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const withFileId = (id: string, fileId: string) => ({
  params: Promise.resolve({ id, fileId }),
});

function pdfFile(name = 'layout-v1.pdf') {
  return new File([Buffer.from('%PDF-fake layout bytes')], name, { type: 'application/pdf' });
}

describe('auth gate', () => {
  it('401s every files route without a session', async () => {
    await clearSession();
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await GET(jsonRequest(`/x/${id}/files`, 'GET'), withId(id))).status).toBe(401);
    expect((await POST(uploadRequest(pdfFile()), withId(id))).status).toBe(401);
    expect(
      (await POST_COMMENT(jsonRequest(`/x`, 'POST', { body: 'hi' }), withFileId(id, id))).status,
    ).toBe(401);
    expect((await DELETE(jsonRequest('/x', 'DELETE'), withFileId(id, id))).status).toBe(401);
    expect((await GET_ZIP(jsonRequest('/x', 'GET'), withId(id))).status).toBe(401);
  });

  it('read-only viewers can list but not upload, comment or delete', async () => {
    const { po } = await seedPo();
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.role = 'viewer';

    expect((await GET(jsonRequest('/x', 'GET'), withId(po.id))).status).toBe(200);
    expect((await POST(uploadRequest(pdfFile()), withId(po.id))).status).toBe(403);
    expect(
      (await POST_COMMENT(jsonRequest('/x', 'POST', { body: 'hi' }), withFileId(po.id, po.id)))
        .status,
    ).toBe(403);
    expect((await DELETE(jsonRequest('/x', 'DELETE'), withFileId(po.id, po.id))).status).toBe(403);
  });
});

describe('POST /files (staff upload)', () => {
  it('uploads a file, stamps the status and attributes the session email', async () => {
    const { po } = await seedPo();

    const res = await POST(uploadRequest(pdfFile(), 'layout'), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toMatchObject({
      poId: po.id,
      fileName: 'layout-v1.pdf',
      category: 'layout',
      uploadedByKind: 'staff',
      uploadedByLabel: 'staff@x.com',
      statusAtUpload: 'draft',
      comments: [],
    });
    expect(json.downloadUrl).toMatch(/^https:\/\/signed\.example\.com\//);
    expect(storage.store.size).toBe(1);
  });

  it('rejects an extension outside the production-file allowlist', async () => {
    const { po } = await seedPo();
    const res = await POST(uploadRequest(pdfFile('malware.exe')), withId(po.id));
    expect(res.status).toBe(400);
    expect(storage.store.size).toBe(0);
  });

  it('503s when storage is unconfigured and 404s an unknown PO', async () => {
    vi.mocked(isStorageConfigured).mockReturnValue(false);
    const { po } = await seedPo();
    expect((await POST(uploadRequest(pdfFile()), withId(po.id))).status).toBe(503);

    vi.mocked(isStorageConfigured).mockReturnValue(true);
    const missing = await POST(
      uploadRequest(pdfFile()),
      withId('00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.status).toBe(404);
  });
});

describe('GET /files + file comments + DELETE', () => {
  it('lists uploads with their comment threads', async () => {
    const { po } = await seedPo();
    const upload = await POST(uploadRequest(pdfFile(), 'layout'), withId(po.id));
    const file = await upload.json();

    const comment = await POST_COMMENT(
      jsonRequest('/x', 'POST', { body: 'Crest needs to be bigger' }),
      withFileId(po.id, file.id),
    );
    expect(comment.status).toBe(201);
    const note = await comment.json();
    expect(note.visibility).toBe('shared'); // the supplier reads this thread
    expect(note.poFileId).toBe(file.id);
    expect(note.authorKind).toBe('staff');

    const res = await GET(jsonRequest('/x', 'GET'), withId(po.id));
    const { items } = await res.json();
    expect(res.status).toBe(200);
    expect(items).toHaveLength(1);
    expect(items[0].comments.map((c: { body: string }) => c.body)).toEqual([
      'Crest needs to be bigger',
    ]);
  });

  it('404s a comment on a file from ANOTHER po', async () => {
    const { po } = await seedPo();
    const other = await seedPo('GS');
    const upload = await POST(uploadRequest(pdfFile()), withId(other.po.id));
    const foreign = await upload.json();

    const res = await POST_COMMENT(
      jsonRequest('/x', 'POST', { body: 'hi' }),
      withFileId(po.id, foreign.id),
    );
    expect(res.status).toBe(404);
  });

  it('DELETE hides the file from the list; the object is never removed', async () => {
    const { po } = await seedPo();
    const upload = await POST(uploadRequest(pdfFile()), withId(po.id));
    const file = await upload.json();

    const res = await DELETE(jsonRequest('/x', 'DELETE'), withFileId(po.id, file.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const list = await GET(jsonRequest('/x', 'GET'), withId(po.id));
    expect((await list.json()).items).toEqual([]);
    expect(storage.store.size).toBe(1); // kept forever

    const missing = await DELETE(
      jsonRequest('/x', 'DELETE'),
      withFileId(po.id, '00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.status).toBe(404);
  });
});

describe('GET /files.zip', () => {
  it('serves the bundle as application/zip named after the PO', async () => {
    const { po } = await seedPo();
    await POST(uploadRequest(pdfFile(), 'layout'), withId(po.id));

    const res = await GET_ZIP(jsonRequest('/x', 'GET'), withId(po.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain(`${po.poNumber}-files.zip`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50); // PK local header
  });

  it('409s when there is nothing to bundle', async () => {
    const { po } = await seedPo();
    const res = await GET_ZIP(jsonRequest('/x', 'GET'), withId(po.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('no files');
  });
});
