import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
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

import ExcelJS from 'exceljs';
import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createPurchaseOrder, issueRevision } from '@/server/purchase-orders/service';
import { upsertSizingRows } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { GET } from './route';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession() {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.email = 'staff@example.com';
}

async function seedPo() {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: 'Vast Apparel', supplierCode: 'VA', email: 'factory@example.com' })
    .returning();
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [
        { name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice' }, { size: 'L' }] },
      ],
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
  return { po, orderId: created.orderId, garmentId: garment.id };
}

function getRequest(id: string, query = '') {
  return new NextRequest(`http://localhost/api/admin/purchase-orders/${id}/xlsx${query}`);
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

async function readWorkbook(res: Response) {
  const buffer = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}

describe('GET /api/admin/purchase-orders/[id]/xlsx', () => {
  it('returns 401 when there is no session', async () => {
    const { po } = await seedPo();

    const res = await GET(getRequest(po.id), withId(po.id));

    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown purchase order id', async () => {
    await setSession();

    const res = await GET(getRequest(UNKNOWN_ID), withId(UNKNOWN_ID));

    expect(res.status).toBe(404);
  });

  it('returns a workbook with the xlsx content type and PO-number filename', async () => {
    await setSession();
    const { po } = await seedPo();

    const res = await GET(getRequest(po.id), withId(po.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(XLSX_CONTENT_TYPE);
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${po.poNumber}.xlsx"`,
    );

    const wb = await readWorkbook(res);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Purchase Order', 'Lines']);
    // header + the 2 seeded sizing lines
    expect(wb.getWorksheet('Lines')!.rowCount).toBe(3);
  });

  it('defaults to the latest revision and suffixes the filename', async () => {
    await setSession();
    const { po, garmentId } = await seedPo();

    // Change the order, then amend the PO so revision 2 has different lines.
    await upsertSizingRows(garmentId, [{ size: 'XL', playerName: 'Bob' }]);
    await issueRevision(po.id, { reason: 'Sizes changed after review' });

    const res = await GET(getRequest(po.id), withId(po.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${po.poNumber}-rev2.xlsx"`,
    );

    const wb = await readWorkbook(res);
    const sheet = wb.getWorksheet('Purchase Order')!;
    expect(String(sheet.getCell('A1').value)).toContain('REVISION 2');
    // Revision 2 snapshotted the single replacement row.
    expect(wb.getWorksheet('Lines')!.rowCount).toBe(2);
  });

  it('renders a specific historical revision with ?rev', async () => {
    await setSession();
    const { po, garmentId } = await seedPo();
    await upsertSizingRows(garmentId, [{ size: 'XL', playerName: 'Bob' }]);
    await issueRevision(po.id, { reason: 'Sizes changed after review' });

    const res = await GET(getRequest(po.id, '?rev=1'), withId(po.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${po.poNumber}.xlsx"`,
    );

    // Revision 1 still shows the ORIGINAL two lines — snapshots are immutable.
    const wb = await readWorkbook(res);
    expect(wb.getWorksheet('Lines')!.rowCount).toBe(3);
  });

  it('returns 404 for a revision that does not exist or is malformed', async () => {
    await setSession();
    const { po } = await seedPo();

    expect((await GET(getRequest(po.id, '?rev=99'), withId(po.id))).status).toBe(404);
    expect((await GET(getRequest(po.id, '?rev=abc'), withId(po.id))).status).toBe(404);
  });
});
