import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getConfirmedOrderForPdf } from '@/server/orders/customer-service';
import { toGarmentDto } from '@/server/orders/mappers';
import { OrderPdf } from '@/components/admin/orders/OrderPdf';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { ACCESS_CODE_COOKIE } from '@/lib/access-code';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ token: string }>({
  auth: 'public',
  tag: 'o/[token]/pdf GET',
  handler: async ({ request, params }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `o-pdf:${ip}`,
      RATE_LIMITS.customerPdf,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    let order;
    try {
      order = await getConfirmedOrderForPdf(
        params.token,
        request.cookies.get(ACCESS_CODE_COOKIE)?.value ?? null,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';

      if (msg === 'invalid_token') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (msg === 'code_required') {
        return NextResponse.json(
          { error: 'Access code verification expired. Please reload the page and re-enter your access code.', code: 'code_required' },
          { status: 403 },
        );
      }

      throw err;
    }

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
