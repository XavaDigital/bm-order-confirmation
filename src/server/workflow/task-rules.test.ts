import { describe, expect, it } from 'vitest';
import {
  canLeaveStage,
  evaluateGateRules,
  isTaskSatisfied,
  nextStageInGroup,
  policyFor,
  tasksForGate,
  type CompletionShape,
  type StageShape,
  type TaskShape,
} from './task-rules';

function task(overrides: Partial<TaskShape> = {}): TaskShape {
  return {
    id: 't1',
    slug: 'artwork_approved',
    name: 'Artwork approved',
    isBlocking: true,
    confirmationPolicy: null,
    gateKeys: [],
    ...overrides,
  };
}

const by = (userId: string | null, taskId = 't1'): CompletionShape => ({
  taskId,
  confirmedByStaffUserId: userId,
});

function stage(overrides: Partial<StageShape> & Pick<StageShape, 'slug'>): StageShape {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    statusKey: 'confirmed',
    sortOrder: 0,
    isActive: true,
    isTerminal: false,
    ...overrides,
  };
}

/**
 * The any/all × 0/1/N-owners matrix. The plan calls this out as the
 * highest-value test in the phase, because both failure directions are bad: too
 * lenient waves work through unchecked, too strict deadlocks a job silently.
 */
describe('isTaskSatisfied — any', () => {
  it('is false with no confirmations', () => {
    expect(isTaskSatisfied('any', [], [])).toBe(false);
    expect(isTaskSatisfied('any', [], ['u1', 'u2'])).toBe(false);
  });

  it('is true after one confirmation, whoever gave it', () => {
    expect(isTaskSatisfied('any', [by('u1')], ['u1', 'u2'])).toBe(true);
  });

  it('accepts a confirmation from a non-owner', () => {
    expect(isTaskSatisfied('any', [by('stranger')], ['u1'])).toBe(true);
  });

  it('accepts a system-recorded confirmation', () => {
    expect(isTaskSatisfied('any', [by(null)], ['u1'])).toBe(true);
  });
});

describe('isTaskSatisfied — all', () => {
  it('is false with no confirmations', () => {
    expect(isTaskSatisfied('all', [], ['u1'])).toBe(false);
  });

  it('is false until every owner has confirmed', () => {
    expect(isTaskSatisfied('all', [by('u1')], ['u1', 'u2'])).toBe(false);
    expect(isTaskSatisfied('all', [by('u1'), by('u2')], ['u1', 'u2'])).toBe(true);
  });

  it('ignores confirmations from people who are not owners', () => {
    expect(isTaskSatisfied('all', [by('u1'), by('stranger')], ['u1', 'u2'])).toBe(false);
  });

  it('is satisfied for a single owner who has confirmed', () => {
    expect(isTaskSatisfied('all', [by('u1')], ['u1'])).toBe(true);
  });

  /**
   * A task nobody owns must not be unsatisfiable — that deadlocks every job in
   * the stage with no way to see why. Being slightly lenient about an unclaimed
   * stage is the better failure.
   */
  it('falls back to one-is-enough when the stage has no owners', () => {
    expect(isTaskSatisfied('all', [by('anyone')], [])).toBe(true);
    expect(isTaskSatisfied('all', [by(null)], [])).toBe(true);
  });

  // A system completion has no user, so it cannot stand in for a named owner.
  it('does not let a system confirmation satisfy a named owner', () => {
    expect(isTaskSatisfied('all', [by(null)], ['u1'])).toBe(false);
  });

  // Adding an owner raises the bar for jobs still in the stage.
  it('becomes unsatisfied again when a new owner is added', () => {
    const completions = [by('u1')];
    expect(isTaskSatisfied('all', completions, ['u1'])).toBe(true);
    expect(isTaskSatisfied('all', completions, ['u1', 'u2'])).toBe(false);
  });
});

describe('policyFor', () => {
  it('prefers the task policy', () => {
    expect(policyFor(task({ confirmationPolicy: 'all' }), 'any')).toBe('all');
  });

  it('inherits the stage default when unset', () => {
    expect(policyFor(task({ confirmationPolicy: null }), 'all')).toBe('all');
  });
});

describe('canLeaveStage', () => {
  const blocking = task({ id: 'b1', slug: 'artwork_approved', isBlocking: true });
  const nonBlocking = task({ id: 'n1', slug: 'colour_sample', isBlocking: false });

  it('allows leaving a stage with no tasks', () => {
    expect(canLeaveStage([], 'any', new Map(), new Map()).canLeave).toBe(true);
  });

  it('blocks while a blocking task is outstanding', () => {
    const result = canLeaveStage([blocking], 'any', new Map(), new Map());

    expect(result.canLeave).toBe(false);
    expect(result.outstanding.map((t) => t.slug)).toEqual(['artwork_approved']);
  });

  it('allows leaving once the blocking task is confirmed', () => {
    const completions = new Map([['b1', [by('u1', 'b1')]]]);
    expect(canLeaveStage([blocking], 'any', completions, new Map()).canLeave).toBe(true);
  });

  // The sequential-majority-with-exceptions model: a non-blocking task follows
  // the job rather than holding it.
  it('never blocks on a non-blocking task', () => {
    const result = canLeaveStage([nonBlocking], 'any', new Map(), new Map());

    expect(result.canLeave).toBe(true);
    expect(result.outstanding).toEqual([]);
  });

  it('reports every outstanding blocking task, not just the first', () => {
    const second = task({ id: 'b2', slug: 'fabric_confirmed' });
    const result = canLeaveStage([blocking, second, nonBlocking], 'any', new Map(), new Map());

    expect(result.outstanding.map((t) => t.slug)).toEqual([
      'artwork_approved',
      'fabric_confirmed',
    ]);
  });

  it('honours an all-policy task with several owners', () => {
    const allTask = task({ id: 'b1', confirmationPolicy: 'all' });
    const owners = new Map([['b1', ['u1', 'u2']]]);

    const partly = canLeaveStage([allTask], 'any', new Map([['b1', [by('u1', 'b1')]]]), owners);
    expect(partly.canLeave).toBe(false);

    const fully = canLeaveStage(
      [allTask],
      'any',
      new Map([['b1', [by('u1', 'b1'), by('u2', 'b1')]]]),
      owners,
    );
    expect(fully.canLeave).toBe(true);
  });

  it('applies the stage default to tasks that set no policy', () => {
    const owners = new Map([['b1', ['u1', 'u2']]]);
    const completions = new Map([['b1', [by('u1', 'b1')]]]);

    expect(canLeaveStage([blocking], 'all', completions, owners).canLeave).toBe(false);
    expect(canLeaveStage([blocking], 'any', completions, owners).canLeave).toBe(true);
  });
});

describe('nextStageInGroup', () => {
  const STAGES: StageShape[] = [
    stage({ slug: 'confirmed', sortOrder: 50 }),
    stage({ slug: 'artwork', sortOrder: 60 }),
    stage({ slug: 'retired', sortOrder: 65, isActive: false }),
    stage({ slug: 'digitising', sortOrder: 70 }),
    stage({ slug: 'sent', sortOrder: 20, statusKey: 'sent' }),
  ];

  it('returns the next stage by sort order', () => {
    expect(nextStageInGroup(STAGES, STAGES[0])?.slug).toBe('artwork');
  });

  it('skips an inactive stage', () => {
    expect(nextStageInGroup(STAGES, STAGES[1])?.slug).toBe('digitising');
  });

  // Crossing into another status is a status transition with its own guards —
  // never something finishing a checklist should trigger by itself.
  it('stops at the end of the status group rather than crossing into another', () => {
    expect(nextStageInGroup(STAGES, stage({ slug: 'digitising', sortOrder: 70 }))).toBeNull();
  });

  it('never goes backwards', () => {
    expect(nextStageInGroup(STAGES, stage({ slug: 'digitising', sortOrder: 70 }))).toBeNull();
  });

  it('ignores stages in a different status group', () => {
    const next = nextStageInGroup(STAGES, stage({ slug: 'sent', sortOrder: 20, statusKey: 'sent' }));
    expect(next).toBeNull();
  });
});

describe('tasksForGate', () => {
  it('selects only tasks carrying the key', () => {
    const tasks = [
      task({ id: 'a', slug: 'artwork', gateKeys: ['po_send'] }),
      task({ id: 'b', slug: 'other', gateKeys: ['order_confirm'] }),
      task({ id: 'c', slug: 'none', gateKeys: [] }),
    ];

    expect(tasksForGate(tasks, 'po_send').map((t) => t.slug)).toEqual(['artwork']);
  });

  it('handles a task feeding several gates', () => {
    const tasks = [task({ gateKeys: ['po_send', 'po_production_start'] })];

    expect(tasksForGate(tasks, 'po_send')).toHaveLength(1);
    expect(tasksForGate(tasks, 'po_production_start')).toHaveLength(1);
  });
});

describe('evaluateGateRules', () => {
  const anyPolicy = () => 'any' as const;

  it('is open when no task carries the key', () => {
    const result = evaluateGateRules([task()], 'po_send', anyPolicy, new Map(), new Map());
    expect(result.open).toBe(true);
  });

  it('is closed while a gated task is outstanding', () => {
    const gated = task({ gateKeys: ['po_send'] });
    const result = evaluateGateRules([gated], 'po_send', anyPolicy, new Map(), new Map());

    expect(result.open).toBe(false);
    expect(result.outstanding.map((t) => t.slug)).toEqual(['artwork_approved']);
  });

  it('opens once the gated task is confirmed', () => {
    const gated = task({ gateKeys: ['po_send'] });
    const completions = new Map([['t1', [by('u1')]]]);

    expect(evaluateGateRules([gated], 'po_send', anyPolicy, completions, new Map()).open).toBe(
      true,
    );
  });

  /**
   * The difference between a gate and leaving a stage: a non-blocking task does
   * not hold the job up, but it DOES hold the gate. That is what stops "we'll do
   * it later" from reaching the factory.
   */
  it('counts a non-blocking task against the gate', () => {
    const sample = task({ id: 'n1', slug: 'colour_sample', isBlocking: false, gateKeys: ['po_send'] });
    const result = evaluateGateRules([sample], 'po_send', anyPolicy, new Map(), new Map());

    expect(result.open).toBe(false);
    expect(result.outstanding.map((t) => t.slug)).toEqual(['colour_sample']);
  });

  it('ignores tasks carrying a different key', () => {
    const other = task({ gateKeys: ['order_confirm'] });
    expect(evaluateGateRules([other], 'po_send', anyPolicy, new Map(), new Map()).open).toBe(true);
  });

  it('lists every outstanding task so the UI can show the full set', () => {
    const tasks = [
      task({ id: 'a', slug: 'artwork', gateKeys: ['po_send'] }),
      task({ id: 'b', slug: 'fabric', gateKeys: ['po_send'] }),
    ];
    const result = evaluateGateRules([tasks[0], tasks[1]], 'po_send', anyPolicy, new Map(), new Map());

    expect(result.outstanding.map((t) => t.slug)).toEqual(['artwork', 'fabric']);
  });

  it('respects an all-policy gated task', () => {
    const gated = task({ gateKeys: ['po_send'] });
    const owners = new Map([['t1', ['u1', 'u2']]]);
    const partly = new Map([['t1', [by('u1')]]]);

    expect(
      evaluateGateRules([gated], 'po_send', () => 'all', partly, owners).open,
    ).toBe(false);
  });
});
