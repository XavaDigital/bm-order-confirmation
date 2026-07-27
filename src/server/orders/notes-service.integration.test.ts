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
import { createOrderSchema } from './contract';
import { createOrder, duplicateOrder, getOrderAdmin } from './service';
import {
  addOrderNote,
  countGarmentNotes,
  deleteOrderNote,
  listOrderNotes,
  listRecentOrderNotes,
  updateOrderNote,
} from './notes-service';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedStaff(email: string, name = 'Sam Sales') {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ email, name, passwordHash: 'x', role: 'sales' })
    .returning();
  return row;
}

async function seedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey' }, { name: 'Shorts' }],
    }),
  );
  const order = await getOrderAdmin(created.orderId);
  return {
    orderId: created.orderId,
    garmentId: order!.garments[0].id,
    otherGarmentId: order!.garments[1].id,
  };
}

async function staffNote(orderId: string, body: string, staffId: string, garmentId?: string) {
  return addOrderNote(
    orderId,
    { body, authorKind: 'staff', authorLabel: 'sam@x.com', garmentId, isHtml: true },
    { actorEmail: 'sam@x.com', actorStaffUserId: staffId },
  );
}

describe('addOrderNote', () => {
  it('stores sanitised HTML and a plain-text copy', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');

    const note = await staffNote(
      orderId,
      '<p>Use the <strong>navy</strong> thread</p><script>alert(1)</script>',
      staff.id,
    );

    expect(note.bodyHtml).toBe('<p>Use the <strong>navy</strong> thread</p>');
    expect(note.body).toBe('Use the navy thread');
  });

  // The service is the sanitisation layer, so a payload that never touched our
  // editor is still cleaned. This is the test that matters most here.
  it('never persists a script, even though the route did not sanitise', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');

    await staffNote(orderId, '<p onclick="steal()">hi</p><script>alert(1)</script>', staff.id);

    const [row] = await db.select().from(schema.orderNotes);
    expect(row.bodyHtml).not.toContain('script');
    expect(row.bodyHtml).not.toContain('onclick');
    expect(row.body).not.toContain('alert');
  });

  it('attributes the note to the staff user', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com', 'Sam Sales');

    const note = await staffNote(orderId, '<p>hi</p>', staff.id);

    expect(note.authorStaffUserId).toBe(staff.id);
    expect(note.authorName).toBe('Sam Sales');
    expect(note.authorEmail).toBe('sam@x.com');
    expect(note.authorKind).toBe('staff');
  });

  it('attaches a note to a garment of the order', async () => {
    const { orderId, garmentId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');

    const note = await staffNote(orderId, '<p>collar too tight</p>', staff.id, garmentId);

    expect(note.garmentId).toBe(garmentId);
    expect(note.garmentName).toBe('Home Jersey');
  });

  it('refuses a garment from a different order', async () => {
    const { orderId } = await seedOrder();
    const other = await seedOrder();
    const staff = await seedStaff('sam@x.com');

    await expect(staffNote(orderId, '<p>x</p>', staff.id, other.garmentId)).rejects.toThrow(
      'does not belong to this order',
    );
  });

  it('rejects a note that is only markup', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');

    await expect(staffNote(orderId, '<p><br></p>', staff.id)).rejects.toThrow('Note is empty');
    expect(await db.select().from(schema.orderNotes)).toHaveLength(0);
  });

  it('throws NotFoundError for an unknown order', async () => {
    const staff = await seedStaff('sam@x.com');
    await expect(
      staffNote('00000000-0000-0000-0000-000000000000', '<p>x</p>', staff.id),
    ).rejects.toThrow('Order not found');
  });

  // Email Flow posts plain text and has no staff row; it must keep working
  // unchanged now that the table carries HTML and an author FK.
  it('accepts a plain-text note from the capability surface', async () => {
    const { orderId } = await seedOrder();

    const note = await addOrderNote(orderId, {
      body: 'Customer called about sizing',
      authorKind: 'email_flow',
      authorLabel: 'acting-user-uuid',
    });

    expect(note.bodyHtml).toBeNull();
    expect(note.body).toBe('Customer called about sizing');
    expect(note.authorStaffUserId).toBeNull();
    expect(note.authorEmail).toBe('acting-user-uuid');
  });

  it('emits order.note_added once, and no audit row (the timeline merges both)', async () => {
    const { orderId, garmentId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');

    const note = await staffNote(orderId, '<p>hi</p>', staff.id, garmentId);

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.eventType, 'order.note_added'));
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ noteId: note.id, garmentId });

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'note.added'));
    expect(audit).toHaveLength(0);
  });
});

describe('listOrderNotes', () => {
  it('defaults to the order-wide thread, excluding garment notes', async () => {
    const { orderId, garmentId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>order note</p>', staff.id);
    await staffNote(orderId, '<p>garment note</p>', staff.id, garmentId);

    const notes = await listOrderNotes(orderId);

    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('order note');
  });

  it('reads one garment thread', async () => {
    const { orderId, garmentId, otherGarmentId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>jersey</p>', staff.id, garmentId);
    await staffNote(orderId, '<p>shorts</p>', staff.id, otherGarmentId);

    const notes = await listOrderNotes(orderId, { garmentId });

    expect(notes.map((n) => n.body)).toEqual(['jersey']);
  });

  it("reads everything with scope 'all'", async () => {
    const { orderId, garmentId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>order</p>', staff.id);
    await staffNote(orderId, '<p>jersey</p>', staff.id, garmentId);

    expect(await listOrderNotes(orderId, 'all')).toHaveLength(2);
  });

  it('never returns another order’s notes', async () => {
    const { orderId } = await seedOrder();
    const other = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(other.orderId, '<p>theirs</p>', staff.id);

    expect(await listOrderNotes(orderId, 'all')).toHaveLength(0);
  });

  // Chat order: the newest message belongs at the bottom, next to the composer.
  it('returns oldest first', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>first</p>', staff.id);
    await staffNote(orderId, '<p>second</p>', staff.id);

    const notes = await listOrderNotes(orderId);
    expect(notes.map((n) => n.body)).toEqual(['first', 'second']);
  });

  it('marks a fresh note as not edited', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>hi</p>', staff.id);

    expect((await listOrderNotes(orderId))[0].edited).toBe(false);
  });
});

describe('updateOrderNote', () => {
  it('rewrites the body and flags the note as edited', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    const note = await staffNote(orderId, '<p>navy</p>', staff.id);

    // Force a gap the `edited` heuristic can see (it allows 1s of slack for
    // createdAt/updatedAt both defaulting to now()).
    await db
      .update(schema.orderNotes)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.orderNotes.id, note.id));

    const updated = await updateOrderNote(orderId, note.id, '<p>royal <em>blue</em></p>', {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    expect(updated.bodyHtml).toBe('<p>royal <em>blue</em></p>');
    expect(updated.body).toBe('royal blue');
    expect(updated.edited).toBe(true);
  });

  it('sanitises the edit too', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    const note = await staffNote(orderId, '<p>ok</p>', staff.id);

    const updated = await updateOrderNote(orderId, note.id, '<p>x</p><script>alert(1)</script>', {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    expect(updated.bodyHtml).not.toContain('script');
  });

  // An edited note still carries the original author's name, so rewriting
  // someone else's words under their byline is not something admins get either.
  it('refuses an edit by anyone but the author, admin included', async () => {
    const { orderId } = await seedOrder();
    const author = await seedStaff('sam@x.com');
    const other = await seedStaff('boss@x.com', 'Boss');
    const note = await staffNote(orderId, '<p>mine</p>', author.id);

    await expect(
      updateOrderNote(orderId, note.id, '<p>theirs</p>', {
        actorEmail: 'boss@x.com',
        actorStaffUserId: other.id,
        isAdmin: true,
      }),
    ).rejects.toThrow('only edit your own notes');
  });

  it('refuses an empty edit', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    const note = await staffNote(orderId, '<p>real</p>', staff.id);

    await expect(
      updateOrderNote(orderId, note.id, '<p><br></p>', {
        actorEmail: 'sam@x.com',
        actorStaffUserId: staff.id,
      }),
    ).rejects.toThrow('Note is empty');
  });

  it('records an audit row with the actor', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    const note = await staffNote(orderId, '<p>a</p>', staff.id);

    await updateOrderNote(orderId, note.id, '<p>b</p>', {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'note.edited'));
    expect(audit).toHaveLength(1);
    expect(audit[0].actorEmail).toBe('sam@x.com');
    expect(audit[0].aggregateId).toBe(orderId);
  });

  // A note id from another order must not be reachable through this order's URL.
  it('404s for a note belonging to a different order', async () => {
    const { orderId } = await seedOrder();
    const other = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    const note = await staffNote(other.orderId, '<p>theirs</p>', staff.id);

    await expect(
      updateOrderNote(orderId, note.id, '<p>x</p>', {
        actorEmail: 'sam@x.com',
        actorStaffUserId: staff.id,
      }),
    ).rejects.toThrow('Note not found');
  });
});

describe('deleteOrderNote', () => {
  it('soft-deletes, keeping the row but dropping the content', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    const note = await staffNote(orderId, '<p>oops</p>', staff.id);

    await deleteOrderNote(orderId, note.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    const rows = await db.select().from(schema.orderNotes);
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();

    // The thread keeps its shape, but the words are gone from the projection.
    const [dto] = await listOrderNotes(orderId);
    expect(dto.deleted).toBe(true);
    expect(dto.body).toBe('');
    expect(dto.bodyHtml).toBeNull();
  });

  it('lets an admin remove someone else’s note', async () => {
    const { orderId } = await seedOrder();
    const author = await seedStaff('sam@x.com');
    const admin = await seedStaff('boss@x.com', 'Boss');
    const note = await staffNote(orderId, '<p>mine</p>', author.id);

    await deleteOrderNote(orderId, note.id, {
      actorEmail: 'boss@x.com',
      actorStaffUserId: admin.id,
      isAdmin: true,
    });

    expect((await listOrderNotes(orderId))[0].deleted).toBe(true);
  });

  it('refuses a non-author, non-admin', async () => {
    const { orderId } = await seedOrder();
    const author = await seedStaff('sam@x.com');
    const other = await seedStaff('pat@x.com', 'Pat');
    const note = await staffNote(orderId, '<p>mine</p>', author.id);

    await expect(
      deleteOrderNote(orderId, note.id, {
        actorEmail: 'pat@x.com',
        actorStaffUserId: other.id,
      }),
    ).rejects.toThrow('only delete your own notes');
  });

  it('is idempotent', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    const note = await staffNote(orderId, '<p>x</p>', staff.id);
    const meta = { actorEmail: 'sam@x.com', actorStaffUserId: staff.id };

    await deleteOrderNote(orderId, note.id, meta);
    await expect(deleteOrderNote(orderId, note.id, meta)).resolves.toBeUndefined();

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'note.deleted'));
    expect(audit).toHaveLength(1);
  });

  it('records who deleted it and whether it was an admin', async () => {
    const { orderId } = await seedOrder();
    const author = await seedStaff('sam@x.com');
    const admin = await seedStaff('boss@x.com', 'Boss');
    const note = await staffNote(orderId, '<p>mine</p>', author.id);

    await deleteOrderNote(orderId, note.id, {
      actorEmail: 'boss@x.com',
      actorStaffUserId: admin.id,
      isAdmin: true,
    });

    const [audit] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'note.deleted'));
    expect(audit.actorEmail).toBe('boss@x.com');
    expect(audit.payload).toMatchObject({ byAdmin: true });
  });
});

describe('listRecentOrderNotes / countGarmentNotes', () => {
  it('previews the newest live notes, newest first', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    for (const body of ['one', 'two', 'three', 'four']) {
      await staffNote(orderId, `<p>${body}</p>`, staff.id);
    }

    const recent = await listRecentOrderNotes(orderId, 2);

    expect(recent.map((n) => n.body)).toEqual(['four', 'three']);
  });

  it('excludes deleted notes from the preview', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    const note = await staffNote(orderId, '<p>gone</p>', staff.id);
    await staffNote(orderId, '<p>kept</p>', staff.id);
    await deleteOrderNote(orderId, note.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    expect((await listRecentOrderNotes(orderId)).map((n) => n.body)).toEqual(['kept']);
  });

  it('counts live notes per garment', async () => {
    const { orderId, garmentId, otherGarmentId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>order-wide</p>', staff.id);
    await staffNote(orderId, '<p>a</p>', staff.id, garmentId);
    await staffNote(orderId, '<p>b</p>', staff.id, garmentId);
    const gone = await staffNote(orderId, '<p>c</p>', staff.id, otherGarmentId);
    await deleteOrderNote(orderId, gone.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    const counts = await countGarmentNotes(orderId);

    // Order-wide notes are not counted against any garment, and the deleted one
    // drops out entirely rather than leaving a 0.
    expect(counts).toEqual({ [garmentId]: 2 });
  });
});

describe('duplicates and reprints', () => {
  // Design files carry forward to a reprint because the factory needs them. The
  // conversation does not: it was about the original job, and appearing on a new
  // order would read as history that never happened there.
  it('does not copy the thread onto a duplicate or a reprint', async () => {
    const { orderId, garmentId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>customer haggled on price</p>', staff.id);
    await staffNote(orderId, '<p>collar runs small</p>', staff.id, garmentId);

    const reprint = await duplicateOrder(orderId, undefined, { reprint: true });
    const plain = await duplicateOrder(orderId);

    expect(await listOrderNotes(reprint.orderId, 'all')).toHaveLength(0);
    expect(await listOrderNotes(plain.orderId, 'all')).toHaveLength(0);
    // Still intact on the original.
    expect(await listOrderNotes(orderId, 'all')).toHaveLength(2);
  });
});

describe('cascades', () => {
  it('deletes garment notes when the garment goes', async () => {
    const { orderId, garmentId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>order-wide</p>', staff.id);
    await staffNote(orderId, '<p>on the jersey</p>', staff.id, garmentId);

    await db.delete(schema.garments).where(eq(schema.garments.id, garmentId));

    const remaining = await listOrderNotes(orderId, 'all');
    expect(remaining.map((n) => n.body)).toEqual(['order-wide']);
  });

  // Deleting a user must not erase what they said — the FK has no cascade.
  it('refuses to delete a staff user who has written notes', async () => {
    const { orderId } = await seedOrder();
    const staff = await seedStaff('sam@x.com');
    await staffNote(orderId, '<p>said something</p>', staff.id);

    await expect(
      db.delete(schema.staffUsers).where(eq(schema.staffUsers.id, staff.id)),
    ).rejects.toThrow();

    expect(await listOrderNotes(orderId)).toHaveLength(1);
  });
});
