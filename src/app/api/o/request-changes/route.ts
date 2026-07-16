import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestOrderChanges } from '@/server/orders/customer-service';
import { getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { ACCESS_CODE_COOKIE } from '@/lib/access-code';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  token: z.string().min(1),
  comment: z.string().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateLimited = await rateLimitedResponse(`request-changes:${ip}`, 10, 15 * 60 * 1_000, 'Too many requests. Please try again later.');
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const result = await requestOrderChanges({
      rawToken: parsed.data.token,
      comment: parsed.data.comment,
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
    logger.error('[/api/o/request-changes]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
