import { NextResponse } from 'next/server';
import { setShipmentStatus } from '@/server/shipments/service';
import { updateShipmentStatusSchema } from '@/server/shipments/contract';
import { defineRoute } from '@/lib/route-handler';

// Illegal transitions surface as 409 via the ConflictError mapping.
export const POST = defineRoute<{ id: string }, typeof updateShipmentStatusSchema._type>({
  auth: 'staff',
  tag: 'shipments/[id]/status POST',
  schema: updateShipmentStatusSchema,
  handler: async ({ params, body, session }) =>
    NextResponse.json(
      await setShipmentStatus(params.id, body.status, {
        actorStaffUserId: session!.userId,
        actorEmail: session!.email,
      }),
    ),
});
