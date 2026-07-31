import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { sendPendingNotificationEmails } = vi.hoisted(() => ({
  sendPendingNotificationEmails: vi.fn().mockResolvedValue({ processed: 0, sent: 0, failed: 0 }),
}));

vi.mock('@/server/notifications/email-sender', () => ({ sendPendingNotificationEmails }));

import { GET, POST } from './route';

const API_KEY = 'test-internal-api-key-0123456789';
const CRON_SECRET = 'test-cron-secret-not-a-real-secret-0123456789';

function postRequest(apiKey?: string) {
  return new NextRequest('http://localhost/api/internal/send-notification-emails', {
    method: 'POST',
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  });
}

function postRequestWithBearer(token: string) {
  return new NextRequest('http://localhost/api/internal/send-notification-emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('POST /api/internal/send-notification-emails', () => {
  beforeEach(() => {
    sendPendingNotificationEmails.mockClear();
  });

  it('returns 401 with a missing x-api-key and does not send anything', async () => {
    const res = await POST(postRequest());
    expect(res.status).toBe(401);
    expect(sendPendingNotificationEmails).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong x-api-key', async () => {
    const res = await POST(postRequest('wrong-key'));
    expect(res.status).toBe(401);
    expect(sendPendingNotificationEmails).not.toHaveBeenCalled();
  });

  it('returns 200 with the sender result for a valid key', async () => {
    sendPendingNotificationEmails.mockResolvedValueOnce({ processed: 3, sent: 2, failed: 1 });

    const res = await POST(postRequest(API_KEY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ processed: 3, sent: 2, failed: 1 });
    expect(sendPendingNotificationEmails).toHaveBeenCalledTimes(1);
  });

  it('returns 401 with a wrong CRON_SECRET bearer token', async () => {
    const res = await POST(postRequestWithBearer('wrong-secret'));
    expect(res.status).toBe(401);
    expect(sendPendingNotificationEmails).not.toHaveBeenCalled();
  });

  it('returns 200 for a scheduler request authenticated via Authorization: Bearer $CRON_SECRET', async () => {
    sendPendingNotificationEmails.mockResolvedValueOnce({ processed: 1, sent: 1, failed: 0 });

    const res = await POST(postRequestWithBearer(CRON_SECRET));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(sendPendingNotificationEmails).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the sender throws', async () => {
    sendPendingNotificationEmails.mockRejectedValueOnce(new Error('smtp exploded'));

    const res = await POST(postRequest(API_KEY));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/internal/send-notification-emails', () => {
  beforeEach(() => {
    sendPendingNotificationEmails.mockClear();
  });

  function getRequest(headers?: Record<string, string>) {
    return new NextRequest('http://localhost/api/internal/send-notification-emails', {
      method: 'GET',
      headers,
    });
  }

  it('is exported and behaves identically to POST for a valid bearer', async () => {
    sendPendingNotificationEmails.mockResolvedValueOnce({ processed: 2, sent: 2, failed: 0 });

    const res = await GET(getRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ processed: 2, sent: 2, failed: 0 });
    expect(sendPendingNotificationEmails).toHaveBeenCalledTimes(1);
  });

  it('accepts the x-api-key path too', async () => {
    const res = await GET(getRequest({ 'x-api-key': API_KEY }));
    expect(res.status).toBe(200);
  });

  it('still rejects an unauthenticated GET', async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    expect(sendPendingNotificationEmails).not.toHaveBeenCalled();
  });
});
