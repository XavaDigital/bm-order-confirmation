/**
 * The notification catalog: every event that can notify someone, with its
 * DEFAULT recipients baked in as code.
 *
 * Config in the database is override-only. A missing `notification_event_settings`
 * row means "use the default below", and a missing recipient rule means "use the
 * default rule set". The feature therefore works the moment it ships, and an
 * admin who never opens the settings page gets sensible behaviour rather than
 * silence — which is the failure mode people never report, they just conclude
 * the app doesn't notify.
 */
import type { RecipientRuleKind } from '@/db/schema';

export interface RecipientRule {
  kind: RecipientRuleKind;
  roleKey?: string;
  staffUserIds?: string[];
}

export interface NotificationDefinition {
  key: string;
  label: string;
  description: string;
  /** Which domain event drives it. */
  eventType: string;
  defaultEnabled: boolean;
  defaultEmailEnabled: boolean;
  defaultRules: RecipientRule[];
}

/**
 * `stage_owners` resolves to whoever owns the stage the job just entered — the
 * "notify the person responsible for this step" the workflow exists for.
 *
 * `order_owner` reproduces today's behaviour exactly (`orders.createdBy`).
 * Worth knowing: if `createdBy` is null, today NO staff email is sent at all.
 * Under rules an admin can add a role rule and close that hole without a code
 * change — which is the main reason the rules are data rather than hard-wired.
 */
export const NOTIFICATION_CATALOG: readonly NotificationDefinition[] = [
  {
    key: 'workflow.stage_entered',
    label: 'Work reaches your stage',
    description:
      'Sent to the people who own a stage when a job moves into it, so they know there is something to do.',
    eventType: 'workflow.stage_entered',
    defaultEnabled: true,
    defaultEmailEnabled: true,
    defaultRules: [{ kind: 'stage_owners' }],
  },
  {
    key: 'workflow.task_confirmed',
    label: 'A check is signed off',
    description:
      'Sent to the order owner when someone confirms a pre-production check. Off by default — useful for a handover, noisy otherwise.',
    eventType: 'workflow.task_confirmed',
    defaultEnabled: false,
    defaultEmailEnabled: false,
    defaultRules: [{ kind: 'order_owner' }],
  },
  {
    key: 'order.note_added',
    label: 'A note is added to an order',
    description: 'Sent to the order owner and anyone assigned to the order.',
    eventType: 'order.note_added',
    defaultEnabled: true,
    defaultEmailEnabled: false, // in-app only by default; notes are chatty
    defaultRules: [{ kind: 'order_owner' }, { kind: 'entity_assignees' }],
  },
  {
    key: 'po.sent',
    label: 'A purchase order goes to a supplier',
    description: 'Sent to the order owner so sales knows production has been committed.',
    eventType: 'po.sent',
    defaultEnabled: true,
    defaultEmailEnabled: true,
    defaultRules: [{ kind: 'order_owner' }, { kind: 'po_creator' }],
  },
  {
    key: 'workflow.gate_overridden',
    label: 'A pre-production gate is overridden',
    description:
      'Sent to admins whenever someone sends a purchase order with checks outstanding. An override nobody sees is not really a control.',
    eventType: 'workflow.gate_overridden',
    defaultEnabled: true,
    defaultEmailEnabled: true,
    defaultRules: [{ kind: 'role', roleKey: 'admin' }],
  },
] as const;

export function findNotification(key: string): NotificationDefinition | undefined {
  return NOTIFICATION_CATALOG.find((entry) => entry.key === key);
}

/** Catalog entries driven by a given domain event type. */
export function notificationsForEvent(eventType: string): NotificationDefinition[] {
  return NOTIFICATION_CATALOG.filter((entry) => entry.eventType === eventType);
}
