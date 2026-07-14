import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, isNull, and } from 'drizzle-orm';

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
import { createOrder } from '@/server/orders/service';
import { NotFoundError } from '@/server/orders/service';
import { tokensMatch } from '@/lib/tokens';
import {
  getRoster,
  addRosterMember,
  updateRosterMember,
  removeRosterMember,
  generateRosterToken,
  revokeRosterToken,
  importRosterMembers,
  generateMemberToken,
} from './service';
import type { RosterImportMapping } from './contract';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

describe('addRosterMember', () => {
  it('throws NotFoundError for an unknown order', async () => {
    await expect(
      addRosterMember('00000000-0000-0000-0000-000000000000', { name: 'Alex' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('inserts a member with an incrementing sortOrder and emits roster.member_added', async () => {
    const created = await createOrder(minimalInput());

    const first = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });
    const second = await addRosterMember(created.orderId, { name: 'Sam', email: 'sam@example.com' });

    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);
    expect(second.email).toBe('sam@example.com');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const addedEvents = events.filter((e) => e.eventType === 'roster.member_added');
    expect(addedEvents).toHaveLength(2);
    expect(addedEvents[0].payload).toMatchObject({ name: 'Alex' });
  });
});

describe('updateRosterMember', () => {
  it('throws NotFoundError for an unknown member', async () => {
    await expect(
      updateRosterMember('00000000-0000-0000-0000-000000000000', { name: 'New Name' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('patches only the provided fields', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });

    await updateRosterMember(member.id, { playerNumber: '9' });

    const updated = await db.query.rosterMembers.findFirst({ where: eq(schema.rosterMembers.id, member.id) });
    expect(updated!.name).toBe('Alex');
    expect(updated!.playerNumber).toBe('9');
  });
});

describe('removeRosterMember', () => {
  it('throws NotFoundError for an unknown member', async () => {
    await expect(removeRosterMember('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('deletes the member and emits roster.member_removed', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });

    await removeRosterMember(member.id);

    const found = await db.query.rosterMembers.findFirst({ where: eq(schema.rosterMembers.id, member.id) });
    expect(found).toBeUndefined();

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const removedEvent = events.find((e) => e.eventType === 'roster.member_removed');
    expect(removedEvent).toBeDefined();
    expect(removedEvent!.payload).toMatchObject({ name: 'Alex' });
  });

  it('cascades the member’s garment_sizing rows', async () => {
    const created = await createOrder(minimalInput());
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const garmentId = order!.garments[0].id;
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const [row] = await db
      .insert(schema.garmentSizing)
      .values({ garmentId, size: 'M', rosterMemberId: member.id })
      .returning();

    await removeRosterMember(member.id);

    const found = await db.query.garmentSizing.findFirst({ where: eq(schema.garmentSizing.id, row.id) });
    expect(found).toBeUndefined();
  });
});

describe('getRoster', () => {
  it('throws NotFoundError for an unknown order', async () => {
    await expect(getRoster('00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundError);
  });

  it('returns members with their sizing rows, current access, and completion stats', async () => {
    const created = await createOrder(minimalInput());
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const garmentId = order!.garments[0].id;

    const alex = await addRosterMember(created.orderId, { name: 'Alex' });
    await addRosterMember(created.orderId, { name: 'Sam' });
    await db.insert(schema.garmentSizing).values({ garmentId, size: 'M', rosterMemberId: alex.id });
    await db
      .update(schema.rosterMembers)
      .set({ submittedAt: new Date() })
      .where(eq(schema.rosterMembers.id, alex.id));
    await generateRosterToken(created.orderId);

    const roster = await getRoster(created.orderId);

    expect(roster.members).toHaveLength(2);
    expect(roster.members[0].sizing).toHaveLength(1);
    expect(roster.stats).toEqual({ total: 2, submitted: 1 });
    expect(roster.currentAccess).not.toBeNull();
    expect(roster.locked).toBe(false);
  });

  it('returns an empty roster with null access for an order with no members/link', async () => {
    const created = await createOrder(minimalInput());

    const roster = await getRoster(created.orderId);

    expect(roster.members).toEqual([]);
    expect(roster.stats).toEqual({ total: 0, submitted: 0 });
    expect(roster.currentAccess).toBeNull();
    expect(roster.locked).toBe(false);
  });

  it('reflects the order roster_locked_at state', async () => {
    const created = await createOrder(minimalInput());
    await db
      .update(schema.orders)
      .set({ rosterLockedAt: new Date() })
      .where(eq(schema.orders.id, created.orderId));

    const roster = await getRoster(created.orderId);

    expect(roster.locked).toBe(true);
  });
});

describe('generateRosterToken / revokeRosterToken', () => {
  it('throws NotFoundError for an unknown order', async () => {
    await expect(generateRosterToken('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('issues a token whose hash matches, and emits roster.token_generated', async () => {
    const created = await createOrder(minimalInput());

    const { token, url } = await generateRosterToken(created.orderId, { actorEmail: 'staff@x.com' });

    const access = await db.query.rosterAccess.findFirst({
      where: and(eq(schema.rosterAccess.orderId, created.orderId), isNull(schema.rosterAccess.revokedAt)),
    });
    expect(access).toBeDefined();
    expect(tokensMatch(token, access!.tokenHash)).toBe(true);
    expect(url).toContain('/o/roster/');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const genEvent = events.find((e) => e.eventType === 'roster.token_generated');
    expect(genEvent).toBeDefined();
    expect(genEvent!.payload).toMatchObject({ actorEmail: 'staff@x.com' });
  });

  it('regenerating revokes the previous roster token but not order_access', async () => {
    const created = await createOrder(minimalInput());
    await generateRosterToken(created.orderId);

    await generateRosterToken(created.orderId);

    const activeRosterAccess = await db.query.rosterAccess.findMany({
      where: and(eq(schema.rosterAccess.orderId, created.orderId), isNull(schema.rosterAccess.revokedAt)),
    });
    expect(activeRosterAccess).toHaveLength(1);

    const activeOrderAccess = await db.query.orderAccess.findMany({
      where: and(eq(schema.orderAccess.orderId, created.orderId), isNull(schema.orderAccess.revokedAt)),
    });
    expect(activeOrderAccess).toHaveLength(1);
  });

  it('revokeRosterToken revokes the active roster link only', async () => {
    const created = await createOrder(minimalInput());
    await generateRosterToken(created.orderId);

    await revokeRosterToken(created.orderId, { actorEmail: 'staff@x.com' });

    const activeRosterAccess = await db.query.rosterAccess.findMany({
      where: and(eq(schema.rosterAccess.orderId, created.orderId), isNull(schema.rosterAccess.revokedAt)),
    });
    expect(activeRosterAccess).toHaveLength(0);

    const activeOrderAccess = await db.query.orderAccess.findMany({
      where: and(eq(schema.orderAccess.orderId, created.orderId), isNull(schema.orderAccess.revokedAt)),
    });
    expect(activeOrderAccess).toHaveLength(1);

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const revokeEvent = events.find((e) => e.eventType === 'roster.token_revoked');
    expect(revokeEvent).toBeDefined();
    expect(revokeEvent!.payload).toMatchObject({ actorEmail: 'staff@x.com' });
  });
});

describe('generateMemberToken', () => {
  it('throws NotFoundError for an unknown member', async () => {
    await expect(generateMemberToken('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('issues a token whose hash matches, and emits roster.member_link_generated', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });

    const { token, url } = await generateMemberToken(member.id, { actorEmail: 'staff@x.com' });

    const access = await db.query.rosterMemberAccess.findFirst({
      where: and(
        eq(schema.rosterMemberAccess.rosterMemberId, member.id),
        isNull(schema.rosterMemberAccess.revokedAt),
      ),
    });
    expect(access).toBeDefined();
    expect(tokensMatch(token, access!.tokenHash)).toBe(true);
    expect(url).toContain('/o/roster/member/');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const genEvent = events.find((e) => e.eventType === 'roster.member_link_generated');
    expect(genEvent).toBeDefined();
    expect(genEvent!.payload).toMatchObject({ memberId: member.id, name: 'Alex', actorEmail: 'staff@x.com' });
  });

  it('regenerating revokes only this member\'s previous token, not another member\'s or the shared roster link', async () => {
    const created = await createOrder(minimalInput());
    const alex = await addRosterMember(created.orderId, { name: 'Alex' });
    const sam = await addRosterMember(created.orderId, { name: 'Sam' });
    await generateRosterToken(created.orderId);
    await generateMemberToken(alex.id);
    await generateMemberToken(sam.id);

    await generateMemberToken(alex.id);

    const activeAlexAccess = await db.query.rosterMemberAccess.findMany({
      where: and(eq(schema.rosterMemberAccess.rosterMemberId, alex.id), isNull(schema.rosterMemberAccess.revokedAt)),
    });
    expect(activeAlexAccess).toHaveLength(1);

    const activeSamAccess = await db.query.rosterMemberAccess.findMany({
      where: and(eq(schema.rosterMemberAccess.rosterMemberId, sam.id), isNull(schema.rosterMemberAccess.revokedAt)),
    });
    expect(activeSamAccess).toHaveLength(1);

    const activeRosterAccess = await db.query.rosterAccess.findMany({
      where: and(eq(schema.rosterAccess.orderId, created.orderId), isNull(schema.rosterAccess.revokedAt)),
    });
    expect(activeRosterAccess).toHaveLength(1);
  });
});

describe('importRosterMembers', () => {
  const mapping: RosterImportMapping = { nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 };

  it('throws NotFoundError for an unknown order', async () => {
    await expect(
      importRosterMembers('00000000-0000-0000-0000-000000000000', [['Alex', '7', '']], mapping),
    ).rejects.toThrow(NotFoundError);
  });

  it('inserts valid rows and reports counts', async () => {
    const created = await createOrder(minimalInput());

    const result = await importRosterMembers(
      created.orderId,
      [
        ['Alex', '7', 'alex@example.com'],
        ['Sam', '9', 'not-an-email'],
      ],
      mapping,
    );

    expect(result.imported).toBe(2);
    expect(result.skippedBlank).toBe(0);
    expect(result.skippedDuplicate).toBe(0);
    expect(result.members.map((m) => m.name).sort()).toEqual(['Alex', 'Sam']);
    // A cell that doesn't look like an email is dropped to null rather than rejected.
    expect(result.members.find((m) => m.name === 'Sam')!.email).toBeNull();
    expect(result.members.find((m) => m.name === 'Alex')!.email).toBe('alex@example.com');
  });

  it('skips rows with a blank name in the mapped column', async () => {
    const created = await createOrder(minimalInput());

    const result = await importRosterMembers(
      created.orderId,
      [
        ['', '7', ''],
        ['  ', '8', ''],
        ['Alex', '9', ''],
      ],
      mapping,
    );

    expect(result.imported).toBe(1);
    expect(result.skippedBlank).toBe(2);
  });

  it('treats a same-name row as a confirmed duplicate when its number also matches', async () => {
    const created = await createOrder(minimalInput());
    await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });

    const result = await importRosterMembers(created.orderId, [['alex', '7', '']], mapping);

    expect(result.needsConfirmation).toBeUndefined();
    expect(result.imported).toBe(0);
    expect(result.skippedDuplicate).toBe(1);
  });

  it('treats a same-name row as a confirmed duplicate when its email also matches', async () => {
    const created = await createOrder(minimalInput());
    await addRosterMember(created.orderId, { name: 'Alex', email: 'alex@example.com' });

    const result = await importRosterMembers(created.orderId, [['alex', '', 'ALEX@example.com']], mapping);

    expect(result.imported).toBe(0);
    expect(result.skippedDuplicate).toBe(1);
  });

  it('flags a same-name row with differing details as ambiguous and inserts nothing until resolved', async () => {
    const created = await createOrder(minimalInput());
    await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });

    const result = await importRosterMembers(
      created.orderId,
      [
        ['Alex', '23', ''], // same name, different number — could be a different person
        ['Sam', '9', ''], // unambiguous, but held back too since nothing commits until resolved
      ],
      mapping,
    );

    expect(result.needsConfirmation).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.members).toEqual([]);
    expect(result.ambiguousDuplicates).toEqual([
      { name: 'Alex', existingNumber: '7', existingEmail: null, newNumber: '23', newEmail: null },
    ]);
  });

  it('flags within-file same-name rows with differing numbers as ambiguous', async () => {
    const created = await createOrder(minimalInput());

    const result = await importRosterMembers(
      created.orderId,
      [
        ['Sam', '9', ''],
        ['SAM', '10', ''], // same name as the row above, different number
      ],
      mapping,
    );

    expect(result.needsConfirmation).toBe(true);
    expect(result.ambiguousDuplicates).toHaveLength(1);
  });

  it('resolution "importAll" inserts ambiguous rows as separate members', async () => {
    const created = await createOrder(minimalInput());
    await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });

    const result = await importRosterMembers(created.orderId, [['Alex', '23', '']], mapping, 'importAll');

    expect(result.needsConfirmation).toBeUndefined();
    expect(result.imported).toBe(1);
    expect(result.members[0].playerNumber).toBe('23');
  });

  it('resolution "skipAmbiguous" skips ambiguous rows without inserting them', async () => {
    const created = await createOrder(minimalInput());
    await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });

    const result = await importRosterMembers(created.orderId, [['Alex', '23', '']], mapping, 'skipAmbiguous');

    expect(result.imported).toBe(0);
    expect(result.skippedAmbiguous).toBe(1);
  });

  it('continues sortOrder after existing members', async () => {
    const created = await createOrder(minimalInput());
    await addRosterMember(created.orderId, { name: 'Existing' }); // sortOrder 0

    const result = await importRosterMembers(created.orderId, [['Alex', '', '']], mapping);

    expect(result.members[0].sortOrder).toBe(1);
  });

  it('leaves playerNumber/email null when their columns are not mapped', async () => {
    const created = await createOrder(minimalInput());

    const result = await importRosterMembers(created.orderId, [['Alex', '7', 'alex@example.com']], {
      nameColumn: 0,
      playerNumberColumn: null,
      emailColumn: null,
    });

    expect(result.members[0].playerNumber).toBeNull();
    expect(result.members[0].email).toBeNull();
  });

  it('emits a roster.import_completed audit event with counts', async () => {
    const created = await createOrder(minimalInput());

    await importRosterMembers(
      created.orderId,
      [
        ['Alex', '', ''],
        ['', '', ''],
      ],
      mapping,
    );

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const importEvent = events.find((e) => e.eventType === 'roster.import_completed');
    expect(importEvent).toBeDefined();
    expect(importEvent!.payload).toMatchObject({ imported: 1, skippedBlank: 1, skippedDuplicate: 0 });
  });
});
