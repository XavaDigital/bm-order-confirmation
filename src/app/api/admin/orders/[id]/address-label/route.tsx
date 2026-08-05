import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { defineRoute } from '@/lib/route-handler';
import { AddressLabelPdf } from '@/components/admin/AddressLabelPdf';

// Same key order the order PDF renders — the label and the PDF must agree on
// what an address looks like.
const ADDRESS_KEYS = ['line1', 'line2', 'city', 'region', 'postcode', 'country'] as const;

/**
 * Print an address label from the order's shipping address (David,
 * 2026-08-05) — a one-per-page PDF at the physical label size; print at 100%
 * on the label media. 409 when the order has no address to print.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'orders/[id]/address-label GET',
  handler: async ({ params }) => {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, params.id),
      columns: {
        orderNumber: true,
        customerName: true,
        clubName: true,
        shippingAddress: true,
      },
    });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    const address = (order.shippingAddress ?? {}) as Record<string, string>;
    const toLines = ADDRESS_KEYS.map((k) => address[k]?.trim()).filter(
      (v): v is string => Boolean(v),
    );
    if (toLines.length === 0) {
      return NextResponse.json(
        { error: 'This order has no shipping address to print' },
        { status: 409 },
      );
    }
    if (order.clubName && order.clubName !== order.customerName) {
      toLines.unshift(order.clubName);
    }

    const buffer = await renderToBuffer(
      (
        <AddressLabelPdf
          toName={order.customerName}
          toLines={toLines}
          reference={order.orderNumber}
        />
      ) as Parameters<typeof renderToBuffer>[0],
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="address-label-${order.orderNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
