import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
    deleteFile: vi.fn().mockResolvedValue(undefined),
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
import { getSession } from '@/lib/session';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, addMockupImage } from '@/server/orders/service';
import { deleteFile } from '@/lib/storage';
import { DELETE } from './route';

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
});

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(deleteFile).mockClear();
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

async function seedOrderWithImage() {
  const created = await createOrder(minimalOrderInput());
  const garment = await db.query.garments.findFirst({ where: eq(schema.garments.orderId, created.orderId) });
  const image = await addMockupImage(garment!.id, { storageKey: 'mockups/x/y/z.png' });
  return { orderId: created.orderId, garmentId: garment!.id, imgId: image.id };
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/garments/y/images/z', { method: 'DELETE' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('DELETE /api/admin/orders/[id]/garments/[garmentId]/images/[imgId]', () => {
  it('returns 404 for an unknown image id', async () => {
    const { orderId, garmentId } = await seedOrderWithImage();

    const res = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: orderId, garmentId, imgId: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('returns 200 { ok: true }, removes the row, and best-effort deletes storage', async () => {
    const { orderId, garmentId, imgId } = await seedOrderWithImage();

    const res = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: orderId, garmentId, imgId }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const row = await db.query.mockupImages.findFirst({ where: eq(schema.mockupImages.id, imgId) });
    expect(row).toBeUndefined();

    await vi.waitFor(() => expect(deleteFile).toHaveBeenCalledWith('mockups/x/y/z.png'));
  });

  it('does not fail the request when the storage delete rejects', async () => {
    vi.mocked(deleteFile).mockRejectedValueOnce(new Error('storage unreachable'));
    const { orderId, garmentId, imgId } = await seedOrderWithImage();

    const res = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: orderId, garmentId, imgId }),
    });

    expect(res.status).toBe(200);
  });
});
