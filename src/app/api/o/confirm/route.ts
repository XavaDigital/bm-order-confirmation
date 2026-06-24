import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmOrder, REQUIRED_ACK_KEYS } from '@/server/orders/customer-service';

const ackSchema = z.object({
  key: z.enum(REQUIRED_ACK_KEYS),
  text: z.string().min(1),
});

const bodySchema = z.object({
  token: z.string().min(1),
  acknowledgments: z.array(ackSchema).length(REQUIRED_ACK_KEYS.length),
  concerns: z.string().max(2000).nullable().optional(),
  shippingAddress: z.record(z.unknown()).nullable().optional(),
  signatureBase64: z.string().nullable().optional(),
  signatureType: z.enum(['drawn', 'uploaded', 'none']).default('none'),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null;
  const ua = request.headers.get('user-agent') ?? null;

  try {
    const result = await confirmOrder({
      rawToken: parsed.data.token,
      acks: parsed.data.acknowledgments,
      concerns: parsed.data.concerns ?? null,
      shippingAddress: parsed.data.shippingAddress ?? null,
      signatureBase64: parsed.data.signatureBase64 ?? null,
      signatureType: parsed.data.signatureType,
      ipAddress: ip,
      userAgent: ua,
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
    if (msg === 'already_confirmed') {
      return NextResponse.json(
        { error: 'Order already confirmed', code: 'already_confirmed' },
        { status: 409 },
      );
    }
    if (msg.startsWith('missing_ack:')) {
      return NextResponse.json({ error: 'Missing acknowledgment', code: msg }, { status: 400 });
    }

    console.error('[/api/o/confirm]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
