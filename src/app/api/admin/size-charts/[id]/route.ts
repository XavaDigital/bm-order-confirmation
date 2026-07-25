import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateSizeChart, deleteSizeChart } from '@/server/size-charts/service';
import { sizeChartSizesSchema } from '@/server/size-charts/contract';
import { defineRoute } from '@/lib/route-handler';

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  sizes: sizeChartSizesSchema.optional(),
});

export const PATCH = defineRoute<{ id: string }, typeof patchSchema._type>({
  auth: 'admin',
  tag: 'size-charts PATCH',
  schema: patchSchema,
  handler: async ({ params, body }) =>
    NextResponse.json(await updateSizeChart(params.id, body)),
});

export const DELETE = defineRoute<{ id: string }>({
  auth: 'admin',
  tag: 'size-charts DELETE',
  handler: async ({ params }) => {
    const result = await deleteSizeChart(params.id);
    return NextResponse.json({ ok: true, linkedGarmentCount: result.linkedGarmentCount });
  },
});
