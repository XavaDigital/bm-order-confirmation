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
    key: 'workflow.stuck',
    label: 'Work has sat too long',
    description:
      'Sent to the owners of a stage when a job has been in it past its warn threshold. At most once a day per job while it stays stuck.',
    eventType: 'workflow.stuck',
    defaultEnabled: true,
    defaultEmailEnabled: true,
    defaultRules: [{ kind: 'stage_owners' }],
  },
  {
    key: 'workflow.reminder',
    label: 'A reminder you set comes due',
    description: 'Goes to whoever set the reminder, whatever the rules say.',
    eventType: 'workflow.reminder',
    defaultEnabled: true,
    defaultEmailEnabled: true,
    defaultRules: [],
  },
  {
    key: 'workflow.status_reminder',
    label: 'A conditional reminder fires',
    description:
      'Goes to whoever set the reminder when the order/PO reaches the status they picked ' +
      '(e.g. "send the customer a test print for approval").',
    eventType: 'workflow.status_reminder_due',
    defaultEnabled: true,
    defaultEmailEnabled: true,
    defaultRules: [],
  },
  {
    key: 'po.supplier_updated',
    label: 'A supplier updates a purchase order',
    description:
      'Sent when a supplier moves a PO forward through their portal link. Same default ' +
      'recipients as "po.sent" — a status push is not necessarily a stage move (see ' +
      'CLAUDE.md on statuses changing without the board), so this does not use ' +
      'stage_owners: the PO\'s recorded stage slug can be stale relative to a status a ' +
      'supplier just changed directly.',
    eventType: 'po.supplier_updated',
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
