import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  setOrderAccessCode,
  clearOrderAccessCode,
  getOrderAccessCode,
} from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

/**
 * The per-order access code on the active customer link.
 *
 * Staff-READABLE by design (David, 2026-08-03): the stored code can be viewed
 * any time rather than regenerate-to-see, and it may be a staff-chosen string
 * as well as a generated 6-digit number. Verification still compares against
 * the bcrypt hash on the access row.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/access-code GET',
  handler: async ({ params }) => NextResponse.json(await getOrderAccessCode(params.id)),
});

const setSchema = z.object({
  /**
   * Optional staff-chosen code — 4-64 visible chars, no leading/trailing
   * whitespace. Omitted = generate a 6-digit code.
   */
  code: z
    .string()
    .trim()
    .min(4, 'Use at least 4 characters')
    .max(64)
    .regex(/^\S(.*\S)?$/, 'No leading or trailing spaces')
    .optional(),
});

/** Enable, rotate, or set the code. The response echoes the stored code. */
export const POST = defineRoute<{ id: string }, typeof setSchema._type>({
  auth: 'staff',
  tag: 'orders/[id]/access-code POST',
  schema: setSchema,
  handler: async ({ params, body, session }) => {
    const result = await setOrderAccessCode(params.id, { actorEmail: session!.email }, body.code);
    return NextResponse.json(result, { status: 201 });
  },
});

/** Remove the access code — the link alone opens the order again. */
export const DELETE = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/access-code DELETE',
  handler: async ({ params, session }) => {
    await clearOrderAccessCode(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
