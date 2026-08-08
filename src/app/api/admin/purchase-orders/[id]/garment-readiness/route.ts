import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { evaluatePoGarmentReadiness } from '@/server/purchase-orders/garment-readiness';

/**
 * Which garments on this purchase order are still missing something, and what
 * (David, 2026-08-08).
 *
 * The same evaluation that satisfies the PO-wide checklist lines, so the
 * checklist and the garment boxes can never disagree. Read-only, so `viewer`:
 * a viewer who cannot see why a purchase order is blocked cannot answer the
 * question everyone asks them about it.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'purchase-orders/[id]/garment-readiness GET',
  handler: async ({ params }) =>
    NextResponse.json(await evaluatePoGarmentReadiness(params.id)),
});
