import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  CAPABILITY_API_URL: undefined as string | undefined,
  CAPABILITY_API_SECRET: undefined as string | undefined,
}));

vi.mock('@/lib/env', () => ({ env: envMock }));

import {
  isHubConfigured,
  searchHubCustomers,
  getHubCustomer,
  getHubCustomersByIds,
  createHubCustomer,
} from './client';

function configure() {
  envMock.CAPABILITY_API_URL = 'https://sales.example.com/api/capability/v1';
  envMock.CAPABILITY_API_SECRET = 'fleet-secret';
}

beforeEach(() => {
  envMock.CAPABILITY_API_URL = undefined;
  envMock.CAPABILITY_API_SECRET = undefined;
  vi.stubGlobal('fetch', vi.fn());
});

describe('hub client — unconfigured (dormant)', () => {
  it('reports unconfigured and every call no-ops without touching the network', async () => {
    expect(isHubConfigured()).toBe(false);
    expect(await searchHubCustomers('wildcats')).toEqual([]);
    expect(await getHubCustomer('abc')).toBeNull();
    expect(await getHubCustomersByIds(['a', 'b'])).toEqual([]);
    expect(await createHubCustomer({ name: 'X' })).toEqual({ outcome: 'error' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('hub client — configured', () => {
  it('search sends the bearer secret and normalizes displayName to name', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'c1', displayName: 'Wildcats Netball', email: 'club@x.nz' }],
    } as Response);

    const results = await searchHubCustomers('wildcats');

    expect(fetch).toHaveBeenCalledWith(
      'https://sales.example.com/api/capability/v1/customers?search=wildcats&limit=20',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fleet-secret' }),
      }),
    );
    expect(results).toEqual([{ id: 'c1', name: 'Wildcats Netball', email: 'club@x.nz' }]);
  });

  // The LIVE hub wraps list responses in { items } (bm-sales routes.ts) —
  // the bare-array fixture above is kept only as shape tolerance. This test
  // exists because the search shipped parsing an array and returned [] for
  // every real query (found live 2026-08-02).
  it('search parses the real { items } envelope', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ id: 'c1', displayName: 'Wildcats Netball', name: 'Wildcats Netball', email: 'club@x.nz' }],
      }),
    } as Response);

    expect(await searchHubCustomers('wildcats')).toEqual([
      { id: 'c1', name: 'Wildcats Netball', email: 'club@x.nz' },
    ]);
  });

  it('bulk ids lookup parses the { items } envelope too', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ id: 'c2', name: 'Sharks FC', email: null }] }),
    } as Response);

    expect(await getHubCustomersByIds(['c2'])).toEqual([
      { id: 'c2', name: 'Sharks FC', email: null },
    ]);
  });

  it('search skips queries shorter than 2 characters', async () => {
    configure();
    expect(await searchHubCustomers('a')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns [] instead of throwing on a network failure', async () => {
    configure();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await searchHubCustomers('wildcats')).toEqual([]);
  });

  it('getHubCustomer surfaces merge tombstone resolution via resolvedFrom', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'survivor', name: 'Wildcats', resolvedFrom: 'merged-away' }),
    } as Response);

    const customer = await getHubCustomer('merged-away');
    expect(customer).toMatchObject({ id: 'survivor', resolvedFrom: 'merged-away' });
  });

  it('getHubCustomersByIds chunks large id lists', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as Response);

    await getHubCustomersByIds(Array.from({ length: 150 }, (_, i) => `id-${i}`));

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('createHubCustomer passes X-Acting-User and maps 409 to an ambiguous outcome', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ candidates: [{ id: 'c1', name: 'Wildcats A' }, { id: 'c2', name: 'Wildcats B' }] }),
    } as Response);

    const result = await createHubCustomer({ name: 'Wildcats', email: 'club@x.nz' }, 'core-user-1');

    expect(fetch).toHaveBeenCalledWith(
      'https://sales.example.com/api/capability/v1/customers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Acting-User': 'core-user-1' }),
      }),
    );
    expect(result.outcome).toBe('ambiguous');
    if (result.outcome === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it('createHubCustomer maps a success to linked with the created customer', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'c9', name: 'Wildcats', isProvisional: true }),
    } as Response);

    const result = await createHubCustomer({ name: 'Wildcats' });
    expect(result).toEqual({
      outcome: 'linked',
      customer: { id: 'c9', name: 'Wildcats', email: null, isProvisional: true },
    });
  });
});
