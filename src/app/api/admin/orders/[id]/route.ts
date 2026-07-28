import { NextResponse } from 'next/server';
import { getOrderAdmin, updateOrder, deleteOrder } from '@/server/orders/service';
import { updateOrderSchema } from '@/server/orders/admin-contract';
import { notFound } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'orders/[id] GET',
  handler: async ({ params }) => {
    const order = await getOrderAdmin(params.id);
    if (!order) return notFound();
    return NextResponse.json(order);
  },
});

export const PATCH = defineRoute<{ id: string }, typeof updateOrderSchema._type>({
  auth: 'staff',
  tag: 'orders/[id] PATCH',
  schema: updateOrderSchema,
  handler: async ({ params, body, session }) => {
    await updateOrder(params.id, body, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});

export const DELETE = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id] DELETE',
  handler: async ({ params, session }) => {
    await deleteOrder(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
