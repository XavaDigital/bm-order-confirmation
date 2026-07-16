import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ NODE_ENV: 'test' as string, SENTRY_DSN: undefined as string | undefined }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

import { logger } from './logger';

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    mockEnv.NODE_ENV = 'test';
    mockEnv.SENTRY_DSN = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pretty-prints info/warn/error in non-production', () => {
    logger.info('hello', { a: 1 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('INFO hello');
    expect(logSpy.mock.calls[0][1]).toEqual({ a: 1 });

    logger.warn('careful');
    expect(warnSpy.mock.calls[0][0]).toContain('WARN careful');

    logger.error('boom');
    expect(errorSpy.mock.calls[0][0]).toContain('ERROR boom');
  });

  it('emits single-line JSON in production', () => {
    mockEnv.NODE_ENV = 'production';
    logger.warn('careful', { orderId: '123' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [line] = warnSpy.mock.calls[0];
    const parsed = JSON.parse(line as string);
    expect(parsed).toMatchObject({ level: 'warn', message: 'careful' });
    expect(parsed.context).toEqual([{ orderId: '123' }]);
    expect(parsed.time).toEqual(expect.any(String));
  });

  it('serializes Error instances into name/message/stack in production JSON', () => {
    mockEnv.NODE_ENV = 'production';
    logger.error('boom', new Error('bad'));

    const [line] = errorSpy.mock.calls[0];
    const parsed = JSON.parse(line as string);
    expect(parsed.context[0]).toMatchObject({ name: 'Error', message: 'bad' });
    expect(parsed.context[0].stack).toEqual(expect.any(String));
  });

  it('does not call fetch when SENTRY_DSN is unset', async () => {
    logger.error('boom', new Error('bad'));
    await flushMicrotasks();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not report to Sentry for info/warn levels even when SENTRY_DSN is set', async () => {
    mockEnv.SENTRY_DSN = 'https://publickey@o123.ingest.sentry.io/456';
    logger.info('fyi');
    logger.warn('careful');
    await flushMicrotasks();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs a Sentry envelope when SENTRY_DSN is set', async () => {
    mockEnv.SENTRY_DSN = 'https://publickey@o123.ingest.sentry.io/456';
    logger.error('boom', new Error('bad thing'));
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://o123.ingest.sentry.io/api/456/envelope/?sentry_key=publickey&sentry_version=7');
    expect(init.method).toBe('POST');

    const lines = String(init.body)
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual({ type: 'event' });
    expect(lines[2].exception.values[0]).toMatchObject({ type: 'Error', value: 'bad thing' });
    expect(lines[2].message).toEqual({ formatted: 'boom' });
  });

  it('never throws or rejects when the Sentry POST fails', async () => {
    mockEnv.SENTRY_DSN = 'https://publickey@o123.ingest.sentry.io/456';
    fetchSpy.mockRejectedValue(new Error('network down'));

    expect(() => logger.error('boom', new Error('bad'))).not.toThrow();
    await flushMicrotasks();
  });

  it('does nothing (no fetch) when SENTRY_DSN is malformed', async () => {
    mockEnv.SENTRY_DSN = 'not-a-valid-dsn';
    logger.error('boom', new Error('bad'));
    await flushMicrotasks();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
