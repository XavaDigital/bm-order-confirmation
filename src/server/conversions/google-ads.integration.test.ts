import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

const configuredEnv = {
  GOOGLE_ADS_CUSTOMER_ID: '1234567890',
  GOOGLE_ADS_CONVERSION_ACTION_ID: '987654',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token',
  GOOGLE_ADS_OAUTH_CLIENT_ID: 'client-id',
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: 'client-secret',
  GOOGLE_ADS_OAUTH_REFRESH_TOKEN: 'refresh-token',
};

vi.mock('@/lib/env', () => ({
  env: {} as Record<string, string | undefined>,
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { fireGoogleAdsConversion, isGoogleAdsApiConfigured } from './google-ads';

function clearEnv() {
  for (const key of Object.keys(configuredEnv)) {
    delete (env as Record<string, unknown>)[key];
  }
}

function setConfiguredEnv() {
  Object.assign(env, configuredEnv);
}

afterEach(async () => {
  await resetTestDb(db);
  clearEnv();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  clearEnv();
});

async function seedOrder(overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: `OC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      customerName: 'Jane Coach',
      customerEmail: 'Jane@Example.com',
      ...overrides,
    })
    .returning();
  return order;
}

async function seedConversionEvent(
  orderId: string,
  overrides: Partial<typeof schema.conversionEvents.$inferInsert> = {},
) {
  const [event] = await db
    .insert(schema.conversionEvents)
    .values({
      orderId,
      valueAmount: '150.00',
      valueCurrency: 'NZD',
      firedAt: new Date('2026-01-15T10:00:00Z'),
      ...overrides,
    })
    .returning();
  return event;
}

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json?: unknown; text?: string }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockImplementationOnce(async () => ({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.json ?? {},
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    }));
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('isGoogleAdsApiConfigured', () => {
  it('is false when no env vars are set', () => {
    expect(isGoogleAdsApiConfigured()).toBe(false);
  });

  it('is false when only some vars are set', () => {
    env.GOOGLE_ADS_CUSTOMER_ID = configuredEnv.GOOGLE_ADS_CUSTOMER_ID;
    env.GOOGLE_ADS_DEVELOPER_TOKEN = configuredEnv.GOOGLE_ADS_DEVELOPER_TOKEN;
    expect(isGoogleAdsApiConfigured()).toBe(false);
  });

  it('is true when all six vars are set', () => {
    setConfiguredEnv();
    expect(isGoogleAdsApiConfigured()).toBe(true);
  });
});

describe('fireGoogleAdsConversion', () => {
  it('does nothing when Google Ads API is not configured', async () => {
    const order = await seedOrder();
    await seedConversionEvent(order.id);
    const fetchMock = mockFetchSequence([]);

    await fireGoogleAdsConversion(order.id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when there is no conversion_events row for the order', async () => {
    setConfiguredEnv();
    const order = await seedOrder();
    const fetchMock = mockFetchSequence([]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fireGoogleAdsConversion(order.id);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('is idempotent — does nothing when the conversion already succeeded', async () => {
    setConfiguredEnv();
    const order = await seedOrder();
    await seedConversionEvent(order.id, { status: 'sent' });
    const fetchMock = mockFetchSequence([]);

    await fireGoogleAdsConversion(order.id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when the order itself is missing', async () => {
    setConfiguredEnv();
    const order = await seedOrder();
    await seedConversionEvent(order.id);
    // orders.id has an FK from conversion_events with onDelete: cascade, so a
    // dangling conversion_events row can't exist for real — simulate the
    // defensive "order not found" branch by stubbing the lookup directly.
    const findFirstSpy = vi.spyOn(db.query.orders, 'findFirst').mockResolvedValueOnce(undefined);
    const fetchMock = mockFetchSequence([]);

    await fireGoogleAdsConversion(order.id);
    expect(fetchMock).not.toHaveBeenCalled();
    findFirstSpy.mockRestore();
  });

  it('uploads the conversion and marks it sent on success', async () => {
    setConfiguredEnv();
    const order = await seedOrder({ customerEmail: 'Jane@Example.com' });
    const event = await seedConversionEvent(order.id);

    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: 'access-tok' } },
      { ok: true, json: { results: [{}] } },
    ]);

    await fireGoogleAdsConversion(order.id);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [oauthUrl, oauthInit] = fetchMock.mock.calls[0];
    expect(oauthUrl).toBe('https://oauth2.googleapis.com/token');
    const oauthBody = oauthInit.body as URLSearchParams;
    expect(oauthBody.get('refresh_token')).toBe('refresh-token');

    const [apiUrl, apiInit] = fetchMock.mock.calls[1];
    expect(apiUrl).toBe(
      'https://googleads.googleapis.com/v18/customers/1234567890/conversionUploads:uploadClickConversions',
    );
    expect(apiInit.headers.Authorization).toBe('Bearer access-tok');
    expect(apiInit.headers['developer-token']).toBe('dev-token');
    const payload = JSON.parse(apiInit.body);
    expect(payload.conversions[0].orderId).toBe(order.id);
    expect(payload.conversions[0].conversionAction).toBe(
      'customers/1234567890/conversionActions/987654',
    );
    // hashed, lowercased+trimmed email
    const expectedHash = (await import('node:crypto'))
      .createHash('sha256')
      .update('jane@example.com')
      .digest('hex');
    expect(payload.conversions[0].userIdentifiers[0].hashedEmail).toBe(expectedHash);

    const [row] = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.id, event.id));
    expect(row.status).toBe('sent');
    expect(row.providerResponse).toEqual({ results: [{}] });
  });

  it('marks the event failed and throws when the OAuth token refresh fails', async () => {
    setConfiguredEnv();
    const order = await seedOrder();
    const event = await seedConversionEvent(order.id);

    mockFetchSequence([{ ok: false, status: 401, text: 'invalid_grant' }]);

    await expect(fireGoogleAdsConversion(order.id)).rejects.toThrow('OAuth token refresh failed');

    const [row] = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.id, event.id));
    expect(row.status).toBe('failed');
    expect((row.providerResponse as { stage: string }).stage).toBe('oauth');
  });

  it('marks the event failed and throws when the upload API returns a non-OK response', async () => {
    setConfiguredEnv();
    const order = await seedOrder();
    const event = await seedConversionEvent(order.id);

    mockFetchSequence([
      { ok: true, json: { access_token: 'access-tok' } },
      { ok: false, status: 500, json: { error: 'server error' } },
    ]);

    await expect(fireGoogleAdsConversion(order.id)).rejects.toThrow('[google-ads] API 500');

    const [row] = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.id, event.id));
    expect(row.status).toBe('failed');
  });

  it('marks the event failed and throws on a partial failure in a 200 response', async () => {
    setConfiguredEnv();
    const order = await seedOrder();
    const event = await seedConversionEvent(order.id);

    mockFetchSequence([
      { ok: true, json: { access_token: 'access-tok' } },
      { ok: true, json: { partialFailureError: { message: 'bad order id' } } },
    ]);

    await expect(fireGoogleAdsConversion(order.id)).rejects.toThrow('[google-ads] partial failure');

    const [row] = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.id, event.id));
    expect(row.status).toBe('failed');
  });

  it('marks the event failed and throws when the fetch call itself rejects', async () => {
    setConfiguredEnv();
    const order = await seedOrder();
    const event = await seedConversionEvent(order.id);

    const fetchMock = vi.fn();
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'access-tok' }),
    }));
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fireGoogleAdsConversion(order.id)).rejects.toThrow('network down');

    const [row] = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.id, event.id));
    expect(row.status).toBe('failed');
    expect((row.providerResponse as { stage: string }).stage).toBe('api_fetch');
  });
});
