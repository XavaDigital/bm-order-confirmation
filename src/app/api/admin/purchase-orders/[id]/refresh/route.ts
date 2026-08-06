import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { refreshDraftSnapshot } from '@/server/purchase-orders/service';

/**
 * Re-cut an UNSENT PO's snapshot from live order data (David, 2026-08-06:
 * drafts track the order without spamming revision history). 409 once sent —
 * post-send changes are revisions.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/refresh POST',
  handler: async ({ params, session }) => {
    await refreshDraftSnapshot(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
