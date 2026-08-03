import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addGuestMember } from '@/server/roster/guest-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';
import { requireRosterGuest, rosterErrorResponse } from '../_shared';

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

const addSchema = z.object({
  name: z.string().trim().min(1).max(120),
  playerNumber: z.string().trim().max(20).nullable().optional(),
  sizes: sizesSchema,
});

/** Add a player owned by the signed-in guest, sizes included. */
export const POST = defineRoute<{ orderNumber: string }, typeof addSchema._type>({
  auth: 'public',
  tag: 'roster/members POST',
  schema: addSchema,
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
      const result = await addGuestMember(params.orderNumber, gate.guestId, body);
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      return rosterErrorResponse(err);
    }
  },
});
