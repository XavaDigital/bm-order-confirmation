import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { uploadFile, getSignedUrl } from '@/lib/storage';
import { GET, POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(uploadFile).mockClear();
  vi.mocked(getSignedUrl).mockClear();
});

function multipartRequest(fields: { name?: string; description?: string; file?: File }) {
  const formData = new FormData();
  if (fields.name !== undefined) formData.set('name', fields.name);
  if (fields.description !== undefined) formData.set('description', fields.description);
  if (fields.file) formData.set('file', fields.file);
  return new NextRequest('http://localhost/api/admin/size-charts', { method: 'POST', body: formData });
}

describe('GET /api/admin/size-charts', () => {
  it('returns an empty array when there are none', async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([]);
  });

  it('returns charts ordered by name with a signed url', async () => {
    await db.insert(schema.sizeCharts).values([
      { name: 'Zebra Chart', storageKey: 'size-charts/z.pdf' },
      { name: 'Alpha Chart', storageKey: 'size-charts/a.pdf' },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.map((c: { name: string }) => c.name)).toEqual(['Alpha Chart', 'Zebra Chart']);
    expect(json[0].url).toBe('https://signed.example.com/mock');
  });
});

describe('POST /api/admin/size-charts', () => {
  it('returns 400 when the body is not multipart/form-data', async () => {
    const req = new NextRequest('http://localhost/api/admin/size-charts', {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is missing', async () => {
    const file = new File(['abc'], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest({ file }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file field is missing', async () => {
    const res = await POST(multipartRequest({ name: 'Adult Unisex' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Missing "file"/);
  });

  it('returns 400 for a disallowed content type', async () => {
    const file = new File(['abc'], 'chart.txt', { type: 'text/plain' });
    const res = await POST(multipartRequest({ name: 'Adult Unisex', file }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file exceeds the 20 MB limit', async () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    const file = new File([big], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest({ name: 'Adult Unisex', file }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/20 MB/);
  });

  it('returns 201 with the created chart and persists it', async () => {
    const file = new File(['abc'], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest({ name: 'Adult Unisex', description: 'Standard sizing', file }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.name).toBe('Adult Unisex');
    expect(json.description).toBe('Standard sizing');
    expect(json.url).toBe('https://signed.example.com/mock');
    expect(uploadFile).toHaveBeenCalledTimes(1);

    const rows = await db.select().from(schema.sizeCharts);
    expect(rows).toHaveLength(1);
  });
});
