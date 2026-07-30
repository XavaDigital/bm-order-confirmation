import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    uploadFile: vi.fn().mockResolvedValue(undefined),
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
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { uploadFile, isStorageConfigured } from '@/lib/storage';
import { POST } from './route';

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
  session.email = 'staff@x.com';
});

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(uploadFile).mockClear();
  vi.mocked(isStorageConfigured).mockReturnValue(true);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey' }],
    }),
  );
  return created.orderId;
}

function fontFile(name = 'SquadNumbers.otf', type = 'application/octet-stream') {
  return new File([Buffer.from('OTTO-fake-font-bytes')], name, { type });
}

function uploadRequest(file?: File) {
  const formData = new FormData();
  if (file) formData.set('file', file);
  return new NextRequest('http://localhost/api/admin/orders/x/assets/upload', {
    method: 'POST',
    body: formData,
  });
}

function withId(orderId: string) {
  return { params: Promise.resolve({ id: orderId }) };
}

describe('POST /api/admin/orders/[id]/assets/upload', () => {
  it('uploads a font and returns the storage key and original filename', async () => {
    const orderId = await seedOrder();

    const res = await POST(uploadRequest(fontFile()), withId(orderId));
    const json = await res.json();

    expect(res.status).toBe(201);
    // Namespaced under the order, random filename, original extension kept.
    expect(json.storageKey).toMatch(new RegExp(`^assets/${orderId}/[0-9a-f]{16}\\.otf$`));
    // The original name rides along so the UI can prefill the asset name.
    expect(json.filename).toBe('SquadNumbers.otf');
    expect(uploadFile).toHaveBeenCalledWith(
      json.storageKey,
      expect.any(Buffer),
      'application/octet-stream',
    );
  });

  /**
   * The reason validation is by extension: a browser that reports a real font
   * MIME type and one that reports octet-stream must both work.
   */
  it('accepts a font regardless of the MIME type the browser chose', async () => {
    const orderId = await seedOrder();

    const asFont = await POST(uploadRequest(fontFile('a.woff2', 'font/woff2')), withId(orderId));
    const asOctet = await POST(
      uploadRequest(fontFile('b.woff2', 'application/octet-stream')),
      withId(orderId),
    );

    expect(asFont.status).toBe(201);
    expect(asOctet.status).toBe(201);
  });

  it('rejects an extension outside the allowlist', async () => {
    const orderId = await seedOrder();

    const res = await POST(uploadRequest(fontFile('malware.exe')), withId(orderId));

    expect(res.status).toBe(400);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('404s an unknown order without touching storage', async () => {
    const res = await POST(
      uploadRequest(fontFile()),
      withId('11111111-1111-4111-8111-111111111111'),
    );

    expect(res.status).toBe(404);
    // The guard runs BEFORE the upload — a bad order id must not orphan bytes
    // under a key nothing will ever reference.
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('503s with a clear message when storage is not configured', async () => {
    vi.mocked(isStorageConfigured).mockReturnValue(false);
    const orderId = await seedOrder();

    const res = await POST(uploadRequest(fontFile()), withId(orderId));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/not configured/i);
  });

  it('400s when the file field is missing', async () => {
    const orderId = await seedOrder();

    const res = await POST(uploadRequest(), withId(orderId));

    expect(res.status).toBe(400);
  });
});
