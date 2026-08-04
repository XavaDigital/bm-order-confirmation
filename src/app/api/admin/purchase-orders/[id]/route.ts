import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getPurchaseOrder, updatePurchaseOrder } from '@/server/purchase-orders/service';
import { updatePurchaseOrderSchema } from '@/server/purchase-orders/contract';
import { signPoAssets } from '@/lib/signed-urls';

export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'purchase-orders [id] GET',
  handler: async ({ params }) => {
    const po = await getPurchaseOrder(params.id);
    // Only the latest revision renders inline in the admin PO screen — older
    // revisions are reached via their own PDF/XLSX links, never this field.
    const [latest, ...rest] = po.revisions;
    if (latest?.snapshot.assets?.length) {
      const signedAssets = await signPoAssets(latest.snapshot.assets);
      po.revisions = [
        { ...latest, snapshot: { ...latest.snapshot, assets: signedAssets } },
        ...rest,
      ];
    }
    return NextResponse.json(po);
  },
});

export const PATCH = defineRoute<{ id: string }, typeof updatePurchaseOrderSchema._type>({
  auth: 'staff',
  tag: 'purchase-orders [id] PATCH',
  schema: updatePurchaseOrderSchema,
  handler: async ({ params, body, session }) => {
    const po = await updatePurchaseOrder(params.id, body, { actorEmail: session!.email });
    return NextResponse.json(po);
  },
});
