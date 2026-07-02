import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('hashPassword / verifyPassword', () => {
  it('round-trips: a hashed password verifies against the original plaintext', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a bcrypt hash distinct from the plaintext', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it('salts each hash differently for the same input', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});
