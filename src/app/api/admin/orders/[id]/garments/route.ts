import { NextRequest, NextResponse } from 'next/server';
import { addGarment } from '@/server/orders/service';
import { addGarmentSchema } from '@/server/orders/admin-contract';
import { badRequest } from '@/lib/api-responses';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = addGarmentSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  try {
    const garment = await addGarment(orderId, parsed.data);
    return NextResponse.json(garment, { status: 201 });
  } catch (err) {
    logger.error('[admin/garments POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
