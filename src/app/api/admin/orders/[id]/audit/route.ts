import { NextResponse } from 'next/server';
import { getOrderAuditLog } from '@/server/events/outbox';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'orders/[id]/audit GET',
  handler: async ({ params }) => {
    const events = await getOrderAuditLog(params.id);
    return NextResponse.json({ events });
  },
});
