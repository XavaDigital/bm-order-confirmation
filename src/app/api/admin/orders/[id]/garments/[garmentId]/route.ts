import { NextRequest, NextResponse } from 'next/server';
import { updateGarment, deleteGarment, NotFoundError } from '@/server/orders/service';
import { updateGarmentSchema } from '@/server/orders/admin-contract';

type Params = { params: Promise<{ id: string; garmentId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { garmentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateGarmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await updateGarment(garmentId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/garments PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { garmentId } = await params;
  try {
    await deleteGarment(garmentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/garments DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
