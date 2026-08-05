/**
 * Route-level tests for GET/POST /api/admin/suppliers/[id]/color-books
 * (David, 2026-08-05). Newest first — index 0 is the default for new POs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

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
  return { getSession: vi.fn(async () => session) };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { getSession } from '@/lib/session';
import * as schema from '@/db/schema';
import { GET, POST } from './route';

beforeEach(async () => {
  const [user] = await db
    .insert(schema.staffUsers)
    .values({ email: 'sam@example.com', passwordHash: 'x', name: 'Sam Staff' })
    .returning();
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = user.id;
  session.email = user.email;
  session.role = 'sales';
});

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedSupplier() {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: 'Dynasty', supplierCode: 'DY' })
    .returning();
  return supplier;
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

describe('auth gate', () => {
  it('401s without a session; viewers can read but not create', async () => {
    const supplier = await seedSupplier();
    const session = (await getSession()) as unknown as Record<string, unknown>;
    for (const key of Object.keys(session)) delete session[key];

    expect((await GET(jsonRequest('/x', 'GET'), withId(supplier.id))).status).toBe(401);
    expect(
      (await POST(jsonRequest('/x', 'POST', { name: 'Pantone' }), withId(supplier.id))).status,
    ).toBe(401);

    session.userId = 'viewer-1';
    session.role = 'viewer';
    session.email = 'viewer@x.com';
    expect((await GET(jsonRequest('/x', 'GET'), withId(supplier.id))).status).toBe(200);
    expect(
      (await POST(jsonRequest('/x', 'POST', { name: 'Pantone' }), withId(supplier.id))).status,
    ).toBe(403);
  });
});

describe('POST /api/admin/suppliers/[id]/color-books', () => {
  it('creates a book (201), stamping the creator from the session', async () => {
    const supplier = await seedSupplier();

    const res = await POST(
      jsonRequest('/x', 'POST', { name: '  Pantone 2026  ' }),
      withId(supplier.id),
    );
    const book = await res.json();

    expect(res.status).toBe(201);
    expect(book.name).toBe('Pantone 2026'); // trimmed
    expect(book.supplierId).toBe(supplier.id);
    const row = await db.query.supplierColorBooks.findFirst({
      where: eq(schema.supplierColorBooks.id, book.id),
    });
    expect(row!.createdBy).toBe((await getSession() as unknown as { userId: string }).userId);
  });

  it('409s a duplicate name, 404s an unknown supplier, 400s an empty name', async () => {
    const supplier = await seedSupplier();
    await POST(jsonRequest('/x', 'POST', { name: 'Pantone 2026' }), withId(supplier.id));

    const dupe = await POST(
      jsonRequest('/x', 'POST', { name: 'Pantone 2026' }),
      withId(supplier.id),
    );
    expect(dupe.status).toBe(409);
    expect((await dupe.json()).error).toContain('already has a colour book');

    const missing = await POST(
      jsonRequest('/x', 'POST', { name: 'Pantone 2026' }),
      withId('00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.status).toBe(404);

    const empty = await POST(jsonRequest('/x', 'POST', { name: '   ' }), withId(supplier.id));
    expect(empty.status).toBe(400);
  });
});

describe('GET /api/admin/suppliers/[id]/color-books', () => {
  it('lists newest first and 404s an unknown supplier', async () => {
    const supplier = await seedSupplier();
    const first = await POST(jsonRequest('/x', 'POST', { name: '2025 Book' }), withId(supplier.id));
    const firstBook = await first.json();
    await db
      .update(schema.supplierColorBooks)
      .set({ createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
      .where(eq(schema.supplierColorBooks.id, firstBook.id));
    await POST(jsonRequest('/x', 'POST', { name: '2026 Book' }), withId(supplier.id));

    const res = await GET(jsonRequest('/x', 'GET'), withId(supplier.id));
    const { items } = await res.json();

    expect(res.status).toBe(200);
    expect(items.map((b: { name: string }) => b.name)).toEqual(['2026 Book', '2025 Book']);

    const missing = await GET(
      jsonRequest('/x', 'GET'),
      withId('00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.status).toBe(404);
  });
});
