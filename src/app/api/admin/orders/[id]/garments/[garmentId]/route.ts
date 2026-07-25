import { NextResponse } from 'next/server';
import { updateGarment, deleteGarment, updateGarmentSizeChartLinks } from '@/server/orders/service';
import { updateGarmentSchema } from '@/server/orders/admin-contract';
import { defineRoute } from '@/lib/route-handler';

type Params = { id: string; garmentId: string };

export const PATCH = defineRoute<Params, typeof updateGarmentSchema._type>({
  auth: 'staff',
  tag: 'admin/garments PATCH',
  schema: updateGarmentSchema,
  handler: async ({ params, body, session }) => {
    const { sizeChartIds, ...garmentPatch } = body;
    await updateGarment(params.garmentId, garmentPatch, { actorEmail: session!.email });
    if (sizeChartIds !== undefined) {
      await updateGarmentSizeChartLinks(params.garmentId, sizeChartIds, { actorEmail: session!.email });
    }
    return NextResponse.json({ ok: true });
  },
});

export const DELETE = defineRoute<Params>({
  auth: 'staff',
  tag: 'admin/garments DELETE',
  handler: async ({ params, session }) => {
    await deleteGarment(params.garmentId, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
