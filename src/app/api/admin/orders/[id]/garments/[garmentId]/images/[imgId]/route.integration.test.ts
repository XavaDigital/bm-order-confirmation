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
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, addMockupImage } from '@/server/orders/service';
import { deleteFile } from '@/lib/storage';
import { DELETE } from './route';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(deleteFile).mockClear();
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
