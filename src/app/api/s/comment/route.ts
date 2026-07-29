import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { addSupplierCommentSchema } from '@/server/supplier-portal/contract';
import { addSupplierComment } from '@/server/supplier-portal/service';

export const POST = defineRoute<Record<string, never>, typeof addSupplierCommentSchema._type>({
  auth: 'public',
  tag: 's/comment POST',
  schema: addSupplierCommentSchema,
  handler: async ({ request, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `supplier-portal:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    try {
      const note = await addSupplierComment(body.token, body.body);
      return NextResponse.json({ ok: true, id: note.id }, { status: 201 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'invalid_token') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      throw err;
    }
  },
});
