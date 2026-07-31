import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

const { isEmailConfigured, sendNotificationEmail } = vi.hoisted(() => ({
  isEmailConfigured: vi.fn().mockReturnValue(true),
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/email', () => ({ isEmailConfigured, sendNotificationEmail }));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { htmlToPlainText } from '@/lib/rich-text';
import { sendPendingNotificationEmails } from './email-sender';

afterEach(async () => {
  vi.clearAllMocks();
  isEmailConfigured.mockReturnValue(true);
  sendNotificationEmail.mockResolvedValue(undefined);
  await resetTestDb(db);
});

async function seedStaff(email: string) {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ email, name: email.split('@')[0], passwordHash: 'x', role: 'sales', isActive: true })
    .returning();
  return row;
}

async function seedInboxItem(
  staffUserId: string,
  overrides: Partial<typeof schema.inboxItems.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.inboxItems)
    .values({
      staffUserId,
      eventKey: 'po.sent',
      title: 'A purchase order was sent',
      emailSubject: 'PO-1 has gone to the supplier',
      emailHtml: '<p>PO-1 has gone to the supplier</p>',
      ...overrides,
    })
    .returning();
  return row;
}

async function reload(id: string) {
  const [row] = await db.select().from(schema.inboxItems).where(eq(schema.inboxItems.id, id));
  return row;
}

describe('sendPendingNotificationEmails', () => {
  it('sends a staged email and clears the payload on success', async () => {
    const staff = await seedStaff('sales@x.com');
    const item = await seedInboxItem(staff.id);

    const result = await sendPendingNotificationEmails();

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(sendNotificationEmail).toHaveBeenCalledWith({
      to: staff.email,
      toName: staff.name,
      subject: item.emailSubject,
      html: item.emailHtml,
      text: htmlToPlainText(item.emailHtml),
    });

    const after = await reload(item.id);
    expect(after.emailSentAt).not.toBeNull();
    expect(after.emailSubject).toBeNull();
    expect(after.emailHtml).toBeNull();
  });

  it('increments emailAttempts and leaves the payload intact on failure', async () => {
    const staff = await seedStaff('sales@x.com');
    const item = await seedInboxItem(staff.id);
    sendNotificationEmail.mockRejectedValueOnce(new Error('smtp exploded'));

    const result = await sendPendingNotificationEmails();

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 });

    const after = await reload(item.id);
    expect(after.emailSentAt).toBeNull();
    expect(after.emailAttempts).toBe(1);
    expect(after.emailSubject).toBe(item.emailSubject);
    expect(after.emailHtml).toBe(item.emailHtml);
  });

  it('does not retry a row that has already hit the attempt cap', async () => {
    const staff = await seedStaff('sales@x.com');
    // MAX_ATTEMPTS in email-sender.ts is 5 — a row already there is exhausted.
    await seedInboxItem(staff.id, { emailAttempts: 5 });

    const result = await sendPendingNotificationEmails();

    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('does nothing when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const staff = await seedStaff('sales@x.com');
    await seedInboxItem(staff.id);

    const result = await sendPendingNotificationEmails();

    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('ignores rows that are in-app only (no email staged)', async () => {
    const staff = await seedStaff('sales@x.com');
    await seedInboxItem(staff.id, { emailSubject: null, emailHtml: null });

    const result = await sendPendingNotificationEmails();

    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });
});
