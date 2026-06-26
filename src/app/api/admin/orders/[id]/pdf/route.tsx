import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { renderToBuffer } from '@react-pdf/renderer';
import { getOrderAdmin } from '@/server/orders/service';
import { OrderPdf } from '@/components/admin/orders/OrderPdf';
import { sessionOptions, type SessionData } from '@/lib/session';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const order = await getOrderAdmin(id);
  if (!order) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
    garments: order.garments.map((g) => ({
      name: g.name,
      fabrics: (g.fabrics as string[]) ?? [],
      notes: g.notes ?? null,
      sizing: g.sizing.map((s) => ({
        size: s.size ?? null,
        playerName: s.playerName ?? null,
        playerNumber: s.playerNumber ?? null,
        notes: s.notes ?? null,
      })),
    })),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(<OrderPdf {...pdfProps} /> as any);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${order.orderNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
