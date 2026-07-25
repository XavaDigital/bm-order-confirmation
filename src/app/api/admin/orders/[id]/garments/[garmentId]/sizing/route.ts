import { NextResponse } from 'next/server';
import { upsertSizingRows } from '@/server/orders/service';
import { upsertSizingSchema } from '@/server/orders/admin-contract';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string; garmentId: string }, typeof upsertSizingSchema._type>({
  auth: 'staff',
  tag: 'admin/sizing POST',
  schema: upsertSizingSchema,
  handler: async ({ params, body, session }) => {
    await upsertSizingRows(params.garmentId, body, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
