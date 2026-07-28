/**
 * The rules for when a task counts as done and when a stage can be left.
 *
 * Pure and dependency-free on purpose: this is the logic that decides whether a
 * job is allowed to move forward, and it needs to be exhaustively testable
 * without a database standing in the way.
 */
import type { ConfirmationPolicy } from '@/db/schema';

export interface TaskShape {
  id: string;
  slug: string;
  name: string;
  isBlocking: boolean;
  confirmationPolicy: ConfirmationPolicy | null;
  gateKeys: string[];
}

/** One recorded confirmation. `null` user = recorded by the system. */
export interface CompletionShape {
  taskId: string;
  confirmedByStaffUserId: string | null;
}

/**
 * Is this task satisfied?
 *
 * `any` — one confirmation is enough, including a system one.
 * `all` — every CURRENT owner must have confirmed. The owner set is read at
 * evaluation time rather than snapshotted at confirmation time, so adding an
 * owner to a stage raises the bar for jobs still sitting in it; jobs that have
 * already advanced are unaffected, because advancing is a write, not something
 * recomputed on read.
 *
 * An `all` task with NO owners falls back to one-confirmation-is-enough. The
 * alternative is a task that can never be satisfied, which silently deadlocks
 * every job in the stage — a far worse failure than being slightly lenient about
 * a stage nobody has claimed.
 */
export function isTaskSatisfied(
  policy: ConfirmationPolicy,
  completions: CompletionShape[],
  ownerIds: string[],
): boolean {
  if (completions.length === 0) return false;
  if (policy === 'any') return true;
  if (ownerIds.length === 0) return true;

  const confirmed = new Set(
    completions.map((c) => c.confirmedByStaffUserId).filter((id): id is string => id !== null),
  );
  return ownerIds.every((ownerId) => confirmed.has(ownerId));
}

/** The policy in force: the task's own, else the stage's default. */
export function policyFor(
  task: Pick<TaskShape, 'confirmationPolicy'>,
  stageDefault: ConfirmationPolicy,
): ConfirmationPolicy {
  return task.confirmationPolicy ?? stageDefault;
}

export interface StageExitCheck {
  canLeave: boolean;
  /** Blocking tasks still outstanding, in board order. */
  outstanding: TaskShape[];
}

/**
 * Can a job leave this stage?
 *
 * Only BLOCKING tasks hold it. A non-blocking task stays open and follows the
 * job — that is what makes "mostly sequential, some parallel" expressible
 * without a dependency graph — but it still counts for gates, which is what
 * stops it being ignored forever.
 */
export function canLeaveStage(
  tasks: TaskShape[],
  stageDefault: ConfirmationPolicy,
  completionsByTask: Map<string, CompletionShape[]>,
  ownersByTask: Map<string, string[]>,
): StageExitCheck {
  const outstanding = tasks.filter((task) => {
    if (!task.isBlocking) return false;
    return !isTaskSatisfied(
      policyFor(task, stageDefault),
      completionsByTask.get(task.id) ?? [],
      ownersByTask.get(task.id) ?? [],
    );
  });

  return { canLeave: outstanding.length === 0, outstanding };
}

export interface StageShape {
  id: string;
  slug: string;
  name: string;
  statusKey: string;
  sortOrder: number;
  isActive: boolean;
  isTerminal: boolean;
}

/**
 * The stage a job advances to when it finishes this one — the next active stage
 * in the SAME status group.
 *
 * Returns null at the end of a group: crossing into another status is a status
 * transition, which has its own guards and is never something task completion
 * should trigger implicitly.
 */
export function nextStageInGroup(
  stages: StageShape[],
  current: StageShape,
): StageShape | null {
  const group = stages
    .filter(
      (stage) =>
        stage.isActive &&
        stage.statusKey === current.statusKey &&
        stage.sortOrder > current.sortOrder,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));

  return group[0] ?? null;
}

/**
 * Which tasks feed a gate: every ACTIVE task carrying the key, across all
 * stages of the board.
 *
 * A gate is deliberately not a table — it is a question asked of the checklist,
 * so an admin ticking a gate key on a task is all it takes to put that task
 * behind the gate.
 */
export function tasksForGate(tasks: TaskShape[], gateKey: string): TaskShape[] {
  return tasks.filter((task) => task.gateKeys.includes(gateKey));
}

/**
 * Is a gate open? Unlike leaving a stage, this counts non-blocking tasks too:
 * "the colour sample has gone out" does not stop the job progressing, but it
 * absolutely should stop the purchase order reaching the factory.
 */
export function evaluateGateRules(
  tasks: TaskShape[],
  gateKey: string,
  policyForTask: (task: TaskShape) => ConfirmationPolicy,
  completionsByTask: Map<string, CompletionShape[]>,
  ownersByTask: Map<string, string[]>,
): { open: boolean; outstanding: TaskShape[] } {
  const relevant = tasksForGate(tasks, gateKey);
  const outstanding = relevant.filter(
    (task) =>
      !isTaskSatisfied(
        policyForTask(task),
        completionsByTask.get(task.id) ?? [],
        ownersByTask.get(task.id) ?? [],
      ),
  );

  return { open: outstanding.length === 0, outstanding };
}
