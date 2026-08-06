import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { automationRules } from '@/db/schema';
import { defineRoute } from '@/lib/route-handler';
import { recordAuditEvent } from '@/server/events/outbox';

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.enum(['po_status_changed', 'po_file_uploaded', 'po_checklist_complete']),
  triggerConfig: z.record(z.string(), z.string()).default({}),
  action: z.enum(['notify', 'set_status', 'add_note']),
  actionConfig: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

/** Every automation rule, oldest first — the order they run in. */
export const GET = defineRoute<Record<string, never>>({
  auth: 'viewer',
  tag: 'admin/automations GET',
  handler: async () =>
    NextResponse.json({
      items: await db
        .select()
        .from(automationRules)
        // Same stable ordering the engine runs them in (createdAt, then id).
        .orderBy(asc(automationRules.createdAt), asc(automationRules.id)),
    }),
});

export const POST = defineRoute<Record<string, never>, typeof ruleSchema._type>({
  auth: 'admin',
  tag: 'admin/automations POST',
  schema: ruleSchema,
  handler: async ({ body, session }) => {
    const [rule] = await db
      .insert(automationRules)
      .values({ ...body, createdBy: session!.userId })
      .returning();
    await recordAuditEvent({
      aggregateId: rule.id,
      aggregateType: 'automation_rule',
      eventType: 'automation.rule_created',
      payload: { name: rule.name, trigger: rule.trigger, action: rule.action },
      actorEmail: session!.email,
    });
    return NextResponse.json(rule, { status: 201 });
  },
});

const patchSchema = ruleSchema.partial();

/** PATCH by id in the body — automations are few and edited from one screen. */
export const PATCH = defineRoute<Record<string, never>, typeof patchSchema._type & { id?: string }>({
  auth: 'admin',
  tag: 'admin/automations PATCH',
  schema: patchSchema.extend({ id: z.string().uuid() }),
  handler: async ({ body, session }) => {
    const { id, ...patch } = body;
    const [rule] = await db
      .update(automationRules)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(automationRules.id, id!))
      .returning();
    if (!rule) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
    await recordAuditEvent({
      aggregateId: rule.id,
      aggregateType: 'automation_rule',
      eventType: 'automation.rule_updated',
      payload: { name: rule.name, fields: Object.keys(patch) },
      actorEmail: session!.email,
    });
    return NextResponse.json(rule);
  },
});
