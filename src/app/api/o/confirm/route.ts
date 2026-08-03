import { NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmOrder } from '@/server/orders/customer-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { ACCESS_CODE_COOKIE } from '@/lib/access-code';
import { defineRoute } from '@/lib/route-handler';

// The required SET is dynamic (admin-editable acknowledgement_settings) —
// confirmOrder validates every ACTIVE key is present and re-derives the
// authoritative wording from the table; the client text is not trusted.
const ackSchema = z.object({
  key: z.string().min(1).max(120),
  text: z.string().min(1),
});

const bodySchema = z.object({
  token: z.string().min(1),
  acknowledgments: z.array(ackSchema).max(50),
  concerns: z.string().max(2000).nullable().optional(),
  shippingAddress: z.record(z.unknown()).nullable().optional(),
  /** Explicit customer choice to confirm the delivery address later. */
  shippingAddressDeferred: z.boolean().optional().default(false),
  signatureBase64: z.string().nullable().optional(),
  signatureType: z.enum(['drawn', 'uploaded', 'none']).default('none'),
});

export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'public',
  tag: 'o/confirm POST',
  schema: bodySchema,
  handler: async ({ request, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `confirm:${ip}`,
      RATE_LIMITS.customerWrite, 'Too many requests. Please try again later.');
    if (rateLimited) return rateLimited;

    const ua = request.headers.get('user-agent') ?? null;

    try {
      const result = await confirmOrder({
        rawToken: body.token,
        acks: body.acknowledgments,
        concerns: body.concerns ?? null,
        shippingAddress: body.shippingAddress ?? null,
        shippingAddressDeferred: body.shippingAddressDeferred,
        signatureBase64: body.signatureBase64 ?? null,
        signatureType: body.signatureType,
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: ua,
        codeCookie: request.cookies.get(ACCESS_CODE_COOKIE)?.value ?? null,
      });

      return NextResponse.json({
        success: true,
        orderNumber: result.orderNumber,
        confirmedAt: result.confirmedAt.toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';

      if (msg === 'invalid_token') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (msg === 'code_required') {
        return NextResponse.json(
          { error: 'Access code verification expired. Please reload the page and re-enter your access code.', code: 'code_required' },
          { status: 403 },
        );
      }
      if (msg === 'already_confirmed') {
        return NextResponse.json(
          { error: 'Order already confirmed', code: 'already_confirmed' },
          { status: 409 },
        );
      }
      if (msg.startsWith('missing_ack:')) {
        return NextResponse.json({ error: 'Missing acknowledgment', code: msg }, { status: 400 });
      }
      if (msg === 'address_required') {
        return NextResponse.json(
          {
            error: 'Please complete the delivery address, or tick "I’ll confirm the delivery address later".',
            code: 'address_required',
          },
          { status: 400 },
        );
      }

      throw err;
    }
  },
});
