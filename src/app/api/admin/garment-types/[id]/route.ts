import { NextResponse } from 'next/server';
import { getGarmentType, updateGarmentType } from '@/server/garment-types/service';
import { updateGarmentTypeSchema } from '@/server/garment-types/contract';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'garment-types/[id] GET',
  handler: async ({ params }) => NextResponse.json(await getGarmentType(params.id)),
});

// No DELETE — garment types are deactivate-only (PATCH { isActive: false }),
// so garments on historical orders keep their type reference.
export const PATCH = defineRoute<{ id: string }, typeof updateGarmentTypeSchema._type>({
  auth: 'admin',
  tag: 'garment-types/[id] PATCH',
  schema: updateGarmentTypeSchema,
  handler: async ({ params, body }) =>
    NextResponse.json(await updateGarmentType(params.id, body)),
});
