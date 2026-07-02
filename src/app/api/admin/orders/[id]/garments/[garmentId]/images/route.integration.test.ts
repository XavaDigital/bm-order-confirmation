import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

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
    uploadFile: vi.fn().mockResolvedValue('mock-storage-key'),
    getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/mock'),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { uploadFile, getSignedUrl } from '@/lib/storage';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(uploadFile).mockClear();
  vi.mocked(getSignedUrl).mockClear();
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

async function seedOrderWithGarment() {
  const created = await createOrder(minimalOrderInput());
  const garment = await db.query.garments.findFirst({ where: eq(schema.garments.orderId, created.orderId) });
  return { orderId: created.orderId, garmentId: garment!.id };
}

function multipartRequest(fields: { file?: File; caption?: string }) {
  const formData = new FormData();
  if (fields.file) formData.set('file', fields.file);
  if (fields.caption !== undefined) formData.set('caption', fields.caption);
  return new NextRequest('http://localhost/api/admin/orders/x/garments/y/images', {
    method: 'POST',
    body: formData,
  });
}

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/orders/x/garments/y/images', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/admin/orders/[id]/garments/[garmentId]/images', () => {
  it('returns 400 when the body is not multipart/form-data', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await POST(jsonRequest({ file: 'nope' }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when the "file" field is missing', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await POST(multipartRequest({ caption: 'hi' }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Missing "file"/);
  });

  it('returns 400 for a disallowed content type', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();
    const file = new File(['abc'], 'doc.pdf', { type: 'application/pdf' });

    const res = await POST(multipartRequest({ file }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when the file exceeds the 10 MB limit', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const file = new File([big], 'huge.png', { type: 'image/png' });

    const res = await POST(multipartRequest({ file }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/10 MB/);
  });

  it('returns 201 with the image row and signed url, and persists it', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();
    const file = new File(['abc'], 'mockup.png', { type: 'image/png' });

    const res = await POST(multipartRequest({ file, caption: 'Front view' }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.url).toBe('https://signed.example.com/mock');
    expect(json.caption).toBe('Front view');
    expect(uploadFile).toHaveBeenCalledTimes(1);

    const rows = await db.query.mockupImages.findMany({ where: eq(schema.mockupImages.garmentId, garmentId) });
    expect(rows).toHaveLength(1);
  });
});
