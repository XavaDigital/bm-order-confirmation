import { NextResponse } from 'next/server';
import { getShipment, updateShipment } from '@/server/shipments/service';
import { updateShipmentSchema } from '@/server/shipments/contract';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'shipments/[id] GET',
  handler: async ({ params }) => NextResponse.json(await getShipment(params.id)),
});

// Fields only — status changes go through POST [id]/status, PO membership
// through POST/DELETE [id]/purchase-orders.
export const PATCH = defineRoute<{ id: string }, typeof updateShipmentSchema._type>({
  auth: 'staff',
  tag: 'shipments/[id] PATCH',
  schema: updateShipmentSchema,
  handler: async ({ params, body, session }) =>
    NextResponse.json(
      await updateShipment(params.id, body, {
        actorStaffUserId: session!.userId,
        actorEmail: session!.email,
      }),
    ),
});
