import { NextResponse } from 'next/server';
import { z } from 'zod';
import { removeGuestMember, updateGuestMember } from '@/server/roster/guest-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';
import { requireRosterGuest, rosterErrorResponse } from '../../_shared';

const sizesSchema = z
  .array(
    z.object({
      garmentId: z.string().uuid(),
      size: z.string().trim().min(1).max(40),
      customValues: z.record(z.string().max(200)).nullable().optional(),
    }),
  )
  .min(1)
  .max(50);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  playerNumber: z.string().trim().max(20).nullable().optional(),
  sizes: sizesSchema,
});

/** Update a player the signed-in guest owns. */
export const PATCH = defineRoute<{ orderNumber: string; memberId: string }, typeof updateSchema._type>({
  auth: 'public',
  tag: 'roster/members PATCH',
  schema: updateSchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `roster-write:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    const gate = await requireRosterGuest(request, params.orderNumber);
    if (gate instanceof NextResponse) return gate;

    try {
      await updateGuestMember(params.orderNumber, gate.guestId, params.memberId, body, gate.isAdmin);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return rosterErrorResponse(err);
    }
  },
});

/** Remove a player the signed-in guest owns. */
export const DELETE = defineRoute<{ orderNumber: string; memberId: string }>({
  auth: 'public',
  tag: 'roster/members DELETE',
  handler: async ({ request, params }) => {
    const gate = await requireRosterGuest(request, params.orderNumber);
    if (gate instanceof NextResponse) return gate;

    try {
      await removeGuestMember(params.orderNumber, gate.guestId, params.memberId, gate.isAdmin);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return rosterErrorResponse(err);
    }
  },
});
