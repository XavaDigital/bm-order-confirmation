import { NextResponse } from 'next/server';
import { listGarmentTypes, createGarmentType } from '@/server/garment-types/service';
import { createGarmentTypeSchema } from '@/server/garment-types/contract';
import { defineRoute } from '@/lib/route-handler';

// GET is available to all staff (the order flow needs the list); mutations
// are admin-only, matching the size-charts convention.
export const GET = defineRoute({
  auth: 'viewer',
  tag: 'garment-types GET',
  handler: async ({ request }) => {
    const activeOnly = request.nextUrl.searchParams.get('active') === '1';
    return NextResponse.json(await listGarmentTypes({ activeOnly }));
  },
});

export const POST = defineRoute({
  auth: 'admin',
  tag: 'garment-types POST',
  schema: createGarmentTypeSchema,
  handler: async ({ body }) => {
    const type = await createGarmentType(body);
    return NextResponse.json(type, { status: 201 });
  },
});
