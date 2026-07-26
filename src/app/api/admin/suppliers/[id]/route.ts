import { NextResponse } from 'next/server';
import { getSupplier, updateSupplier } from '@/server/suppliers/service';
import { updateSupplierSchema } from '@/server/suppliers/contract';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'suppliers/[id] GET',
  handler: async ({ params }) => NextResponse.json(await getSupplier(params.id)),
});

// No DELETE — suppliers are deactivate-only (PATCH { isActive: false }), so
// purchase orders on historical orders keep their supplier reference.
export const PATCH = defineRoute<{ id: string }, typeof updateSupplierSchema._type>({
  auth: 'admin',
  tag: 'suppliers/[id] PATCH',
  schema: updateSupplierSchema,
  handler: async ({ params, body }) =>
    NextResponse.json(await updateSupplier(params.id, body)),
});
