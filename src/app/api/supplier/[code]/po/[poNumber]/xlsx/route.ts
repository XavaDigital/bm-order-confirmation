import { NextResponse } from 'next/server';
import { buildPoWorkbook, poXlsxFilename } from '@/server/purchase-orders/xlsx';
import { defineRoute } from '@/lib/route-handler';
import { requireSupplier } from '../../../_shared';
import { loadSentPoForExport } from '../_export';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The supplier's own .xlsx export of one PO — the spreadsheet twin of the
 * supplier PDF route: portal-cookie gated, resolved by PO number + supplier
 * ownership, latest revision only. No signing needed — the workbook lists
 * image captions/filenames rather than embedding files.
 */
export const GET = defineRoute<{ code: string; poNumber: string }>({
  auth: 'public',
  tag: 'supplier/po/xlsx GET',
  handler: async ({ request, params }) => {
    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;

    const po = await loadSentPoForExport(gate.supplier.id, params.poNumber);
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const revision = po.revisions[0]; // rev 1 always exists

    const buffer = await buildPoWorkbook({
      poNumber: po.poNumber,
      revisionNumber: revision.revisionNumber,
      revisionReason: revision.reason,
      createdAt: revision.createdAt.toISOString(),
      expectedShipDate: po.expectedShipDate,
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
