import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { resolveSupplierPoViewByNumber } from '@/server/supplier-portal/service';
import { requireSupplier } from '../../_shared';

/** One PO's full portal view (snapshot + comments), for the detail page. */
export const GET = defineRoute<{ code: string; poNumber: string }>({
  auth: 'public',
  tag: 'supplier/po GET',
  handler: async ({ request, params }) => {
    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;
    try {
      const view = await resolveSupplierPoViewByNumber(gate.supplier.id, params.poNumber);
      return NextResponse.json({ view, name: gate.personName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'po_not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      throw err;
    }
  },
});
