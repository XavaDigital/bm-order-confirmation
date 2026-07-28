import { NextResponse } from 'next/server';
import { z } from 'zod';
import { renderToBuffer } from '@react-pdf/renderer';
import { NotFoundError, ConflictError } from '@/server/orders/service';
import { sendPurchaseOrder } from '@/server/purchase-orders/service';
import { PoPdf } from '@/components/admin/purchase-orders/PoPdf';
import { isEmailConfigured } from '@/lib/email';
import { forbidden, serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

/**
 * Optional override for the `po_send` gate. Absent body = a normal send, so the
 * existing callers keep working unchanged.
 */
const sendPoSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    overrideReason: z.string().trim().min(1).max(500).optional(),
  }),
);

/**
 * Email the latest PO revision (PDF attached) to the supplier. The service
 * owns the guards and side effects; this route injects the react-pdf renderer
 * so the service stays free of component/react-pdf imports.
 *
 * Sending is staff-level, but OVERRIDING the pre-production gate is admin-only:
 * the check exists to stop work reaching the factory early, so the person
 * skipping it should be the one accountable for that call.
 */
export const POST = defineRoute<{ id: string }, typeof sendPoSchema._type>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/send POST',
  schema: sendPoSchema,
  handler: async ({ params, body, session }) => {
    if (!isEmailConfigured()) {
      return serviceUnavailable('Email delivery is not configured on this server.');
    }
    if (body.overrideReason && session!.role !== 'admin') {
      return forbidden('Only an admin can send a purchase order with outstanding checks.');
    }

    try {
      const result = await sendPurchaseOrder(
        params.id,
        {
          actorStaffUserId: session!.userId,
          actorEmail: session!.email,
          gateOverrideReason: body.overrideReason ?? null,
        },
        (props) => renderToBuffer((<PoPdf {...props} />) as Parameters<typeof renderToBuffer>[0]),
      );
      return NextResponse.json({ ok: true, ...result }, { status: 200 });
    } catch (err) {
      // Let the wrapper map service not-found/conflict errors; anything else
      // (e.g. an SMTP failure) surfaces its message so staff can act on it.
      // WorkflowGateConflictError extends ConflictError, so a blocked send comes
      // back as a 409 carrying the outstanding checks.
      if (err instanceof NotFoundError || err instanceof ConflictError) throw err;
      logger.error('[purchase-orders/[id]/send POST]', err);
      const msg = err instanceof Error ? err.message : 'Internal server error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
});
