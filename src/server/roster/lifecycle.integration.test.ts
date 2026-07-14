/**
 * End-to-end roster lifecycle (TEAM_ROSTER_PLAN.md Phase 8.1): create order →
 * generate roster link → add members via import → submit sizes via token →
 * lock → confirm order → snapshot correctness. Individual steps already have
 * focused unit/integration coverage elsewhere; this test exists to catch
 * breakage at the seams between them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, lockRoster } from '@/server/orders/service';
import {
  confirmOrder,
  REQUIRED_ACK_KEYS,
  type AckInput,
} from '@/server/orders/customer-service';
import { importRosterMembers, generateRosterToken } from './service';
import { addSelf, submitMemberSizes } from './customer-service';

afterEach(async () => {
  await resetTestDb(db);
});

function allAcks(): AckInput[] {
  return REQUIRED_ACK_KEYS.map((key) => ({ key, text: `ack for ${key}` }));
}

describe('roster lifecycle', () => {
  it('takes an order from roster import through submission, lock, and confirmation', async () => {
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane Coach', email: 'jane@example.com', clubName: 'Wildcats' },
        garments: [{ name: 'Home Jersey' }, { name: 'Shorts' }],
      }),
    );
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: { orderBy: (g, { asc }) => [asc(g.sortOrder)] } },
    });
    const [jersey, shorts] = order!.garments;

    // Bulk import two members.
    const importResult = await importRosterMembers(
      created.orderId,
      [
        ['Alex Player', '7', 'alex@example.com'],
        ['Sam Player', '9', ''],
      ],
      { nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 },
    );
    expect(importResult.imported).toBe(2);

    // Manager distributes the shared roster link.
    const { token } = await generateRosterToken(created.orderId);

    // A third member self-adds via the link (not pre-loaded by the manager).
    const selfAdded = await addSelf(token, { name: 'Jamie Walkon' });

    // All three submit their sizes across both garments.
    for (const member of [...importResult.members, selfAdded]) {
      const updated = await submitMemberSizes(token, member.id, {
        sizes: [
          { garmentId: jersey.id, size: 'M' },
          { garmentId: shorts.id, size: 'L' },
        ],
      });
      expect(updated.submittedAt).not.toBeNull();
    }

    const sizingRows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.garmentId, jersey.id),
    });
    expect(sizingRows).toHaveLength(3);

    // Manager locks the roster once everyone's submitted.
    await lockRoster(created.orderId);
    await expect(
      submitMemberSizes(token, selfAdded.id, {
        sizes: [
          { garmentId: jersey.id, size: 'S' },
          { garmentId: shorts.id, size: 'S' },
        ],
      }),
    ).rejects.toThrow('roster_locked');

    // Manager proceeds through the unchanged confirmation flow.
    const confirmResult = await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
      ipAddress: '203.0.113.9',
      userAgent: 'vitest',
    });
    expect(confirmResult.orderId).toBe(created.orderId);

    // The immutable snapshot captures the roster-submitted rows.
    const [confirmation] = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    const snapshot = confirmation.confirmedSnapshot as {
      garments: { name: string; sizing: { player_name: string | null; size: string | null }[] }[];
    };
    const jerseySnapshot = snapshot.garments.find((g) => g.name === jersey.name)!;
    expect(jerseySnapshot.sizing).toHaveLength(3);
    expect(jerseySnapshot.sizing.map((row) => row.player_name).sort()).toEqual(
      ['Alex Player', 'Jamie Walkon', 'Sam Player'].sort(),
    );
  });
});
