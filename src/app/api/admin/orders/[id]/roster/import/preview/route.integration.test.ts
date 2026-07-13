import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { MAX_IMPORT_FILE_BYTES } from '@/server/roster/import';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function postRequest(orderId: string, formData: FormData) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/roster/import/preview`, {
    method: 'POST',
    body: formData,
  });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/roster/import/preview', () => {
  it('returns 404 for an unknown order', async () => {
    const fd = new FormData();
    fd.append('file', new File(['Name\nAlex'], 'roster.csv', { type: 'text/csv' }));

    const res = await POST(postRequest(UNKNOWN_ID, fd), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 400 when no file is provided', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(created.orderId, new FormData()), {
      params: Promise.resolve({ id: created.orderId }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file exceeds the size cap', async () => {
    const created = await createOrder(minimalOrderInput());
    const oversized = new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], 'roster.csv', { type: 'text/csv' });
    const fd = new FormData();
    fd.append('file', oversized);

    const res = await POST(postRequest(created.orderId, fd), {
      params: Promise.resolve({ id: created.orderId }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unsupported file type', async () => {
    const created = await createOrder(minimalOrderInput());
    const fd = new FormData();
    fd.append('file', new File(['whatever'], 'roster.xls', { type: 'application/vnd.ms-excel' }));

    const res = await POST(postRequest(created.orderId, fd), {
      params: Promise.resolve({ id: created.orderId }),
    });
    expect(res.status).toBe(400);
  });

  it('returns headers, a preview, total row count, and a guessed mapping for a valid CSV', async () => {
    const created = await createOrder(minimalOrderInput());
    const csv = 'Player Name,Jersey #,Email\nAlex,7,alex@example.com\nSam,9,sam@example.com\n';
    const fd = new FormData();
    fd.append('file', new File([csv], 'roster.csv', { type: 'text/csv' }));

    const res = await POST(postRequest(created.orderId, fd), {
      params: Promise.resolve({ id: created.orderId }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.headers).toEqual(['Player Name', 'Jersey #', 'Email']);
    expect(json.totalRows).toBe(2);
    expect(json.previewRows).toEqual([
      ['Alex', '7', 'alex@example.com'],
      ['Sam', '9', 'sam@example.com'],
    ]);
    expect(json.guessedMapping).toEqual({ nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 });
  });
});
