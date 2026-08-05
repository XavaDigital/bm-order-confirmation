import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { buildPoZip } from '@/server/purchase-orders/files-service';
import { requireSupplier } from '../../../_shared';
import { loadSentPoForExport } from '../_export';

/**
 * Everything on the PO as one zip (David, 2026-08-05): design/font assets,
 * size charts, mock-up images and production files. Built in memory —
 * bounded by the PO's own file set.
 */
export const GET = defineRoute<{ code: string; poNumber: string }>({
  auth: 'public',
  tag: 'supplier/po/files.zip GET',
  handler: async ({ request, params }) => {
    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;
    const po = await loadSentPoForExport(gate.supplier.id, params.poNumber);
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { fileName, data } = await buildPoZip(po.id);
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
