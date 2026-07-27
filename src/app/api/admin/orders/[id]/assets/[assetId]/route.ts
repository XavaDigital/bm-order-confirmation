import { NextResponse } from 'next/server';
import { deleteOrderAsset, updateOrderAsset } from '@/server/orders/assets-service';
import { updateOrderAssetSchema } from '@/server/orders/assets-contract';
import { defineRoute } from '@/lib/route-handler';

export const PATCH = defineRoute<
  { id: string; assetId: string },
  typeof updateOrderAssetSchema._type
>({
  auth: 'staff',
  tag: 'orders/[id]/assets/[assetId] PATCH',
  schema: updateOrderAssetSchema,
  handler: async ({ params, body, session }) =>
    NextResponse.json(
      await updateOrderAsset(params.assetId, body, { actorEmail: session!.email }),
    ),
});

export const DELETE = defineRoute<{ id: string; assetId: string }>({
  auth: 'staff',
  tag: 'orders/[id]/assets/[assetId] DELETE',
  handler: async ({ params, session }) => {
    await deleteOrderAsset(params.assetId, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
