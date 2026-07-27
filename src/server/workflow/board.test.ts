import { describe, expect, it } from 'vitest';
import type { StageRow } from './stages';
import { buildColumns, clockForStage, hoursBetween, stageUrgency, type BoardCard } from './board';

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

const NOW = new Date('2026-07-20T12:00:00Z');
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

const STAGES: StageRow[] = [
  stage({ slug: 'draft', statusKey: 'draft', sortOrder: 10 }),
  stage({ slug: 'confirmed', statusKey: 'confirmed', sortOrder: 50 }),
  stage({ slug: 'artwork', statusKey: 'confirmed', sortOrder: 60 }),
  stage({ slug: 'done', statusKey: 'completed', sortOrder: 90, isTerminal: true }),
];

const card = (row: { id: string }, s: StageRow): BoardCard =>
  ({ id: row.id, stageSlug: s.slug }) as BoardCard;

describe('hoursBetween', () => {
  it('measures elapsed hours', () => {
    expect(hoursBetween(hoursAgo(5), NOW)).toBe(5);
  });

  it('is negative for a future timestamp', () => {
    expect(hoursBetween(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(-1);
  });
});

describe('stageUrgency', () => {
  const tuned = stage({
    slug: 'artwork',
    statusKey: 'confirmed',
    warnAfterHours: 48,
    urgentAfterHours: 96,
  });

  it('is ok below the warn threshold', () => {
    expect(stageUrgency(tuned, hoursAgo(10), NOW).urgency).toBe('ok');
  });

  it('warns at the threshold, not just past it', () => {
    expect(stageUrgency(tuned, hoursAgo(48), NOW).urgency).toBe('warn');
  });

  it('escalates to urgent at its threshold', () => {
    expect(stageUrgency(tuned, hoursAgo(96), NOW).urgency).toBe('urgent');
    expect(stageUrgency(tuned, hoursAgo(500), NOW).urgency).toBe('urgent');
  });

  it('reports the hours it has been sitting there', () => {
    expect(stageUrgency(tuned, hoursAgo(72), NOW).hoursInStage).toBe(72);
  });

  // A card that has never been staged has no clock; showing an age would invent
  // one from nothing.
  it('is ok with a null age when the row was never staged', () => {
    const result = stageUrgency(tuned, null, NOW);
    expect(result.urgency).toBe('ok');
    expect(result.hoursInStage).toBeNull();
  });

  // Nothing is expected to leave a terminal stage, so flagging it would train
  // people to ignore the colour everywhere else.
  it('never flags a terminal stage, however long it sits', () => {
    const terminal = stage({
      slug: 'done',
      statusKey: 'completed',
      isTerminal: true,
      warnAfterHours: 1,
      urgentAfterHours: 2,
    });
    expect(stageUrgency(terminal, hoursAgo(10_000), NOW).urgency).toBe('ok');
  });

  it('falls back to the generous default when a stage sets no thresholds', () => {
    const untuned = stage({ slug: 'x', statusKey: 'confirmed' });
    expect(stageUrgency(untuned, hoursAgo(24), NOW).urgency).toBe('ok');
    expect(stageUrgency(untuned, hoursAgo(7 * 24), NOW).urgency).toBe('warn');
    expect(stageUrgency(untuned, hoursAgo(14 * 24), NOW).urgency).toBe('urgent');
  });

  it('honours a warn threshold with no urgent threshold', () => {
    const partial = stage({ slug: 'x', statusKey: 'confirmed', warnAfterHours: 2 });
    expect(stageUrgency(partial, hoursAgo(3), NOW).urgency).toBe('warn');
  });
});

describe('buildColumns', () => {
  it('creates one column per stage, in the order given', () => {
    const { columns } = buildColumns(STAGES, [], card);
    expect(columns.map((c) => c.slug)).toEqual(['draft', 'confirmed', 'artwork', 'done']);
  });

  it('places a card in its recorded stage', () => {
    const rows = [{ id: 'a', status: 'confirmed', workflowStageSlug: 'artwork' }];
    const { columns } = buildColumns(STAGES, rows, card);

    expect(columns.find((c) => c.slug === 'artwork')!.cards.map((c) => c.id)).toEqual(['a']);
    expect(columns.find((c) => c.slug === 'confirmed')!.cards).toEqual([]);
  });

  // Why no backfill was needed for existing rows.
  it('places an unstaged card in its status default', () => {
    const rows = [{ id: 'a', status: 'confirmed', workflowStageSlug: null }];
    const { columns } = buildColumns(STAGES, rows, card);

    expect(columns.find((c) => c.slug === 'confirmed')!.cards.map((c) => c.id)).toEqual(['a']);
  });

  // A stale slug from before the status moved must not put the card in a column
  // belonging to another status.
  it('re-homes a card whose recorded stage belongs to another status', () => {
    const rows = [{ id: 'a', status: 'draft', workflowStageSlug: 'artwork' }];
    const { columns } = buildColumns(STAGES, rows, card);

    expect(columns.find((c) => c.slug === 'draft')!.cards.map((c) => c.id)).toEqual(['a']);
    expect(columns.find((c) => c.slug === 'artwork')!.cards).toEqual([]);
  });

  it('never puts one card in two columns', () => {
    const rows = [
      { id: 'a', status: 'confirmed', workflowStageSlug: 'artwork' },
      { id: 'b', status: 'confirmed', workflowStageSlug: null },
      { id: 'c', status: 'draft', workflowStageSlug: 'nonsense' },
    ];
    const { columns } = buildColumns(STAGES, rows, card);

    const placements = columns.flatMap((c) => c.cards.map((k) => k.id));
    expect(placements).toHaveLength(3);
    expect(new Set(placements).size).toBe(3);
  });

  // Counted, not silently dropped: a card that vanishes from the board is worse
  // than one reported as misfiled.
  it('counts a card whose status has no active stage instead of dropping it', () => {
    const rows = [{ id: 'ghost', status: 'no_such_status', workflowStageSlug: null }];
    const { columns, orphanedCount } = buildColumns(STAGES, rows, card);

    expect(orphanedCount).toBe(1);
    expect(columns.flatMap((c) => c.cards)).toEqual([]);
  });

  it('reports zero orphans for a healthy board', () => {
    const rows = [{ id: 'a', status: 'confirmed', workflowStageSlug: 'artwork' }];
    expect(buildColumns(STAGES, rows, card).orphanedCount).toBe(0);
  });

  it('preserves the row order it was given within a column', () => {
    const rows = [
      { id: 'first', status: 'confirmed', workflowStageSlug: 'artwork' },
      { id: 'second', status: 'confirmed', workflowStageSlug: 'artwork' },
    ];
    const { columns } = buildColumns(STAGES, rows, card);
    expect(columns.find((c) => c.slug === 'artwork')!.cards.map((c) => c.id)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('clockForStage', () => {
  const entered = new Date('2026-07-18T09:00:00Z');

  it('keeps the clock when the card is in the stage it recorded', () => {
    expect(clockForStage('artwork', 'artwork', entered)).toEqual(entered);
  });

  /**
   * The case that matters: a customer confirms their order, so the status moves
   * without the board being touched and the row still carries the slug of its
   * previous stage. Trusting that timestamp would date the card from when it
   * entered a stage it has since left, inflating the age and making
   * freshly-advanced work look stuck.
   */
  it('discards a clock belonging to a stage the card has left', () => {
    expect(clockForStage('confirmed', 'sent', entered)).toBeNull();
  });

  it('reports unknown for a card that was never staged', () => {
    expect(clockForStage('confirmed', null, null)).toBeNull();
  });

  it('does not invent a clock for an unstaged card that somehow has a timestamp', () => {
    expect(clockForStage('confirmed', null, entered)).toBeNull();
  });
});
