import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requestOrderChanges } from '@/server/orders/customer-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { ACCESS_CODE_COOKIE } from '@/lib/access-code';
import { defineRoute } from '@/lib/route-handler';

const bodySchema = z.object({
  token: z.string().min(1),
  comment: z.string().min(1).max(2000),
});

export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'public',
  tag: 'o/request-changes POST',
  schema: bodySchema,
  handler: async ({ request, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `request-changes:${ip}`,
      RATE_LIMITS.customerWrite, 'Too many requests. Please try again later.');
    if (rateLimited) return rateLimited;

    try {
      const result = await requestOrderChanges({
        rawToken: body.token,
        comment: body.comment,
        codeCookie: request.cookies.get(ACCESS_CODE_COOKIE)?.value ?? null,
      });

      return NextResponse.json({ ok: true, orderNumber: result.orderNumber });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'invalid_token') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (msg === 'code_required') {
        return NextResponse.json(
          { error: 'Access code verification expired. Please reload the page and re-enter your access code.', code: 'code_required' },
          { status: 403 },
        );
      }
      if (msg === 'already_confirmed') {
        return NextResponse.json({ error: 'Order already confirmed', code: 'already_confirmed' }, { status: 409 });
      }
      throw err;
    }
  },
});
