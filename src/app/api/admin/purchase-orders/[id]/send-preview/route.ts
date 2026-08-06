/**
 * GET /api/admin/purchase-orders/[id]/send-preview — what "Send to supplier"
 * would actually email (David, 2026-08-06: "when we hit send I'd like to see a
 * preview of what we're actually sending").
 *
 * Cheap by design: the subject/body come from `composeSupplierPoEmail` (the
 * same composer the real send uses), and the attachments are listed BY NAME
 * from the latest revision snapshot — no PDF render, no XLSX build, not one
 * byte fetched from storage. The hard guards (draft, terminal status, missing
 * supplier email) mirror the send so the modal cannot preview an impossible
 * send; the softer checklist/workflow gates are deliberately NOT checked here —
 * the modal surfaces those as blockers when the actual send 409s.
 *
 * `?messageIntro=` re-composes with the staff paragraph so the modal can show
 * the intro in place before committing to the send.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { purchaseOrders } from '@/db/schema';
import type { PoSnapshot } from '@/db/schema';
import { composeSupplierPoEmail, supplierPoDocumentNames } from '@/lib/email';
import { buildSupplierPoUrl } from '@/lib/tokens';
import { defineRoute } from '@/lib/route-handler';
import { ConflictError, NotFoundError } from '@/server/orders/service';
import { supplierCodeOrFallback } from '@/server/suppliers/service';

/**
 * The snapshot attachments BY NAME — the same naming rules as
 * `collectSnapshotAttachments` in src/server/purchase-orders/service.ts
 * (assets, deduped size charts, per-garment-numbered images), minus the
 * storage reads. If a rename lands there it must land here too, or the
 * preview lists names the email won't carry. Not exported — a route file may
 * only export HTTP methods, or Next's generated route validator rejects it.
 */
function listSnapshotAttachmentNames(snapshot: PoSnapshot): string[] {
  const wanted = new Map<string, string>(); // storageKey -> filename

  for (const asset of snapshot.assets ?? []) {
    if (asset.storageKey) {
      const ext = asset.storageKey.split('.').pop() ?? 'bin';
      wanted.set(asset.storageKey, `${asset.name}.${ext}`);
    }
  }
  // Charts dedupe across garments, same as the send.
  for (const garment of snapshot.garments) {
    for (const chart of garment.sizeCharts ?? []) {
      if (chart.storageKey && !wanted.has(chart.storageKey)) {
        const ext = chart.storageKey.split('.').pop() ?? 'bin';
        wanted.set(chart.storageKey, `size-chart-${chart.name}.${ext}`);
      }
    }
  }
  // Garment mock-ups at full resolution (the preview doesn't try to predict
  // the thumbnail size-budget fallback — same names either way bar extension).
  for (const garment of snapshot.garments) {
    let n = 0;
    for (const image of garment.images ?? []) {
      const key = image.storageKey;
      if (!key || wanted.has(key)) continue;
      n += 1;
      const ext = key.split('.').pop() ?? 'bin';
      const caption = image.caption?.trim();
      const base = caption ? `${garment.name}-${caption}` : `${garment.name}-${n}`;
      wanted.set(key, `${base}.${ext}`);
    }
  }
  return [...wanted.values()];
}

export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/send-preview GET',
  handler: async ({ params, request }) => {
    const po = await db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, params.id),
      with: {
        supplier: true,
        order: { columns: { orderNumber: true } },
        revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)], limit: 1 },
      },
    });
    if (!po) throw new NotFoundError('Purchase order');

    // The send's own cheap guards, mirrored (sendPurchaseOrder): behind these
    // the modal never opens, so a preview would only mislead.
    if (po.status === 'draft') {
      throw new ConflictError('Move the purchase order to Review before sending it');
    }
    if (po.status === 'cancelled' || po.status === 'completed' || po.status === 'received') {
      throw new ConflictError(`Cannot send a ${po.status} purchase order`);
    }
    if (!po.supplier.email) throw new ConflictError('Supplier has no email address');

    const latest = po.revisions[0]; // rev 1 always exists
    const toName = po.supplier.contactPerson ?? po.supplier.name;
    const portalUrl = buildSupplierPoUrl(supplierCodeOrFallback(po.supplier), po.poNumber);
    const messageIntro = request.nextUrl.searchParams.get('messageIntro')?.slice(0, 2000) ?? null;

    const { subject, html } = composeSupplierPoEmail({
      toName,
      poNumber: po.poNumber,
      orderNumber: po.order.orderNumber,
      revisionNumber: latest.revisionNumber,
      reason: latest.reason,
      messageIntro,
      portalUrl,
    });

    const documents = supplierPoDocumentNames(po.poNumber, latest.revisionNumber);
    const attachments = [
      { filename: documents.pdf },
      { filename: documents.xlsx },
      ...listSnapshotAttachmentNames(latest.snapshot).map((filename) => ({ filename })),
    ];

    return NextResponse.json({
      to: po.supplier.email,
      toName,
      subject,
      html,
      portalUrl,
      attachments,
    });
  },
});
