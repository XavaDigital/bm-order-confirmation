import { NextResponse } from 'next/server';
import { listOrdersForExport } from '@/server/orders/service';
import { csvCell, untrustedCsvCell, toCsv } from '@/lib/csv';
import { defineRoute } from '@/lib/route-handler';

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

export const GET = defineRoute({
  auth: 'viewer',
  tag: 'orders/export GET',
  handler: async ({ request }) => {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    const sortBy = searchParams.get('sortBy') ?? undefined;
    const sortDir = searchParams.get('sortDir') ?? undefined;

    const rows = await listOrdersForExport({ status, search, sortBy, sortDir });

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
  },
});
