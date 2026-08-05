import { describe, expect, it } from 'vitest';
import { applyNameCase } from './names';

describe('applyNameCase', () => {
  it('uppercases when the flag is on', () => {
    expect(applyNameCase(true, 'ava smith')).toBe('AVA SMITH');
    expect(applyNameCase(true, 'MiXeD cAsE')).toBe('MIXED CASE');
  });

  it('returns the value exactly as entered when the flag is off', () => {
    expect(applyNameCase(false, 'ava smith')).toBe('ava smith');
    expect(applyNameCase(false, 'ALREADY CAPS')).toBe('ALREADY CAPS');
  });

  it('passes null and undefined through untouched regardless of the flag', () => {
    expect(applyNameCase(true, null)).toBeNull();
    expect(applyNameCase(true, undefined)).toBeUndefined();
    expect(applyNameCase(false, null)).toBeNull();
    expect(applyNameCase(false, undefined)).toBeUndefined();
  });

  it('handles accented and non-Latin names (locale-independent uppercase)', () => {
    expect(applyNameCase(true, 'josé muñoz')).toBe('JOSÉ MUÑOZ');
    expect(applyNameCase(true, 'björk')).toBe('BJÖRK');
    // No uppercase form — must survive unchanged, not throw.
    expect(applyNameCase(true, '山田太郎')).toBe('山田太郎');
  });

  it('leaves digits and punctuation alone', () => {
    expect(applyNameCase(true, "o'brien-smith 7")).toBe("O'BRIEN-SMITH 7");
  });

  it('an empty string stays empty either way', () => {
    expect(applyNameCase(true, '')).toBe('');
    expect(applyNameCase(false, '')).toBe('');
  });
});
