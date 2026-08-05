import { describe, expect, it } from 'vitest';
import { formatFileSize, groupPoFiles } from './po-files-helpers';

const file = (category: string | null, id: string) => ({ id, category });

describe('groupPoFiles', () => {
  it('groups by category in first-appearance order, uncategorised LAST', () => {
    const groups = groupPoFiles([
      file('Layout', 'a'),
      file(null, 'b'),
      file('Test print', 'c'),
      file('Layout', 'd'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['Layout', 'Test print', 'uncategorised']);
    expect(groups[2].label).toBe('Other files');
  });

  it('numbers versions per category, oldest = v1 (later files ARE the newer versions)', () => {
    const groups = groupPoFiles([
      file('Layout', 'a'),
      file('Test print', 'b'),
      file('Layout', 'c'),
      file('Layout', 'd'),
    ]);
    const layout = groups.find((g) => g.key === 'Layout')!;
    expect(layout.files.map((f) => [f.id, f.version])).toEqual([
      ['a', 1],
      ['c', 2],
      ['d', 3],
    ]);
    expect(groups.find((g) => g.key === 'Test print')!.files[0].version).toBe(1);
  });

  it('treats categories as exact text — no case-folding merge', () => {
    const groups = groupPoFiles([file('Layout', 'a'), file('layout', 'b')]);
    expect(groups.map((g) => g.key)).toEqual(['Layout', 'layout']);
  });

  it('returns an empty list for no files', () => {
    expect(groupPoFiles([])).toEqual([]);
  });
});

describe('formatFileSize', () => {
  it('formats B / KB / MB and passes null through', () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
