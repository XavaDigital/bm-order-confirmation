import { NextResponse } from 'next/server';
import { createOrderAsset, listOrderAssets } from '@/server/orders/assets-service';
import { createOrderAssetSchema } from '@/server/orders/assets-contract';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'orders/[id]/assets GET',
  handler: async ({ params }) => NextResponse.json(await listOrderAssets(params.id)),
});

export const POST = defineRoute<{ id: string }, typeof createOrderAssetSchema._type>({
  auth: 'staff',
  tag: 'orders/[id]/assets POST',
  schema: createOrderAssetSchema,
  handler: async ({ params, body, session }) => {
    const asset = await createOrderAsset(params.id, body, {
      actorEmail: session!.email,
      actorStaffUserId: session!.userId,
    });
    return NextResponse.json(asset, { status: 201 });
  },
});
