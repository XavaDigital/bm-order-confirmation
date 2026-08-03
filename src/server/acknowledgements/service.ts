/**
 * Admin-editable acknowledgement settings (David, 2026-08-03): the customer
 * confirmation checkboxes, each with a bold title + wording, editable on a
 * settings page instead of living in code. Deactivate-never-delete — past
 * confirmations reference the key, and the agreed title/wording is
 * snapshotted per confirmation so edits never rewrite history.
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { acknowledgementSettings } from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';
import { recordAuditEvent } from '@/server/events/outbox';
import { NotFoundError, ConflictError } from '@/server/orders/service';

export interface AckSetting {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
  isActive: boolean;
}

const row = {
  id: acknowledgementSettings.id,
  key: acknowledgementSettings.key,
  title: acknowledgementSettings.title,
  body: acknowledgementSettings.body,
  sortOrder: acknowledgementSettings.sortOrder,
  isActive: acknowledgementSettings.isActive,
};

/** The customer-facing set, in display order. */
export async function listActiveAcknowledgements(): Promise<AckSetting[]> {
  return db
    .select(row)
    .from(acknowledgementSettings)
    .where(eq(acknowledgementSettings.isActive, true))
    .orderBy(asc(acknowledgementSettings.sortOrder), asc(acknowledgementSettings.createdAt));
}

/** Every setting including deactivated — the admin settings page. */
export async function listAllAcknowledgements(): Promise<AckSetting[]> {
  return db
    .select(row)
    .from(acknowledgementSettings)
    .orderBy(asc(acknowledgementSettings.sortOrder), asc(acknowledgementSettings.createdAt));
}

/** Slug for a new setting: from the title, unique-suffixed on collision. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'ack';
}

export async function createAcknowledgement(
  input: { title: string; body: string },
  meta?: { actorEmail?: string },
): Promise<AckSetting> {
  const all = await listAllAcknowledgements();
  const nextSort = all.length ? Math.max(...all.map((a) => a.sortOrder)) + 1 : 0;

  const base = slugify(input.title);
  for (let attempt = 0; ; attempt++) {
    const key = attempt === 0 ? base : `${base}_${attempt + 1}`;
    try {
      const [created] = await db
        .insert(acknowledgementSettings)
        .values({ key, title: input.title, body: input.body, sortOrder: nextSort })
        .returning(row);

      await recordAuditEvent({
        aggregateId: created.id,
        aggregateType: 'acknowledgement_setting',
        eventType: 'ack_setting.created',
        payload: { key: created.key, title: created.title },
        actorEmail: meta?.actorEmail ?? null,
      });
      return created;
    } catch (err) {
      if (attempt < 5 && isUniqueViolation(err, 'acknowledgement_settings_key_unique')) continue;
      throw err;
    }
  }
}

export async function updateAcknowledgement(
  id: string,
  patch: { title?: string; body?: string; isActive?: boolean; sortOrder?: number },
  meta?: { actorEmail?: string },
): Promise<AckSetting> {
  const [existing] = await db
    .select(row)
    .from(acknowledgementSettings)
    .where(eq(acknowledgementSettings.id, id));
  if (!existing) throw new NotFoundError('Acknowledgement');

  // Never leave the customer page ack-less by accident: the LAST active
  // acknowledgment cannot be deactivated (add/activate another first).
  if (patch.isActive === false && existing.isActive) {
    const active = await listActiveAcknowledgements();
    if (active.length === 1 && active[0].id === id) {
      throw new ConflictError('At least one acknowledgment must stay active');
    }
  }

  const [updated] = await db
    .update(acknowledgementSettings)
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.body !== undefined && { body: patch.body }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
      updatedAt: new Date(),
    })
    .where(eq(acknowledgementSettings.id, id))
    .returning(row);

  await recordAuditEvent({
    aggregateId: id,
    aggregateType: 'acknowledgement_setting',
    eventType: 'ack_setting.updated',
    payload: { fields: Object.keys(patch), key: existing.key },
    actorEmail: meta?.actorEmail ?? null,
  });
  return updated;
}
