import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getPurchaseOrder } from '@/server/purchase-orders/service';
import { PoPdf } from '@/components/admin/purchase-orders/PoPdf';
import { notFound } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { signPoSnapshotMedia } from '@/lib/signed-urls';

/**
 * Render the PO PDF for the supplier. Defaults to the LATEST revision;
 * `?rev=n` renders a specific historical revision (404 when it doesn't
 * exist). The document renders purely from the immutable revision snapshot,
 * so a regenerated PDF always matches what was originally sent.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'purchase-orders/[id]/pdf GET',
  handler: async ({ request, params }) => {
    const po = await getPurchaseOrder(params.id); // throws NotFoundError → 404

    // Revisions arrive newest-first; [0] is the latest.
    let revision = po.revisions[0];
    const revParam = request.nextUrl.searchParams.get('rev');
    if (revParam !== null) {
      const revNumber = Number(revParam);
      const found = Number.isInteger(revNumber)
        ? po.revisions.find((r) => r.revisionNumber === revNumber)
        : undefined;
      if (!found) return notFound('Revision not found');
      revision = found;
    }

    // Sign the garment mock-up images so the PDF can embed them — the stored
    // snapshot only carries storage keys (images whose URL fails to sign are
    // skipped by PoPdf).
    const snapshot = await signPoSnapshotMedia(revision.snapshot);

    const buffer = await renderToBuffer(
      (
        <PoPdf
          poNumber={po.poNumber}
          revisionNumber={revision.revisionNumber}
          revisionReason={revision.reason}
          createdAt={revision.createdAt.toISOString()}
          expectedShipDate={po.expectedShipDate}
          colorBookName={po.colorBookName}
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
