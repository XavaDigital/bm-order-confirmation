import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getOrderAdmin } from '@/server/orders/service';
import { toGarmentDto } from '@/server/orders/mappers';
import { OrderPdf } from '@/components/admin/orders/OrderPdf';
import { notFound } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'orders/[id]/pdf GET',
  handler: async ({ params }) => {
    const order = await getOrderAdmin(params.id);
    if (!order) return notFound();

    const pdfProps = {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerContact: order.customerContact ?? null,
      clubName: order.clubName ?? null,
      orderValueAmount: order.orderValueAmount ?? null,
      orderValueCurrency: order.orderValueCurrency ?? null,
      expectedShipDate: order.expectedShipDate ?? null,
      deadlineDate: order.deadlineDate ?? null,
      generalNotes: order.generalNotes ?? null,
      confirmedAt: order.confirmedAt ? order.confirmedAt.toISOString() : null,
      garments: order.garments.map((g) => toGarmentDto(g)),
    };

    const buffer = await renderToBuffer(<OrderPdf {...pdfProps} /> as Parameters<typeof renderToBuffer>[0]);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${order.orderNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
