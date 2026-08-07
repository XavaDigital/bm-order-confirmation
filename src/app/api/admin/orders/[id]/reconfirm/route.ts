import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isEmailConfigured } from '@/lib/email';
import { serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';
import { NotFoundError, ConflictError } from '@/server/orders/service';
import { sendOrderConfirmationLink } from '@/server/notifications/service';
import {
  cancelReconfirmationRequest,
  getReconfirmationState,
  requestReconfirmation,
} from '@/server/orders/reconfirmation-service';

/**
 * Re-confirmation for one order (David, 2026-08-07).
 *
 * GET reports where the order stands against what the customer agreed to —
 * derived on read, so it is always current (see orders/reconfirmation.ts).
 * POST asks them to agree again. DELETE withdraws the ask, for when it turns
 * out they already agreed by phone.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'orders/[id]/reconfirm GET',
  handler: async ({ params }) => NextResponse.json(await getReconfirmationState(params.id)),
});

const requestSchema = z.object({
  /** Staff's covering note to the customer. */
  note: z.string().trim().max(1000).nullish(),
  /**
   * Send the customer an email as well as raising the flag. Off is legitimate:
   * staff may want the hold on production without another email today.
   */
  sendEmail: z.boolean().default(true),
});

export const POST = defineRoute<{ id: string }, typeof requestSchema._type>({
  auth: 'staff',
  tag: 'orders/[id]/reconfirm POST',
  schema: requestSchema,
  handler: async ({ params, body, session }) => {
    if (body.sendEmail && !isEmailConfigured()) {
      return serviceUnavailable('Email delivery is not configured on this server.');
    }

    // Read the changes BEFORE raising the flag: once raised, the state reports
    // 'awaiting_customer' and the email would have nothing to list.
    const before = await getReconfirmationState(params.id);
    const state = await requestReconfirmation(params.id, {
      note: body.note ?? null,
      actorEmail: session!.email,
    });

    if (!body.sendEmail) return NextResponse.json({ ...state, emailSent: false });

    try {
      const { url } = await sendOrderConfirmationLink(params.id, {
        actorEmail: session!.email,
        reconfirmation: {
          note: body.note ?? null,
          changes: before.changes.map((c) => c.label),
        },
      });
      return NextResponse.json({ ...state, emailSent: true, url });
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof ConflictError) throw err;
      // The flag IS raised — production is held either way. Say the email
      // failed rather than implying the whole request did.
      logger.error('[orders/[id]/reconfirm POST] email failed', err);
      const msg = err instanceof Error ? err.message : 'Could not send the email';
      return NextResponse.json({ ...state, emailSent: false, emailError: msg }, { status: 200 });
    }
  },
});

export const DELETE = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/reconfirm DELETE',
  handler: async ({ params, session }) =>
    NextResponse.json(await cancelReconfirmationRequest(params.id, { actorEmail: session!.email })),
});
