import { describe, expect, it } from 'vitest';
import { findDuplicateNumbers } from './collisions';

describe('findDuplicateNumbers', () => {
  it('flags a number used by more than one entry', () => {
    expect(findDuplicateNumbers(['7', '10', '7'])).toEqual(new Set(['7']));
  });

  it('ignores blank and null entries', () => {
    expect(findDuplicateNumbers(['', null, undefined, '', null])).toEqual(new Set());
  });

  it('trims whitespace before comparing', () => {
    expect(findDuplicateNumbers([' 9', '9 '])).toEqual(new Set(['9']));
  });

  it('returns an empty set when nothing collides', () => {
    expect(findDuplicateNumbers(['1', '2', '3'])).toEqual(new Set());
  });
});
