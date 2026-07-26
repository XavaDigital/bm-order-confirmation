import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { NotFoundError, ConflictError } from '@/server/orders/service';
import { sendPurchaseOrder } from '@/server/purchase-orders/service';
import { PoPdf } from '@/components/admin/purchase-orders/PoPdf';
import { isEmailConfigured } from '@/lib/email';
import { serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

/**
 * Email the latest PO revision (PDF attached) to the supplier. The service
 * owns the guards and side effects; this route injects the react-pdf renderer
 * so the service stays free of component/react-pdf imports.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/send POST',
  handler: async ({ params, session }) => {
    if (!isEmailConfigured()) {
      return serviceUnavailable('Email delivery is not configured on this server.');
    }

    try {
      const result = await sendPurchaseOrder(
        params.id,
        { actorStaffUserId: session!.userId, actorEmail: session!.email },
        (props) => renderToBuffer((<PoPdf {...props} />) as Parameters<typeof renderToBuffer>[0]),
      );
      return NextResponse.json({ ok: true, ...result }, { status: 200 });
    } catch (err) {
      // Let the wrapper map service not-found/conflict errors; anything else
      // (e.g. an SMTP failure) surfaces its message so staff can act on it.
      if (err instanceof NotFoundError || err instanceof ConflictError) throw err;
      logger.error('[purchase-orders/[id]/send POST]', err);
      const msg = err instanceof Error ? err.message : 'Internal server error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
});
