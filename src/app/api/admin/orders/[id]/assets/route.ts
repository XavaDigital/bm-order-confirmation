import { NextResponse } from 'next/server';
import { createOrderAsset, listOrderAssets } from '@/server/orders/assets-service';
import { createOrderAssetSchema } from '@/server/orders/assets-contract';
import { getSignedUrl } from '@/lib/storage';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'orders/[id]/assets GET',
  handler: async ({ params }) => {
    const assets = await listOrderAssets(params.id);
    return NextResponse.json(
      await Promise.all(
        assets.map(async (asset) => ({
          ...asset,
          /**
           * One field the UI can always link: the Drive URL, or a short-lived
           * signed URL for an uploaded file. Signed HERE, per request — the
           * stored row keeps only the key, so nothing durable ever holds a URL
           * that expires. Null if storage is briefly unhappy; the row still
           * renders, just not as a link.
           */
          downloadUrl: asset.url ?? (asset.storageKey ? await getSignedUrl(asset.storageKey, 4 * 3600).catch(() => null) : null),
        })),
      ),
    );
  },
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
