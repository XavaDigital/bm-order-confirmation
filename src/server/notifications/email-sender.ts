/**
 * Drains the email side of the notifications inbox.
 *
 * `dispatchNotification` (dispatch.ts) writes the in-app inbox row AND, when
 * the event has email on, stages `emailSubject`/`emailHtml` on that same row.
 * It never sends the email itself — sending is slow, can fail, and must not
 * hold open the outbox processor's batch transaction that `dispatchNotification`
 * runs inside. This is the separate pass that does the sending, on its own
 * schedule (see `src/server/scheduler/runtime.ts`).
 *
 * Shape mirrors `src/server/events/processor.ts`: claim a batch with
 * FOR UPDATE SKIP LOCKED so an overlapping tick can't send the same row twice,
 * tolerate one row's failure without stopping the batch, cap retries.
 */
import { and, asc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { db } from '@/db';
import { inboxItems, staffUsers } from '@/db/schema';
import { isEmailConfigured, sendNotificationEmail } from '@/lib/email';
import { logger } from '@/lib/logger';
import { htmlToPlainText } from '@/lib/rich-text';

const BATCH_SIZE = 20;

// No backoff timestamp: inbox_items has no nextAttemptAt column, and the job's
// own tick interval is the retry spacing. Past MAX_ATTEMPTS a row is left
// alone (subject/html intact, so it's still visible for a human to redrive
// manually) rather than dead-lettered into a separate state.
const MAX_ATTEMPTS = 5;

export interface EmailSendResult {
  processed: number;
  sent: number;
  failed: number;
}

export async function sendPendingNotificationEmails(): Promise<EmailSendResult> {
  if (!isEmailConfigured()) return { processed: 0, sent: 0, failed: 0 };

  return db.transaction(async (tx) => {
    const due = await tx
      .select({
        id: inboxItems.id,
        staffUserId: inboxItems.staffUserId,
        emailSubject: inboxItems.emailSubject,
        emailHtml: inboxItems.emailHtml,
        emailAttempts: inboxItems.emailAttempts,
      })
      .from(inboxItems)
      .where(
        and(
          isNotNull(inboxItems.emailSubject),
          isNull(inboxItems.emailSentAt),
          lt(inboxItems.emailAttempts, MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(inboxItems.createdAt))
      .limit(BATCH_SIZE)
      .for('update', { skipLocked: true });

    let sent = 0;
    let failed = 0;

    for (const row of due) {
      if (!row.emailSubject || !row.emailHtml) continue;

      const [staffUser] = await tx
        .select({ email: staffUsers.email, name: staffUsers.name })
        .from(staffUsers)
        .where(eq(staffUsers.id, row.staffUserId));

      if (!staffUser) {
        // Staff row is gone (cascade-deleted) — nothing to send to; drop the
        // stale payload rather than retrying forever.
        await tx
          .update(inboxItems)
          .set({ emailSentAt: new Date(), emailSubject: null, emailHtml: null })
          .where(eq(inboxItems.id, row.id));
        continue;
      }

      try {
        await sendNotificationEmail({
          to: staffUser.email,
          toName: staffUser.name,
          subject: row.emailSubject,
          html: row.emailHtml,
          text: htmlToPlainText(row.emailHtml),
        });

        await tx
          .update(inboxItems)
          .set({ emailSentAt: new Date(), emailSubject: null, emailHtml: null })
          .where(eq(inboxItems.id, row.id));
        sent++;
      } catch (err) {
        logger.error(`[notifications] email send failed for inbox item ${row.id}:`, err);
        await tx
          .update(inboxItems)
          .set({ emailAttempts: row.emailAttempts + 1 })
          .where(eq(inboxItems.id, row.id));
        failed++;
      }
    }

    return { processed: due.length, sent, failed };
  });
}
