import { describe, expect, it } from 'vitest';
import { unionChartSizes, buildSizeSelectOptions, tallLabel } from './sizes';

describe('unionChartSizes', () => {
  it('unions in chart order, deduping labels case-insensitively (first wins)', () => {
    const result = unionChartSizes([
      { sizes: [{ label: 'S', tall: false }, { label: 'M', tall: false }] },
      { sizes: [{ label: 'm', tall: false }, { label: 'L', tall: false }] },
    ]);
    expect(result).toEqual([
      { label: 'S', tall: false },
      { label: 'M', tall: false },
      { label: 'L', tall: false },
    ]);
  });

  it('ORs the tall flag across duplicate labels', () => {
    const result = unionChartSizes([
      { sizes: [{ label: 'L', tall: false }] },
      { sizes: [{ label: 'L', tall: true }] },
    ]);
    expect(result).toEqual([{ label: 'L', tall: true }]);
  });

  it('handles empty charts and missing size arrays', () => {
    expect(unionChartSizes([])).toEqual([]);
    expect(unionChartSizes([{ sizes: [] }])).toEqual([]);
    expect(
      unionChartSizes([{ sizes: undefined as unknown as [] }, { sizes: [{ label: 'M', tall: false }] }]),
    ).toEqual([{ label: 'M', tall: false }]);
  });
});

describe('buildSizeSelectOptions', () => {
  it('emits the tall variant immediately after its base size', () => {
    const options = buildSizeSelectOptions([
      { label: 'M', tall: false },
      { label: 'L', tall: true },
      { label: 'XL', tall: true },
    ]);
    expect(options.map((o) => o.value)).toEqual(['M', 'L', 'L Tall', 'XL', 'XL Tall']);
  });

  it('tallLabel composes the stored value verbatim', () => {
    expect(tallLabel('3XL')).toBe('3XL Tall');
  });
});
