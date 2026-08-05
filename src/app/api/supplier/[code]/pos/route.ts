import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { listSupplierPos } from '@/server/supplier-portal/service';
import { requireSupplier } from '../_shared';

/** The supplier's PO table: every SENT-or-later PO, newest first. */
export const GET = defineRoute<{ code: string }>({
  auth: 'public',
  tag: 'supplier/pos GET',
  handler: async ({ request, params }) => {
    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;
    const items = await listSupplierPos(gate.supplier.id);
    return NextResponse.json({ items, supplierName: gate.supplier.name, name: gate.personName });
  },
});
