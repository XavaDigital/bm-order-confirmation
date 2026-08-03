import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHubContact, isHubConfigured } from '@/server/hub/client';
import { defineRoute } from '@/lib/route-handler';

const createSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().email().optional(),
  /** Forward-compat: the hub ignores it today; attaches membership once it lands. */
  customerId: z.string().uuid().optional(),
});

/**
 * Create a CRM contact on the hub (browser-facing proxy — the browser never
 * holds the capability bearer). Hub refusals (409 address claimed, 422 own
 * domain) pass through with their message so the picker can explain.
 */
export const POST = defineRoute<Record<string, never>, typeof createSchema._type>({
  auth: 'staff',
  tag: 'hub/contacts POST',
  schema: createSchema,
  handler: async ({ body, session }) => {
    if (!isHubConfigured()) {
      return NextResponse.json({ error: 'Sales Hub integration is not configured' }, { status: 503 });
    }

    const result = await createHubContact(body, session!.email);

    if (result.outcome === 'refused') {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }
    if (result.outcome === 'error') {
      return NextResponse.json({ error: 'Sales Hub is unreachable' }, { status: 502 });
    }
    return NextResponse.json({ contact: result.contact }, { status: 201 });
  },
});
