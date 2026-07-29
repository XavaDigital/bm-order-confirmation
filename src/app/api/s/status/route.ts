import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { updateSupplierPoStatusSchema } from '@/server/supplier-portal/contract';
import { updateSupplierPoStatus } from '@/server/supplier-portal/service';

export const POST = defineRoute<Record<string, never>, typeof updateSupplierPoStatusSchema._type>({
  auth: 'public',
  tag: 's/status POST',
  schema: updateSupplierPoStatusSchema,
  handler: async ({ request, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `supplier-portal:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    try {
      const result = await updateSupplierPoStatus(body.token, body.status);
      return NextResponse.json({ ok: true, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'invalid_token') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (msg === 'status_not_allowed' || msg === 'illegal_transition') {
        return NextResponse.json({ error: 'That status change is not allowed' }, { status: 409 });
      }
      throw err;
    }
  },
});
