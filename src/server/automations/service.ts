/**
 * Configurable automations (David, 2026-08-06) — "automatic actions in certain
 * conditions", including ones that MOVE the purchase order.
 *
 * Shape, deliberately small (see the schema comment): trigger + optional match
 * → one action. Rules run from the OUTBOX processor, inside its batch
 * transaction, so a rule that writes cannot half-apply; every firing records
 * `automation.fired` naming the rule and its effect, because software that
 * changes state on its own must never do so anonymously.
 *
 * Two safety rules, both load-bearing:
 *  - a status action is checked against `canTransition` and SKIPPED (logged,
 *    not forced) when illegal — an automation must not be able to drive the PO
 *    into a state the machine forbids;
 *  - a rule never re-enters itself: the status change an automation makes is
 *    written directly here rather than through the public status service, so
 *    it emits its own audit row without spawning a fresh trigger cascade.
 */
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/db';
import { db } from '@/db';
import { automationRules, orderNotes, purchaseOrders } from '@/db/schema';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/server/events/outbox';
import { canTransition, type PoStatus } from '@/server/purchase-orders/contract';

export type AutomationTrigger =
  | 'po_status_changed'
  | 'po_file_uploaded'
  | 'po_checklist_complete';
export type AutomationAction = 'notify' | 'set_status' | 'add_note';

export type AutomationRule = typeof automationRules.$inferSelect;

/** Active rules for one trigger, in creation order. */
export async function rulesFor(
  trigger: AutomationTrigger,
  executor: Transaction | typeof db = db,
): Promise<AutomationRule[]> {
  return executor
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.trigger, trigger), eq(automationRules.isActive, true)));
}

/** Does this rule's trigger config match the event payload? Empty config = always. */
export function ruleMatches(rule: AutomationRule, payload: Record<string, unknown>): boolean {
  return Object.entries(rule.triggerConfig ?? {}).every(([key, want]) => {
    const got = payload[key];
    if (typeof got !== 'string') return false;
    // Category matching is case/whitespace-insensitive — staff type these.
    return got.trim().toLowerCase() === String(want).trim().toLowerCase();
  });
}

interface RunContext {
  tx: Transaction;
  orderId: string;
  poId: string;
  poNumber: string;
  payload: Record<string, unknown>;
}

/**
 * Run every active rule for a trigger. Never throws: an automation failure
 * must not fail the domain event that provoked it (the outbox would retry the
 * whole batch, re-notifying and re-moving). Failures are logged and audited.
 */
export async function runAutomations(
  trigger: AutomationTrigger,
  ctx: RunContext,
): Promise<void> {
  let rules: AutomationRule[];
  try {
    rules = await rulesFor(trigger, ctx.tx);
  } catch (err) {
    logger.warn('[automations] could not load rules', { trigger, err });
    return;
  }

  for (const rule of rules) {
    if (!ruleMatches(rule, ctx.payload)) continue;
    try {
      await applyAction(rule, ctx);
    } catch (err) {
      logger.warn('[automations] rule failed', { rule: rule.name, err });
      await recordAuditEvent(
        {
          aggregateId: ctx.orderId,
          eventType: 'automation.fired',
          payload: {
            rule: rule.name,
            poId: ctx.poId,
            poNumber: ctx.poNumber,
            outcome: 'failed',
            error: err instanceof Error ? err.message : 'unknown',
          },
          actorEmail: `automation: ${rule.name}`,
        },
        ctx.tx,
      );
    }
  }
}

async function applyAction(rule: AutomationRule, ctx: RunContext): Promise<void> {
  const config = (rule.actionConfig ?? {}) as Record<string, unknown>;
  const actor = `automation: ${rule.name}`;

  if (rule.action === 'set_status') {
    const target = String(config.status ?? '') as PoStatus;
    const [po] = await ctx.tx
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, ctx.poId));
    if (!po) return;
    if (!target || !canTransition(po.status, target)) {
      // Skipped, not forced — and SAID so, since "the automation didn't fire"
      // is the confusing case worth being able to look up.
      await recordAuditEvent(
        {
          aggregateId: ctx.orderId,
          eventType: 'automation.fired',
          payload: {
            rule: rule.name,
            poId: ctx.poId,
            poNumber: ctx.poNumber,
            outcome: 'skipped',
            reason: `cannot move a ${po.status} purchase order to ${target || '(unset)'}`,
          },
          actorEmail: actor,
        },
        ctx.tx,
      );
      return;
    }
    const now = new Date();
    await ctx.tx
      .update(purchaseOrders)
      .set({
        status: target,
        ...(target === 'received' ? { receivedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(purchaseOrders.id, ctx.poId));
    await recordAuditEvent(
      {
        aggregateId: ctx.orderId,
        eventType: 'po.status_changed',
        payload: { poId: ctx.poId, poNumber: ctx.poNumber, from: po.status, to: target },
        actorEmail: actor,
      },
      ctx.tx,
    );
    await recordAuditEvent(
      {
        aggregateId: ctx.orderId,
        eventType: 'automation.fired',
        payload: {
          rule: rule.name,
          poId: ctx.poId,
          poNumber: ctx.poNumber,
          outcome: 'applied',
          action: 'set_status',
          from: po.status,
          to: target,
        },
        actorEmail: actor,
      },
      ctx.tx,
    );
    return;
  }

  if (rule.action === 'add_note') {
    const body = String(config.body ?? '').trim();
    if (!body) return;
    await ctx.tx.insert(orderNotes).values({
      orderId: ctx.orderId,
      body,
      kind: 'comment',
      authorKind: 'system',
      authorLabel: actor,
      // Shared: a note an automation writes about the factory conversation
      // belongs where both sides already look.
      visibility: 'shared',
    });
    await recordAuditEvent(
      {
        aggregateId: ctx.orderId,
        eventType: 'automation.fired',
        payload: {
          rule: rule.name,
          poId: ctx.poId,
          poNumber: ctx.poNumber,
          outcome: 'applied',
          action: 'add_note',
        },
        actorEmail: actor,
      },
      ctx.tx,
    );
    return;
  }

  // notify — dispatch is the notifications module's job; recording the
  // intention here keeps this service free of its transaction rules (the
  // dispatcher claims recipients before sending, see notifications/dispatch).
  await recordAuditEvent(
    {
      aggregateId: ctx.orderId,
      eventType: 'automation.fired',
      payload: {
        rule: rule.name,
        poId: ctx.poId,
        poNumber: ctx.poNumber,
        outcome: 'applied',
        action: 'notify',
        recipients: config.recipients ?? [],
      },
      actorEmail: actor,
    },
    ctx.tx,
  );
}
