import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { PoPdf } from '@/components/admin/purchase-orders/PoPdf';
import { defineRoute } from '@/lib/route-handler';
import { signPoSnapshotMedia } from '@/lib/signed-urls';
import { requireSupplier } from '../../../_shared';
import { loadSentPoForExport } from '../_export';

/**
 * The supplier's own PDF export of one PO (David, 2026-08-05: "can export to
 * XLSX or PDF"). Mirrors the admin PDF route but gated by the supplier portal
 * cookie, resolved by PO number + supplier ownership, and ALWAYS the latest
 * revision — no ?rev access to history. The snapshot goes through
 * signPoSnapshotMedia so the PDF can embed the garment mock-up images.
 */
export const GET = defineRoute<{ code: string; poNumber: string }>({
  auth: 'public',
  tag: 'supplier/po/pdf GET',
  handler: async ({ request, params }) => {
    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;

    const po = await loadSentPoForExport(gate.supplier.id, params.poNumber);
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const revision = po.revisions[0]; // rev 1 always exists
    const snapshot = await signPoSnapshotMedia(revision.snapshot);

    const buffer = await renderToBuffer(
      (
        <PoPdf
          poNumber={po.poNumber}
          revisionNumber={revision.revisionNumber}
          revisionReason={revision.reason}
          createdAt={revision.createdAt.toISOString()}
          expectedShipDate={po.expectedShipDate}
          notes={po.notes}
          supplier={{
            name: po.supplier.name,
            contactPerson: po.supplier.contactPerson,
            email: po.supplier.email,
            phone: po.supplier.phone,
          }}
          snapshot={snapshot}
        />
      ) as Parameters<typeof renderToBuffer>[0],
    );

    const filename =
      revision.revisionNumber > 1
        ? `${po.poNumber}-rev${revision.revisionNumber}.pdf`
        : `${po.poNumber}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
