import type { StaffRole } from '@/lib/roles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/lib/session', () => {
  const store: Record<string, unknown> = {};
  const session = new Proxy(store, {
    get(target, prop) {
      if (prop === 'save') return async () => {};
      if (prop === 'destroy') return () => { for (const k of Object.keys(target)) delete target[k]; };
      return target[prop as string];
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return {
    getSession: vi.fn(async () => session),
    requireAdmin: vi.fn(async () => {
      if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { GET, PATCH, POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

/** createdBy is a real FK, so the session has to name a real staff row. */
async function seedStaff(role: StaffRole = 'admin') {
  const [user] = await db
    .insert(schema.staffUsers)
    .values({
      email: `${role}@example.com`,
      passwordHash: 'x',
      name: `${role} person`,
      role: role === 'none' ? 'viewer' : role,
    })
    .returning();
  return user;
}

async function setSession(role: StaffRole) {
  const user = await seedStaff(role);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = user.id;
  session.email = user.email;
  session.role = role;
  return user;
}

function jsonRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/automations', {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

const NEW_RULE = {
  name: 'Test print goes to quality control',
  trigger: 'po_file_uploaded',
  triggerConfig: { category: 'Test print' },
  action: 'set_status',
  actionConfig: { status: 'quality_control' },
};

async function seedRule(overrides: Partial<typeof schema.automationRules.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.automationRules)
    .values({
      name: 'Chase production',
      trigger: 'po_status_changed',
      triggerConfig: { to: 'in_production' },
      action: 'notify',
      actionConfig: { recipients: ['admin'] },
      ...overrides,
    })
    .returning();
  return row;
}

describe('GET /api/admin/automations', () => {
  it('401s without a session', async () => {
    const res = await GET(jsonRequest('GET'));
    expect(res.status).toBe(401);
  });

  // The settings page is readable by everyone with access; only changing a rule
  // is admin-only.
  it('is readable by a viewer', async () => {
    await setSession('viewer');
    await seedRule();

    const res = await GET(jsonRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({
      name: 'Chase production',
      trigger: 'po_status_changed',
      triggerConfig: { to: 'in_production' },
      action: 'notify',
      actionConfig: { recipients: ['admin'] },
      isActive: true,
    });
  });

  // Rules run in creation order, so the list has to show that order.
  it('returns paused rules too, oldest first', async () => {
    await setSession('sales');
    await seedRule({ name: 'First' });
    await seedRule({ name: 'Second', isActive: false });

    const json = await (await GET(jsonRequest('GET'))).json();

    expect(json.items.map((r: { name: string }) => r.name)).toEqual(['First', 'Second']);
    expect(json.items[1].isActive).toBe(false);
  });
});

describe('POST /api/admin/automations', () => {
  it('401s without a session', async () => {
    const res = await POST(jsonRequest('POST', NEW_RULE));
    expect(res.status).toBe(401);
  });

  // Writing a rule that moves purchase orders on its own is an admin act, even
  // though sales can read the page.
  it('403s for a non-admin staff user', async () => {
    await setSession('sales');

    const res = await POST(jsonRequest('POST', NEW_RULE));

    expect(res.status).toBe(403);
    expect(await db.select().from(schema.automationRules)).toHaveLength(0);
  });

  it('403s for a viewer', async () => {
    await setSession('viewer');
    const res = await POST(jsonRequest('POST', NEW_RULE));
    expect(res.status).toBe(403);
  });

  it('creates a rule for an admin, stamped with its author, and audits it', async () => {
    const admin = await setSession('admin');

    const res = await POST(jsonRequest('POST', NEW_RULE));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toMatchObject({
      name: 'Test print goes to quality control',
      trigger: 'po_file_uploaded',
      triggerConfig: { category: 'Test print' },
      action: 'set_status',
      actionConfig: { status: 'quality_control' },
      isActive: true,
      createdBy: admin.id,
    });

    const [audit] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, json.id));
    expect(audit).toMatchObject({
      aggregateType: 'automation_rule',
      eventType: 'automation.rule_created',
      actorEmail: admin.email,
    });
  });

  it('defaults the configs and isActive when they are omitted', async () => {
    await setSession('admin');

    const res = await POST(
      jsonRequest('POST', {
        name: 'Checklist done',
        trigger: 'po_checklist_complete',
        action: 'notify',
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.triggerConfig).toEqual({});
    expect(json.actionConfig).toEqual({});
    expect(json.isActive).toBe(true);
  });

  // The vocabulary is closed on purpose — an unknown trigger would be a rule
  // that silently never fires.
  it('400s on an unknown trigger or action', async () => {
    await setSession('admin');

    expect(
      (await POST(jsonRequest('POST', { ...NEW_RULE, trigger: 'po_exploded' }))).status,
    ).toBe(400);
    expect(
      (await POST(jsonRequest('POST', { ...NEW_RULE, action: 'launch_rocket' }))).status,
    ).toBe(400);
    expect((await POST(jsonRequest('POST', { ...NEW_RULE, name: '' }))).status).toBe(400);
  });
});

describe('PATCH /api/admin/automations', () => {
  it('401s without a session', async () => {
    const rule = await seedRule();
    const res = await PATCH(jsonRequest('PATCH', { id: rule.id, isActive: false }));
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin staff user', async () => {
    await setSession('sales');
    const rule = await seedRule();

    const res = await PATCH(jsonRequest('PATCH', { id: rule.id, isActive: false }));

    expect(res.status).toBe(403);
    const [row] = await db
      .select()
      .from(schema.automationRules)
      .where(eq(schema.automationRules.id, rule.id));
    expect(row.isActive).toBe(true);
  });

  it('pauses a rule for an admin and audits which fields changed', async () => {
    const admin = await setSession('admin');
    const rule = await seedRule();

    const res = await PATCH(jsonRequest('PATCH', { id: rule.id, isActive: false }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.isActive).toBe(false);
    const [audit] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, rule.id));
    expect(audit).toMatchObject({
      aggregateType: 'automation_rule',
      eventType: 'automation.rule_updated',
      actorEmail: admin.email,
    });
    expect(audit.payload).toMatchObject({ fields: ['isActive'] });
  });

  it('rewrites the trigger and action config wholesale', async () => {
    await setSession('admin');
    const rule = await seedRule();

    const res = await PATCH(
      jsonRequest('PATCH', {
        id: rule.id,
        trigger: 'po_file_uploaded',
        triggerConfig: { category: 'Design file' },
        action: 'add_note',
        actionConfig: { body: 'Design file received' },
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      trigger: 'po_file_uploaded',
      triggerConfig: { category: 'Design file' },
      action: 'add_note',
      actionConfig: { body: 'Design file received' },
    });
  });

  it('404s for an unknown rule', async () => {
    await setSession('admin');

    const res = await PATCH(
      jsonRequest('PATCH', {
        id: '00000000-0000-0000-0000-000000000000',
        isActive: false,
      }),
    );

    expect(res.status).toBe(404);
  });

  it('400s without a rule id', async () => {
    await setSession('admin');
    const res = await PATCH(jsonRequest('PATCH', { isActive: false }));
    expect(res.status).toBe(400);
  });

  it('leaves the other rules alone', async () => {
    await setSession('admin');
    const first = await seedRule({ name: 'First' });
    await seedRule({ name: 'Second' });

    await PATCH(jsonRequest('PATCH', { id: first.id, isActive: false }));

    const rows = await db
      .select()
      .from(schema.automationRules)
      .orderBy(asc(schema.automationRules.createdAt));
    expect(rows.map((r) => r.isActive)).toEqual([false, true]);
  });
});
