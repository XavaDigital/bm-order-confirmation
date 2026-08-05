import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';
import { addPoFileComment } from '@/server/purchase-orders/files-service';
import { requireSupplier } from '../../../../_shared';
import { loadSentPoForExport } from '../../_export';

const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

/** Supplier comment on one production file's thread, attributed to the named person. */
export const POST = defineRoute<
  { code: string; poNumber: string; fileId: string },
  typeof commentSchema._type
>({
  auth: 'public',
  tag: 'supplier/po/files/[fileId] POST',
  schema: commentSchema,
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
    const po = await loadSentPoForExport(gate.supplier.id, params.poNumber);
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const note = await addPoFileComment(po.id, params.fileId, body.body, {
      authorKind: 'supplier',
      authorLabel: `${gate.personName} (${gate.supplier.name})`,
    });
    return NextResponse.json({ ok: true, id: note.id }, { status: 201 });
  },
});
