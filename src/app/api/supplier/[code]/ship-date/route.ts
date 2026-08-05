import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { portalShipDateSchema } from '@/server/supplier-portal/contract';
import { updateSupplierPoShipDate } from '@/server/supplier-portal/service';
import { requireSupplier } from '../_shared';

/**
 * The supplier sets or moves their expected ship date (David, 2026-08-05).
 * Locked once the PO reaches SHIPPING — after that the date is history, not
 * a plan.
 */
export const POST = defineRoute<{ code: string }, typeof portalShipDateSchema._type>({
  auth: 'public',
  tag: 'supplier/ship-date POST',
  schema: portalShipDateSchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `supplier-portal:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;

    try {
      const result = await updateSupplierPoShipDate(
        { id: gate.supplier.id, name: gate.supplier.name },
        body.poNumber,
        body.expectedShipDate,
        gate.personName,
      );
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'po_not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (msg === 'locked_after_shipping') {
        return NextResponse.json(
          { error: 'This purchase order has shipped — the ship date can no longer be changed.' },
          { status: 409 },
        );
      }
      throw err;
    }
  },
});
