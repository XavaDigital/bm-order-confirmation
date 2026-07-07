import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { listOrdersForExport } from '@/server/orders/service';
import { csvCell, untrustedCsvCell, toCsv } from '@/lib/csv';

const HEADER = [
  'Order Number',
  'Customer Name',
  'Customer Email',
  'Club',
  'Status',
  'Value',
  'Currency',
  'Created At',
  'Confirmed At',
];

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') ?? undefined;
  const search = searchParams.get('search') ?? undefined;

  try {
    const rows = await listOrdersForExport({ status, search });

    const csv = toCsv([
      HEADER,
      ...rows.map((o) => [
        csvCell(o.orderNumber),
        untrustedCsvCell(o.customerName),
        untrustedCsvCell(o.customerEmail),
        untrustedCsvCell(o.clubName),
        csvCell(o.status),
        csvCell(o.orderValueAmount),
        csvCell(o.orderValueCurrency),
        csvCell(o.createdAt.toISOString()),
        csvCell(o.confirmedAt ? o.confirmedAt.toISOString() : null),
      ]),
    ]);

    const date = new Date().toISOString().slice(0, 10);

    // Leading BOM so Excel opens non-ASCII customer names as UTF-8 rather than mangling them.
    return new NextResponse(`﻿${csv}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[admin/orders/export GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
