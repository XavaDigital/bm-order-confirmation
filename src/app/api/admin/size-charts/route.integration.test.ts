import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
  return {
    getSession: vi.fn(async () => session),
    requireAdmin: vi.fn(async () => {
      if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { uploadFile, getSignedUrl, StorageUnavailableError } from '@/lib/storage';
import { getSession } from '@/lib/session';
import { GET, POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(uploadFile).mockReset().mockResolvedValue('mock-storage-key');
  vi.mocked(getSignedUrl).mockClear();
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession(role: 'sales' | 'admin') {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.email = 'staff@example.com';
  session.name = 'Staff One';
  session.role = role;
}

function multipartRequest(fields: { name?: string; description?: string; file?: File; sizes?: string }) {
  const formData = new FormData();
  if (fields.name !== undefined) formData.set('name', fields.name);
  if (fields.description !== undefined) formData.set('description', fields.description);
  if (fields.sizes !== undefined) formData.set('sizes', fields.sizes);
  if (fields.file) formData.set('file', fields.file);
  return new NextRequest('http://localhost/api/admin/size-charts', { method: 'POST', body: formData });
}

function getRequest() {
  return new NextRequest('http://localhost/api/admin/size-charts', { method: 'GET' });
}

describe('GET /api/admin/size-charts', () => {
  it('returns 401 when there is no session', async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it('returns an empty array when there are none', async () => {
    await setSession('sales');
    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([]);
  });

  it('returns charts ordered by name with a signed url', async () => {
    await setSession('sales');
    await db.insert(schema.sizeCharts).values([
      { name: 'Zebra Chart', storageKey: 'size-charts/z.pdf' },
      { name: 'Alpha Chart', storageKey: 'size-charts/a.pdf' },
    ]);

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.map((c: { name: string }) => c.name)).toEqual(['Alpha Chart', 'Zebra Chart']);
    expect(json[0].url).toBe('https://signed.example.com/mock');
  });
});

describe('POST /api/admin/size-charts', () => {
  it('returns 401 when there is no session', async () => {
    const file = new File(['abc'], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest({ name: 'Adult Unisex', file }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a sales-role session', async () => {
    await setSession('sales');
    const file = new File(['abc'], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest({ name: 'Adult Unisex', file }));
    expect(res.status).toBe(403);
  });

  it('returns 400 when the body is not multipart/form-data', async () => {
    await setSession('admin');
    const req = new NextRequest('http://localhost/api/admin/size-charts', {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is missing', async () => {
    await setSession('admin');
    const file = new File(['abc'], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest({ file }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file field is missing', async () => {
    await setSession('admin');
    const res = await POST(multipartRequest({ name: 'Adult Unisex' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Missing "file"/);
  });

  it('returns 400 for a disallowed content type', async () => {
    await setSession('admin');
    const file = new File(['abc'], 'chart.txt', { type: 'text/plain' });
    const res = await POST(multipartRequest({ name: 'Adult Unisex', file }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file exceeds the 20 MB limit', async () => {
    await setSession('admin');
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    const file = new File([big], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest({ name: 'Adult Unisex', file }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/20 MB/);
  });

  it('returns 201 with the created chart and persists it', async () => {
    await setSession('admin');
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

  it('persists a structured size list sent as a JSON form field', async () => {
    await setSession('admin');
    const file = new File(['abc'], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(
      multipartRequest({
        name: 'Adult Unisex',
        file,
        sizes: JSON.stringify([{ label: 'M' }, { label: 'L', tall: true }]),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.sizes).toEqual([
      { label: 'M', tall: false },
      { label: 'L', tall: true },
    ]);
  });

  it('returns 400 for a malformed sizes form field', async () => {
    await setSession('admin');
    const file = new File(['abc'], 'chart.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest({ name: 'Adult Unisex', file, sizes: '{nope' }));
    expect(res.status).toBe(400);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/size-charts — storage failures', () => {
  function pngFile() {
    return new File([Buffer.from('fake-png')], 'chart.png', { type: 'image/png' });
  }

  // Regression: a rejected AWS key used to surface as an opaque 500
  // {error: 'Upload failed'}, which made a pure config problem undiagnosable
  // from the browser. It must now be a 503 carrying the actionable message.
  it('returns 503 with the actionable message when storage credentials are rejected', async () => {
    await setSession('admin');
    vi.mocked(uploadFile).mockRejectedValueOnce(
      new StorageUnavailableError(
        'File storage rejected the configured access key (it does not exist). Check AWS_S3_ACCESS_KEY.',
      ),
    );

    const res = await POST(multipartRequest({ name: 'Hoodie Chart', file: pngFile() }));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toContain('rejected the configured access key');
    expect(json.error).toContain('AWS_S3_ACCESS_KEY');

    // Nothing persisted — the row is only written after a successful upload.
    const charts = await db.select().from(schema.sizeCharts);
    expect(charts).toHaveLength(0);
  });

  it('still returns a generic 500 for an unexpected upload failure', async () => {
    await setSession('admin');
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('socket hang up'));

    const res = await POST(multipartRequest({ name: 'Hoodie Chart', file: pngFile() }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Upload failed');
  });
});
