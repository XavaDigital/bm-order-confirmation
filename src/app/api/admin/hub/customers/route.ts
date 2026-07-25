import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHubCustomer, isHubConfigured } from '@/server/hub/client';
import { defineRoute } from '@/lib/route-handler';

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().optional(),
});

/** Create (or link to) a hub customer — idempotent on email; 409 = ambiguous. */
export const POST = defineRoute<Record<string, never>, typeof createSchema._type>({
  auth: 'staff',
  tag: 'hub/customers POST',
  schema: createSchema,
  handler: async ({ body, session }) => {
    if (!isHubConfigured()) {
      return NextResponse.json({ error: 'Sales Hub integration is not configured' }, { status: 503 });
    }

    const result = await createHubCustomer(body, session!.email);

    if (result.outcome === 'ambiguous') {
      return NextResponse.json(
        { code: 'CUSTOMER_AMBIGUOUS', candidates: result.candidates },
        { status: 409 },
      );
    }
    if (result.outcome === 'error') {
      return NextResponse.json({ error: 'Sales Hub is unreachable' }, { status: 502 });
    }
    return NextResponse.json(result.customer, { status: 201 });
  },
});
