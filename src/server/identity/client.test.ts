import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    IDENTITY_API_URL: undefined as string | undefined,
    IDENTITY_API_SECRET: undefined as string | undefined,
    IDENTITY_APP_ID: 'order-confirmation',
  },
}));

import { env } from '@/lib/env';
import {
  getIdentityUser,
  getIdentityUserByEmail,
  googleLogin,
  isIdentityConfigured,
  preProvisionUser,
  roleFromGrants,
} from './client';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function configure() {
  env.IDENTITY_API_URL = 'https://identity.example.test';
  env.IDENTITY_API_SECRET = 'secret-value';
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  env.IDENTITY_API_URL = undefined;
  env.IDENTITY_API_SECRET = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The seam ships INERT. Until the identity service hands over a registry row
 * and a secret, nothing here may reach the network — that is what lets this land
 * on main without waiting.
 */
describe('dormant until configured', () => {
  it('is not configured with neither value set', () => {
    expect(isIdentityConfigured()).toBe(false);
  });

  it('is not configured with only a URL', () => {
    env.IDENTITY_API_URL = 'https://identity.example.test';
    expect(isIdentityConfigured()).toBe(false);
  });

  it('is not configured with only a secret', () => {
    env.IDENTITY_API_SECRET = 'secret-value';
    expect(isIdentityConfigured()).toBe(false);
  });

  it('is configured with both', () => {
    configure();
    expect(isIdentityConfigured()).toBe(true);
  });

  it('makes no network call at all while dormant', async () => {
    await googleLogin('credential');
    await getIdentityUser('id');
    await getIdentityUserByEmail('a@b.test');
    await preProvisionUser({ email: 'a@b.test' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports not_configured rather than pretending a login failed', async () => {
    expect(await googleLogin('credential')).toEqual({ reason: 'not_configured' });
  });

  it('returns null from reads while dormant, so callers fall back', async () => {
    expect(await getIdentityUser('id')).toBeNull();
    expect(await preProvisionUser({ email: 'a@b.test' })).toBeNull();
  });
});

describe('googleLogin', () => {
  beforeEach(configure);

  it('sends the credential with the per-app bearer', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { user: { id: 'u1' }, provisioned: false, access: { granted: true, role: 'sales' } }),
    );

    await googleLogin('google-credential');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://identity.example.test/v1/google-login');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer secret-value');
    expect(JSON.parse(init.body)).toEqual({ credential: 'google-credential' });
  });

  it('returns the user and this app’s role on success', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        user: { id: 'u1', email: 'sam@x.com' },
        provisioned: true,
        access: { granted: true, role: 'admin' },
      }),
    );

    const result = await googleLogin('c');

    expect(result).toMatchObject({ provisioned: true, access: { role: 'admin' } });
  });

  it('distinguishes a bad credential', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 'INVALID_CREDENTIAL' }));

    expect(await googleLogin('c')).toEqual({ reason: 'invalid_credential' });
  });

  /**
   * NO_APP_ACCESS is a known colleague without a grant for THIS app — not an
   * unknown person. The two need different words in front of the user, so the
   * client keeps them apart.
   */
  it('distinguishes a known person with no grant for this app', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { message: 'sam@x.com has no access to Order Confirmation', code: 'NO_APP_ACCESS' }),
    );

    const result = await googleLogin('c');

    expect(result).toMatchObject({ reason: 'no_app_access', email: 'sam@x.com' });
  });

  it('reports unavailable for a server error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    expect(await googleLogin('c')).toEqual({ reason: 'unavailable' });
  });

  it('reports unavailable rather than throwing when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await googleLogin('c')).toEqual({ reason: 'unavailable' });
  });
});

/**
 * The asymmetry is the whole point: an outage must not log everyone out, but a
 * genuinely deleted account must not keep working.
 */
describe('getIdentityUser — asymmetric failure', () => {
  beforeEach(configure);

  it('returns the record on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'u1', email: 'sam@x.com', grants: {} }));

    expect(await getIdentityUser('u1')).toMatchObject({ id: 'u1' });
  });

  it('returns null on a transport failure, so the caller can serve stale', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    expect(await getIdentityUser('u1')).toBeNull();
  });

  it('returns null on a 5xx, so the caller can serve stale', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, {}));
    expect(await getIdentityUser('u1')).toBeNull();
  });

  it('returns "gone" on a definitive 404, so the caller can fail closed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'User not found' }));
    expect(await getIdentityUser('u1')).toBe('gone');
  });

  it('url-encodes the id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    await getIdentityUser('weird/id');

    expect(fetchMock.mock.calls[0][0]).toBe('https://identity.example.test/v1/users/weird%2Fid');
  });

  it('url-encodes an email lookup', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    await getIdentityUserByEmail('sam+test@x.com');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://identity.example.test/v1/users/by-email/sam%2Btest%40x.com',
    );
  });
});

describe('preProvisionUser', () => {
  beforeEach(configure);

  it('posts the invite', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'u1', email: 'new@x.com' }));

    await preProvisionUser({ email: 'new@x.com', name: 'New Person' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: 'new@x.com',
      name: 'New Person',
    });
  });

  // "They already exist" is the outcome the caller wanted, and the 409 carries
  // the record, so it is a success rather than an error.
  it('treats a 409 duplicate as success and returns the existing record', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { id: 'existing', email: 'new@x.com' }));

    expect(await preProvisionUser({ email: 'new@x.com' })).toMatchObject({ id: 'existing' });
  });

  it('returns null on a real failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    expect(await preProvisionUser({ email: 'new@x.com' })).toBeNull();
  });
});

describe('roleFromGrants', () => {
  it('reads this app’s role', () => {
    expect(
      roleFromGrants({ 'order-confirmation': { role: 'admin' } }, 'order-confirmation'),
    ).toBe('admin');
  });

  it('ignores another app’s grant', () => {
    expect(roleFromGrants({ 'sales-hub': { role: 'admin' } }, 'order-confirmation')).toBeNull();
  });

  // Never silently default: an unrecognised role must leave the caller's current
  // role alone rather than becoming 'sales'.
  it('returns null for a role this app does not understand', () => {
    expect(
      roleFromGrants({ 'order-confirmation': { role: 'superuser' } }, 'order-confirmation'),
    ).toBeNull();
  });

  it('returns null for an empty grants map', () => {
    expect(roleFromGrants({}, 'order-confirmation')).toBeNull();
  });
});
