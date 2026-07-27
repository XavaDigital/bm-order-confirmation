import { describe, expect, it } from 'vitest';
import type { StageRow, StageTaskRow } from './stages';
import {
  PROTECTED_STAGE_SLUGS,
  defaultStageFor,
  effectivePolicy,
  isProtectedStage,
  isSameStatusMove,
  resolveStage,
  stagesForStatus,
} from './stages';

function stage(overrides: Partial<StageRow> & Pick<StageRow, 'slug' | 'statusKey'>): StageRow {
  return {
    id: `id-${overrides.slug}`,
    boardKey: 'order',
    name: overrides.slug,
    advancesToStatus: null,
    sortOrder: 0,
    color: null,
    isActive: true,
    isTerminal: false,
    warnAfterHours: null,
    urgentAfterHours: null,
    defaultConfirmationPolicy: 'any',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as StageRow;
}

function task(overrides: Partial<StageTaskRow> = {}): StageTaskRow {
  return {
    id: 'task-1',
    stageId: 'id-artwork',
    slug: 'artwork_approved',
    name: 'Artwork approved',
    description: null,
    isBlocking: true,
    confirmationPolicy: null,
    gateKeys: [],
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as StageTaskRow;
}

// The `confirmed` status carrying several stages is the case the whole design
// exists for, so it is the fixture.
const STAGES: StageRow[] = [
  stage({ slug: 'draft', statusKey: 'draft', sortOrder: 10 }),
  stage({ slug: 'sent', statusKey: 'sent', sortOrder: 20 }),
  stage({ slug: 'confirmed', statusKey: 'confirmed', sortOrder: 50 }),
  stage({ slug: 'artwork', statusKey: 'confirmed', sortOrder: 60 }),
  stage({ slug: 'digitising', statusKey: 'confirmed', sortOrder: 70 }),
  stage({ slug: 'retired', statusKey: 'confirmed', sortOrder: 80, isActive: false }),
  stage({ slug: 'cancelled', statusKey: 'cancelled', sortOrder: 200, isTerminal: true }),
];

describe('stagesForStatus', () => {
  it('returns a status group in board order', () => {
    expect(stagesForStatus(STAGES, 'confirmed').map((s) => s.slug)).toEqual([
      'confirmed',
      'artwork',
      'digitising',
    ]);
  });

  it('excludes inactive stages', () => {
    expect(stagesForStatus(STAGES, 'confirmed').map((s) => s.slug)).not.toContain('retired');
  });

  it('is empty for a status with no stages', () => {
    expect(stagesForStatus(STAGES, 'viewed')).toEqual([]);
  });

  // Equal sortOrder must not order randomly, or columns would shuffle per query.
  it('breaks sortOrder ties by slug', () => {
    const tied = [
      stage({ slug: 'beta', statusKey: 'x', sortOrder: 5 }),
      stage({ slug: 'alpha', statusKey: 'x', sortOrder: 5 }),
    ];
    expect(stagesForStatus(tied, 'x').map((s) => s.slug)).toEqual(['alpha', 'beta']);
  });
});

describe('defaultStageFor', () => {
  it('is the first active stage in the group', () => {
    expect(defaultStageFor(STAGES, 'confirmed')?.slug).toBe('confirmed');
  });

  // Deliberately positional, not by naming convention: inserting a new first
  // step should change the default without anyone renaming anything.
  it('follows a newly inserted first step', () => {
    const withEarlier = [...STAGES, stage({ slug: 'intake', statusKey: 'confirmed', sortOrder: 5 })];
    expect(defaultStageFor(withEarlier, 'confirmed')?.slug).toBe('intake');
  });

  it('skips an inactive first stage', () => {
    const stages = [
      stage({ slug: 'off', statusKey: 'x', sortOrder: 1, isActive: false }),
      stage({ slug: 'on', statusKey: 'x', sortOrder: 2 }),
    ];
    expect(defaultStageFor(stages, 'x')?.slug).toBe('on');
  });

  it('is null when a status has no active stage', () => {
    expect(defaultStageFor(STAGES, 'nonexistent')).toBeNull();
  });
});

describe('resolveStage', () => {
  it('honours a valid recorded slug', () => {
    expect(resolveStage(STAGES, 'confirmed', 'artwork')?.slug).toBe('artwork');
  });

  // No backfill was needed for existing rows, which is only true because this
  // resolves null.
  it('falls back to the default when nothing is recorded', () => {
    expect(resolveStage(STAGES, 'confirmed', null)?.slug).toBe('confirmed');
  });

  it('falls back when the recorded stage was deleted', () => {
    expect(resolveStage(STAGES, 'confirmed', 'no_such_stage')?.slug).toBe('confirmed');
  });

  it('falls back when the recorded stage was deactivated', () => {
    expect(resolveStage(STAGES, 'confirmed', 'retired')?.slug).toBe('confirmed');
  });

  /**
   * The important one: a row keeps its old slug when its status moves on. Showing
   * it in a column belonging to a different status would put the board and the
   * status visibly out of step — exactly the confusion this layering is meant to
   * avoid.
   */
  it('ignores a recorded stage that belongs to another status', () => {
    expect(resolveStage(STAGES, 'cancelled', 'artwork')?.slug).toBe('cancelled');
  });

  it('is null when the status has no stages at all', () => {
    expect(resolveStage(STAGES, 'viewed', 'artwork')).toBeNull();
  });
});

describe('effectivePolicy', () => {
  it('uses the task policy when set', () => {
    const stageRow = stage({ slug: 'artwork', statusKey: 'confirmed' });
    expect(effectivePolicy(task({ confirmationPolicy: 'all' }), stageRow)).toBe('all');
  });

  it('inherits the stage default when the task has none', () => {
    const stageRow = stage({
      slug: 'artwork',
      statusKey: 'confirmed',
      defaultConfirmationPolicy: 'all',
    });
    expect(effectivePolicy(task({ confirmationPolicy: null }), stageRow)).toBe('all');
  });
});

describe('isSameStatusMove', () => {
  it('is true within one status group', () => {
    expect(
      isSameStatusMove(
        stage({ slug: 'artwork', statusKey: 'confirmed' }),
        stage({ slug: 'digitising', statusKey: 'confirmed' }),
      ),
    ).toBe(true);
  });

  it('is false across a status boundary', () => {
    expect(
      isSameStatusMove(
        stage({ slug: 'draft', statusKey: 'draft' }),
        stage({ slug: 'sent', statusKey: 'sent' }),
      ),
    ).toBe(false);
  });
});

describe('PROTECTED_STAGE_SLUGS', () => {
  it('covers every order status', () => {
    expect([...PROTECTED_STAGE_SLUGS.order].sort()).toEqual(
      ['cancelled', 'changes_requested', 'confirmed', 'draft', 'sent', 'viewed'].sort(),
    );
  });

  it('covers every purchase-order status', () => {
    expect(PROTECTED_STAGE_SLUGS.purchase_order).toHaveLength(10);
  });

  it('identifies protected and unprotected slugs per board', () => {
    expect(isProtectedStage('order', 'draft')).toBe(true);
    expect(isProtectedStage('order', 'artwork')).toBe(false);
    // 'in_production' is a PO status, not an order one — boards are separate.
    expect(isProtectedStage('order', 'in_production')).toBe(false);
    expect(isProtectedStage('purchase_order', 'in_production')).toBe(true);
  });
});
