import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'ok' });
  });
});
