import { NextResponse } from 'next/server';
import { createShipment, listShipments } from '@/server/shipments/service';
import {
  createShipmentSchema,
  SHIPMENT_STATUSES,
  type ShipmentStatus,
} from '@/server/shipments/contract';
import { defineRoute } from '@/lib/route-handler';

// All staff can manage shipments — logistics is a day-to-day sales/production
// task, unlike the admin-only reference-data surfaces (suppliers, types).
export const GET = defineRoute({
  auth: 'viewer',
  tag: 'shipments GET',
  handler: async ({ request }) => {
    const sp = request.nextUrl.searchParams;
    const rawStatus = sp.get('status');
    // Unknown status values are ignored (no filter) rather than 400 — the
    // garment-types GET convention for loose query params.
    const status = SHIPMENT_STATUSES.includes(rawStatus as ShipmentStatus)
      ? (rawStatus as ShipmentStatus)
      : undefined;
    return NextResponse.json(
      await listShipments({
        status,
        supplierId: sp.get('supplierId') ?? undefined,
        search: sp.get('search') ?? undefined,
      }),
    );
  },
});

export const POST = defineRoute({
  auth: 'staff',
  tag: 'shipments POST',
  schema: createShipmentSchema,
  handler: async ({ body, session }) => {
    const shipment = await createShipment(body, {
      actorStaffUserId: session!.userId,
      actorEmail: session!.email,
    });
    return NextResponse.json(shipment, { status: 201 });
  },
});
