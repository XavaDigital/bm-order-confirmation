import type { StaffRole } from '@/lib/roles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
      if (prop === 'destroy')
        return () => {
          for (const k of Object.keys(target)) delete target[k];
        };
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
      if (!session.userId)
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin')
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { getSession } from '@/lib/session';
import { auditEvents } from '@/db/schema';
import { createChecklistItem } from '@/server/purchase-orders/checklist-service';
import { GET, POST } from './route';
import { PATCH } from './[itemId]/route';

const URL_BASE = '/api/admin/purchase-orders/checklist-items';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession(role: StaffRole) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = role;
  session.email = 'sam@example.com';
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

const itemParams = (itemId: string) => ({ params: Promise.resolve({ itemId }) });

describe('GET /api/admin/purchase-orders/checklist-items', () => {
  it('lists the seeded checks, retired ones included, in order', async () => {
    await setSession('viewer');
    await createChecklistItem({ label: 'Old check' });

    const res = await GET(jsonRequest(URL_BASE, 'GET'));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Migration 0042 seeds the two sidesteppable checks; ours is appended.
    expect(json.items.map((i: { label: string }) => i.label)).toContain('Old check');
    expect(
      // Re-worded by 0052 to a short title with the explanation underneath.
      json.items.find((i: { label: string }) => i.label === 'Colours on the design')
        ?.allowSidestep,
    ).toBe(true);
    const orders = json.items.map((i: { sortOrder: number }) => i.sortOrder);
    expect([...orders]).toEqual([...orders].sort((a: number, b: number) => a - b));
  });

  it('401s without a session', async () => {
    const res = await GET(jsonRequest(URL_BASE, 'GET'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/purchase-orders/checklist-items', () => {
  it('creates a check, appended to the end, and audits who added it', async () => {
    await setSession('admin');

    const res = await POST(
      jsonRequest(URL_BASE, 'POST', {
        label: 'Colour book matches the artwork',
        allowSidestep: true,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.item.label).toBe('Colour book matches the artwork');
    expect(json.item.allowSidestep).toBe(true);
    expect(json.item.autoRule).toBeNull();
    expect(json.item.isActive).toBe(true);

    const listed = await (await GET(jsonRequest(URL_BASE, 'GET'))).json();
    const labels = listed.items.map((i: { label: string }) => i.label);
    expect(labels[labels.length - 1]).toBe('Colour book matches the artwork');

    const audit = await db.select().from(auditEvents);
    const created = audit.find((e) => e.eventType === 'po.check_item_created');
    expect(created?.actorEmail).toBe('sam@example.com');
    expect(created?.aggregateType).toBe('po_checklist_item');
  });

  it('accepts an auto rule from the code vocabulary and rejects anything else', async () => {
    await setSession('admin');

    const ok = await POST(
      jsonRequest(URL_BASE, 'POST', { label: 'Colour book set', autoRule: 'color_book_set' }),
    );
    expect((await ok.json()).item.autoRule).toBe('color_book_set');

    const bad = await POST(
      jsonRequest(URL_BASE, 'POST', { label: 'Vibes', autoRule: 'looks_about_right' }),
    );
    expect(bad.status).toBe(400);
  });

  it('rejects an empty label', async () => {
    await setSession('admin');
    const res = await POST(jsonRequest(URL_BASE, 'POST', { label: '   ' }));
    expect(res.status).toBe(400);
  });

  it('403s for a non-admin — changing what the team must do is a management act', async () => {
    await setSession('sales');
    const res = await POST(jsonRequest(URL_BASE, 'POST', { label: 'Sneaky check' }));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/purchase-orders/checklist-items/[itemId]', () => {
  it('renames a check, changes its rule, and makes it sidesteppable', async () => {
    await setSession('admin');
    const created = await createChecklistItem({ label: 'Fonts uploaded' });

    const res = await PATCH(
      jsonRequest(`${URL_BASE}/${created.id}`, 'PATCH', {
        label: 'Checked whether any fonts need to be uploaded',
        allowSidestep: true,
        sortOrder: 9,
      }),
      itemParams(created.id),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.item.label).toBe('Checked whether any fonts need to be uploaded');
    expect(json.item.allowSidestep).toBe(true);
    expect(json.item.sortOrder).toBe(9);
  });

  it('retires a check instead of deleting it — it drops out of the active list only', async () => {
    await setSession('admin');
    const created = await createChecklistItem({ label: 'Old check' });

    const res = await PATCH(
      jsonRequest(`${URL_BASE}/${created.id}`, 'PATCH', { isActive: false }),
      itemParams(created.id),
    );
    expect((await res.json()).item.isActive).toBe(false);

    // Still listed here (the settings view has to be able to bring it back).
    const listed = await (await GET(jsonRequest(URL_BASE, 'GET'))).json();
    expect(listed.items.some((i: { id: string }) => i.id === created.id)).toBe(true);
  });

  it('404s on an unknown item', async () => {
    await setSession('admin');
    const res = await PATCH(
      jsonRequest(`${URL_BASE}/11111111-1111-1111-1111-111111111111`, 'PATCH', { label: 'x' }),
      itemParams('11111111-1111-1111-1111-111111111111'),
    );
    expect(res.status).toBe(404);
  });

  it('403s for a non-admin', async () => {
    await setSession('sales');
    const created = await createChecklistItem({ label: 'Old check' });
    const res = await PATCH(
      jsonRequest(`${URL_BASE}/${created.id}`, 'PATCH', { isActive: false }),
      itemParams(created.id),
    );
    expect(res.status).toBe(403);
  });
});
