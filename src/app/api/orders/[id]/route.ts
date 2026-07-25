import { NextResponse } from 'next/server';
import { isInternalAuthorized } from '@/lib/api-auth';
import { getOrderById } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

export const dynamic = 'force-dynamic';

export const GET = defineRoute<{ id: string }>({
  auth: 'public',
  tag: 'orders/[id] GET',
  handler: async ({ request, params }) => {
    if (!isInternalAuthorized(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const order = await getOrderById(params.id);
    if (!order) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ order });
  },
});
