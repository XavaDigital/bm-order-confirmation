import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
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
import { listAllStages } from './stages';
import {
  WorkflowStageConflictError,
  createStage,
  reorderStages,
  statusKeysFor,
  updateStage,
} from './stage-admin';

afterEach(async () => {
  await resetTestDb(db);
});

describe('createStage', () => {
  it('adds a step under an existing status', async () => {
    const stage = await createStage({
      boardKey: 'purchase_order',
      name: 'Digitising',
      statusKey: 'pre_production',
    });

    expect(stage).toMatchObject({
      boardKey: 'purchase_order',
      name: 'Digitising',
      statusKey: 'pre_production',
      slug: 'digitising',
      isActive: true,
    });
  });

  /**
   * Statuses are the state machine every consumer depends on. A stage may only
   * sit under one that already exists — otherwise the board would show a column
   * no order could ever legally be in.
   */
  it('refuses a status the board does not have', async () => {
    await expect(
      createStage({ boardKey: 'purchase_order', name: 'Nonsense', statusKey: 'not_a_status' }),
    ).rejects.toBeInstanceOf(WorkflowStageConflictError);
  });

  it('refuses an order status on the purchase-order board', async () => {
    // 'changes_requested' is an ORDER status; the PO board has no such thing.
    await expect(
      createStage({ boardKey: 'purchase_order', name: 'Wrong board', statusKey: 'changes_requested' }),
    ).rejects.toBeInstanceOf(WorkflowStageConflictError);
  });

  it('derives a slug from the name and keeps it unique', async () => {
    const first = await createStage({
      boardKey: 'purchase_order',
      name: 'Colour Check',
      statusKey: 'pre_production',
    });
    const second = await createStage({
      boardKey: 'purchase_order',
      name: 'Colour Check',
      statusKey: 'pre_production',
    });

    expect(first.slug).toBe('colour_check');
    expect(second.slug).toBe('colour_check_2');
  });

  it('appends within the status group rather than the whole board', async () => {
    const stage = await createStage({
      boardKey: 'purchase_order',
      name: 'Digitising',
      statusKey: 'pre_production',
    });
    const seeded = (await listAllStages('purchase_order')).filter(
      (s) => s.statusKey === 'pre_production' && s.id !== stage.id,
    );

    for (const other of seeded) expect(stage.sortOrder).toBeGreaterThan(other.sortOrder);
  });
});

describe('updateStage', () => {
  it('renames without touching the slug', async () => {
    const stage = await createStage({
      boardKey: 'purchase_order',
      name: 'Artwork',
      statusKey: 'pre_production',
    });

    const renamed = await updateStage(stage.id, { name: 'Artwork & Layout' });

    expect(renamed.name).toBe('Artwork & Layout');
    // The slug is what order and PO rows carry — changing it would strand them.
    expect(renamed.slug).toBe(stage.slug);
  });

  it('retunes the stuck clocks and the confirmation policy', async () => {
    const stage = await createStage({
      boardKey: 'purchase_order',
      name: 'Artwork',
      statusKey: 'pre_production',
    });

    const updated = await updateStage(stage.id, {
      warnAfterHours: 24,
      urgentAfterHours: 72,
      defaultConfirmationPolicy: 'all',
    });

    expect(updated).toMatchObject({
      warnAfterHours: 24,
      urgentAfterHours: 72,
      defaultConfirmationPolicy: 'all',
    });
  });

  it('retires a stage that staff added', async () => {
    const stage = await createStage({
      boardKey: 'purchase_order',
      name: 'Digitising',
      statusKey: 'pre_production',
    });

    expect((await updateStage(stage.id, { isActive: false })).isActive).toBe(false);
  });

  /**
   * The one-per-status seeded stages are what `defaultStageFor` falls back to.
   * Deactivate one and every card in that status has nowhere to render — they
   * drop off the board silently, which is exactly the failure the board's
   * "could not be placed" banner exists to report.
   */
  it('refuses to deactivate a protected fallback stage', async () => {
    const [protectedStage] = (await listAllStages('purchase_order')).filter(
      (s) => s.slug === 'in_production',
    );

    await expect(updateStage(protectedStage.id, { isActive: false })).rejects.toBeInstanceOf(
      WorkflowStageConflictError,
    );
  });

  it('still allows a protected stage to be renamed and recoloured', async () => {
    const [protectedStage] = (await listAllStages('purchase_order')).filter(
      (s) => s.slug === 'in_production',
    );

    const updated = await updateStage(protectedStage.id, {
      name: 'On the Floor',
      color: '#ff0000',
    });

    expect(updated).toMatchObject({ name: 'On the Floor', color: '#ff0000', slug: 'in_production' });
  });

  it('404s for a stage that does not exist', async () => {
    await expect(
      updateStage('11111111-1111-4111-8111-111111111111', { name: 'x' }),
    ).rejects.toMatchObject({ name: 'WorkflowStageNotFoundError' });
  });

  it('records who changed it', async () => {
    const stage = await createStage({
      boardKey: 'purchase_order',
      name: 'Artwork',
      statusKey: 'pre_production',
    });
    await updateStage(stage.id, { name: 'Artwork 2' }, { actorEmail: 'sam@beastmode.co.nz' });

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, stage.id));

    expect(events.map((e) => e.eventType)).toContain('workflow.stage_updated');
    expect(events.at(-1)?.actorEmail).toBe('sam@beastmode.co.nz');
  });
});

describe('reorderStages', () => {
  it('applies the given order', async () => {
    const stages = await listAllStages('purchase_order');
    const reversed = [...stages].reverse().map((s) => s.id);

    const result = await reorderStages('purchase_order', reversed);

    const byId = new Map(result.map((s) => [s.id, s.sortOrder]));
    for (let i = 1; i < reversed.length; i += 1) {
      expect(byId.get(reversed[i])!).toBeGreaterThan(byId.get(reversed[i - 1])!);
    }
  });

  it('refuses an ordering that names another board’s stages', async () => {
    const orderStage = (await listAllStages('order'))[0];

    await expect(reorderStages('purchase_order', [orderStage.id])).rejects.toBeInstanceOf(
      WorkflowStageConflictError,
    );
  });
});

describe('statusKeysFor', () => {
  // The editor offers these, so they must be the real state machine and not a
  // second copy that can drift from it.
  it('offers the order statuses for the order board', () => {
    expect(statusKeysFor('order')).toContain('changes_requested');
    expect(statusKeysFor('order')).not.toContain('in_production');
  });

  it('offers the purchase-order statuses for the PO board', () => {
    expect(statusKeysFor('purchase_order')).toContain('in_production');
    expect(statusKeysFor('purchase_order')).not.toContain('changes_requested');
  });
});
