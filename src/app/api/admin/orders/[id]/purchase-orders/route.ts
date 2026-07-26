import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getOrderProductionSummary } from '@/server/purchase-orders/service';

// The order-detail Production panel: sizing-row coverage + every PO of the
// order with its latest snapshot and live variance.
export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders [id]/purchase-orders GET',
  handler: async ({ params }) => NextResponse.json(await getOrderProductionSummary(params.id)),
});
