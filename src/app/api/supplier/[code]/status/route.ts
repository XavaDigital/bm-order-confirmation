import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { portalUpdateStatusSchema } from '@/server/supplier-portal/contract';
import { updateSupplierPoStatusByNumber } from '@/server/supplier-portal/service';
import { requireSupplier } from '../_shared';

/**
 * Row-action AND bulk status change (David, 2026-08-05: single line or
 * multi-select from the table). Per-PO results, not all-or-nothing: in a bulk
 * move each PO is validated against its own current status, and one illegal
 * transition must not block nineteen legal ones. The response lists each
 * outcome so the table can report precisely.
 */
export const POST = defineRoute<{ code: string }, typeof portalUpdateStatusSchema._type>({
  auth: 'public',
  tag: 'supplier/status POST',
  schema: portalUpdateStatusSchema,
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

    const results = [];
    for (const poNumber of body.poNumbers) {
      try {
        const r = await updateSupplierPoStatusByNumber(
          { id: gate.supplier.id, name: gate.supplier.name },
          poNumber,
          body.status,
          gate.personName,
        );
        results.push({ poNumber, ok: true as const, status: r.status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'error';
        results.push({
          poNumber,
          ok: false as const,
          error:
            msg === 'po_not_found'
              ? 'Not found'
              : msg === 'status_not_allowed' || msg === 'illegal_transition'
                ? 'That status change is not allowed'
                : 'Update failed',
        });
      }
    }
    return NextResponse.json({ results });
  },
});
