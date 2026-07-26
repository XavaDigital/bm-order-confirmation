import { NextResponse } from 'next/server';
import { listSuppliers, createSupplier } from '@/server/suppliers/service';
import { createSupplierSchema } from '@/server/suppliers/contract';
import { defineRoute } from '@/lib/route-handler';

// GET is available to all staff (the PO flow needs the supplier list);
// mutations are admin-only, matching the garment-types convention.
export const GET = defineRoute({
  auth: 'staff',
  tag: 'suppliers GET',
  handler: async ({ request }) => {
    const activeOnly = request.nextUrl.searchParams.get('active') === '1';
    return NextResponse.json(await listSuppliers({ activeOnly }));
  },
});

export const POST = defineRoute({
  auth: 'admin',
  tag: 'suppliers POST',
  schema: createSupplierSchema,
  handler: async ({ body }) => {
    const supplier = await createSupplier(body);
    return NextResponse.json(supplier, { status: 201 });
  },
});
