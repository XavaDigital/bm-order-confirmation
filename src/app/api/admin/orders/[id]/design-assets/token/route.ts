import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, staffUsers } from '@/db/schema';
import { env } from '@/lib/env';
import { defineRoute } from '@/lib/route-handler';
import {
  isHubConfigured,
  lookupHubEntityId,
  mintProjectActionToken,
} from '@/server/hub/client';

/**
 * Mint a DesignFlow `read-assets` action token for this order's originating
 * design project (fleet thread 2026-07-31, designflow's asset-pull contract).
 *
 * The flow honours the fleet bytes rule end to end: this route only brokers
 * AUTHORITY (hub authorises the acting user, DesignFlow mints a short-lived
 * scoped token); the BROWSER then lists and fetches the assets from DesignFlow
 * directly and re-uploads the bytes into our own bucket. Bytes never transit
 * the hub or this server.
 *
 * The mint is keyed by the HUB project id, but we store DesignFlow's uuid
 * (rename/merge-stable, per their D3 commitment) — so we reverse-look-up the
 * hub id via the external-reference registry first.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/design-assets/token POST',
  handler: async ({ params, session }) => {
    if (!isHubConfigured()) {
      return NextResponse.json(
        { error: 'The Sales Hub integration is not configured on this server' },
        { status: 503 },
      );
    }

    const [order] = await db
      .select({ id: orders.id, designProjectRef: orders.designProjectRef })
      .from(orders)
      .where(eq(orders.id, params.id));
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (!order.designProjectRef) {
      return NextResponse.json(
        { error: 'This order is not linked to a design project' },
        { status: 409 },
      );
    }

    // The acting user must be the staff member's IDENTITY id — the hub
    // authorises the mint on it and DesignFlow re-checks the user is enabled.
    // A label or email cannot satisfy that (fleet identity contract), so an
    // unlinked account is refused with the fix, never silently downgraded.
    const [staff] = await db
      .select({ identityUserId: staffUsers.identityUserId })
      .from(staffUsers)
      .where(eq(staffUsers.id, session!.userId));
    if (!staff?.identityUserId) {
      return NextResponse.json(
        { error: 'Pulling design assets needs a Google-linked account — sign in with Google once, then retry' },
        { status: 409 },
      );
    }

    const hubProjectId = await lookupHubEntityId(
      'design_tool',
      order.designProjectRef,
      'project',
    );
    if (!hubProjectId) {
      return NextResponse.json(
        { error: 'The Sales Hub has no record of this design project — check the link on the order' },
        { status: 409 },
      );
    }

    const mint = await mintProjectActionToken(hubProjectId, 'read-assets', staff.identityUserId);
    if (mint.outcome === 'error') {
      return NextResponse.json(
        { error: 'DesignFlow could not be reached to authorise the pull — try again' },
        { status: 502 },
      );
    }
    if (mint.outcome === 'refused') {
      // Pass the hub's verdict through (403 not permitted / 409 unknown to
      // DesignFlow / 503 brokerage unconfigured …) so the UI can say why.
      return NextResponse.json({ error: mint.message }, { status: mint.status });
    }

    return NextResponse.json({
      token: mint.token,
      expiresAt: mint.expiresAt,
      // Built server-side so the browser needs no DesignFlow config. The path
      // is keyed by DesignFlow's own project uuid — the one we store.
      assetsUrl: `${env.DESIGNFLOW_URL}/api/action/v1/projects/${order.designProjectRef}/assets`,
    });
  },
});
