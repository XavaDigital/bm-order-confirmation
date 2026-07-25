import { NextResponse } from 'next/server';
import { addGarment } from '@/server/orders/service';
import { addGarmentSchema } from '@/server/orders/admin-contract';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string }, typeof addGarmentSchema._type>({
  auth: 'staff',
  tag: 'admin/garments POST',
  schema: addGarmentSchema,
  handler: async ({ params, body, session }) => {
    const garment = await addGarment(params.id, body, { actorEmail: session!.email });
    return NextResponse.json(garment, { status: 201 });
  },
});
