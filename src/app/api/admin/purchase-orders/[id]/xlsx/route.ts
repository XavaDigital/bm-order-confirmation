import { NextResponse } from 'next/server';
import { getPurchaseOrder } from '@/server/purchase-orders/service';
import { buildPoWorkbook, poXlsxFilename } from '@/server/purchase-orders/xlsx';
import { notFound } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Export the PO as .xlsx (the spreadsheet counterpart of the PDF route, with
 * identical revision semantics): latest revision by default, `?rev=n` for a
 * specific historical one. Renders purely from the immutable revision
 * snapshot, so a regenerated workbook matches what was originally sent.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'purchase-orders/[id]/xlsx GET',
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

    const buffer = await buildPoWorkbook({
      poNumber: po.poNumber,
      revisionNumber: revision.revisionNumber,
      revisionReason: revision.reason,
      createdAt: revision.createdAt.toISOString(),
      expectedShipDate: po.expectedShipDate,
      colorBookName: po.colorBookName,
      notes: po.notes,
      supplier: {
        name: po.supplier.name,
        contactPerson: po.supplier.contactPerson,
        email: po.supplier.email,
        phone: po.supplier.phone,
      },
      snapshot: revision.snapshot,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': XLSX_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${poXlsxFilename(po.poNumber, revision.revisionNumber)}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
