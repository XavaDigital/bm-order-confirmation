import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { processOutbox } = vi.hoisted(() => ({
  processOutbox: vi.fn().mockResolvedValue({ processed: 0, delivered: 0, failed: 0 }),
}));

vi.mock('@/server/events/processor', () => ({ processOutbox }));

import { POST } from './route';

const API_KEY = 'test-internal-api-key-0123456789';
const CRON_SECRET = 'test-cron-secret-not-a-real-secret-0123456789';

function postRequest(apiKey?: string) {
  return new NextRequest('http://localhost/api/internal/process-outbox', {
    method: 'POST',
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  });
}

function postRequestWithBearer(token: string) {
  return new NextRequest('http://localhost/api/internal/process-outbox', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('POST /api/internal/process-outbox', () => {
  beforeEach(() => {
    processOutbox.mockClear();
  });

  it('returns 401 with a missing x-api-key and does not process anything', async () => {
    const res = await POST(postRequest());
    expect(res.status).toBe(401);
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong x-api-key', async () => {
    const res = await POST(postRequest('wrong-key'));
    expect(res.status).toBe(401);
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it('returns 200 with the processor result for a valid key', async () => {
    processOutbox.mockResolvedValueOnce({ processed: 3, delivered: 2, failed: 1 });

    const res = await POST(postRequest(API_KEY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ processed: 3, delivered: 2, failed: 1 });
    expect(processOutbox).toHaveBeenCalledTimes(1);
  });

  it('returns 401 with a wrong CRON_SECRET bearer token', async () => {
    const res = await POST(postRequestWithBearer('wrong-secret'));
    expect(res.status).toBe(401);
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it('returns 200 for a Vercel Cron request authenticated via Authorization: Bearer $CRON_SECRET', async () => {
    processOutbox.mockResolvedValueOnce({ processed: 1, delivered: 1, failed: 0 });

    const res = await POST(postRequestWithBearer(CRON_SECRET));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ processed: 1, delivered: 1, failed: 0 });
    expect(processOutbox).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the processor throws', async () => {
    processOutbox.mockRejectedValueOnce(new Error('db exploded'));

    const res = await POST(postRequest(API_KEY));
    expect(res.status).toBe(500);
  });
});
