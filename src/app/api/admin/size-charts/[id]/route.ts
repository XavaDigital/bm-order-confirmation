import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updateSizeChart, deleteSizeChart, SizeChartNotFoundError } from '@/server/size-charts/service';

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const chart = await updateSizeChart(id, parsed.data);
    return NextResponse.json(chart);
  } catch (err) {
    if (err instanceof SizeChartNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[size-charts PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const result = await deleteSizeChart(id);
    return NextResponse.json({ ok: true, linkedGarmentCount: result.linkedGarmentCount });
  } catch (err) {
    if (err instanceof SizeChartNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[size-charts DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
