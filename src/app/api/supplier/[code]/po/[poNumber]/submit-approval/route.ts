import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/route-handler';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { submitForApproval } from '@/server/supplier-portal/service';
import { requireSupplier } from '../../../_shared';

const bodySchema = z.object({
  /** What they are submitting — optional, shown beside the badge on our side. */
  note: z.string().trim().max(500).optional(),
});

/**
 * "This phase is done — please approve it" (David, 2026-08-06). Raises the
 * awaiting-approval flag; the status stays where it is, because what changed
 * is whose court the ball is in.
 */
export const POST = defineRoute<{ code: string; poNumber: string }, typeof bodySchema._type>({
  auth: 'public',
  tag: 'supplier/po/submit-approval POST',
  schema: bodySchema,
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
      const result = await submitForApproval(
        { id: gate.supplier.id, name: gate.supplier.name },
        params.poNumber,
        gate.personName,
        body.note ?? null,
      );
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'po_not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (msg === 'locked_after_shipping') {
        return NextResponse.json(
          { error: 'This purchase order is finished — there is nothing left to approve.' },
          { status: 409 },
        );
      }
      throw err;
    }
  },
});
