import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { buildSupplierSessionCookie } from '@/lib/supplier-session';
import { supplierLoginSchema } from '@/server/supplier-portal/contract';
import {
  getSupplierByPortalCode,
  supplierPasswordMatches,
} from '@/server/supplier-portal/service';

/**
 * Supplier portal login (David, 2026-08-05): the supplier's shared password +
 * the person's self-asserted name → long-lived signed cookie. This is the
 * password brute-force surface, so it takes the customer-write rate limit.
 * Wrong code and wrong password answer identically — the gate must not
 * confirm which supplier codes exist.
 */
export const POST = defineRoute<{ code: string }, typeof supplierLoginSchema._type>({
  auth: 'public',
  tag: 'supplier/login POST',
  schema: supplierLoginSchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `supplier-login:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many attempts. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    const supplier = await getSupplierByPortalCode(params.code);
    if (!supplier || !supplierPasswordMatches(supplier, body.password)) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 403 });
    }

    const cookie = buildSupplierSessionCookie({ supplier, name: body.name });
    const res = NextResponse.json({ ok: true, supplierName: supplier.name, name: body.name });
    res.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: cookie.maxAgeSeconds,
      path: '/',
    });
    return res;
  },
});
