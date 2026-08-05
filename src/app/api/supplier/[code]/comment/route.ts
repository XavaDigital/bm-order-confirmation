import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { portalCommentSchema } from '@/server/supplier-portal/contract';
import { addSupplierCommentByNumber } from '@/server/supplier-portal/service';
import { requireSupplier } from '../_shared';

/** A named supplier comment on one PO — lands in the shared order-notes stream. */
export const POST = defineRoute<{ code: string }, typeof portalCommentSchema._type>({
  auth: 'public',
  tag: 'supplier/comment POST',
  schema: portalCommentSchema,
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
      const note = await addSupplierCommentByNumber(
        { id: gate.supplier.id, name: gate.supplier.name },
        body.poNumber,
        body.body,
        gate.personName,
      );
      return NextResponse.json({ ok: true, id: note.id }, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'po_not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      throw err;
    }
  },
});
