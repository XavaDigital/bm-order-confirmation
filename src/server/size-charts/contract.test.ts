import { describe, expect, it } from 'vitest';
import {
  sizeChartSizeSchema,
  sizeChartSizesSchema,
  sizeChartSizesFormSchema,
} from './contract';

describe('sizeChartSizeSchema', () => {
  it('defaults tall to false', () => {
    expect(sizeChartSizeSchema.parse({ label: 'M' })).toEqual({ label: 'M', tall: false });
  });

  it('trims and bounds the label', () => {
    expect(sizeChartSizeSchema.parse({ label: '  XL ', tall: true })).toEqual({
      label: 'XL',
      tall: true,
    });
    expect(sizeChartSizeSchema.safeParse({ label: '' }).success).toBe(false);
    expect(sizeChartSizeSchema.safeParse({ label: 'x'.repeat(31) }).success).toBe(false);
  });
});

describe('sizeChartSizesSchema', () => {
  it('rejects duplicate labels case-insensitively', () => {
    const result = sizeChartSizesSchema.safeParse([
      { label: 'M', tall: false },
      { label: 'm', tall: true },
    ]);
    expect(result.success).toBe(false);
  });

  it('accepts an ordered list with tall flags', () => {
    const result = sizeChartSizesSchema.parse([
      { label: 'S' },
      { label: 'M', tall: true },
    ]);
    expect(result).toEqual([
      { label: 'S', tall: false },
      { label: 'M', tall: true },
    ]);
  });
});

describe('sizeChartSizesFormSchema (JSON-string form field)', () => {
  it('parses a JSON-encoded size list', () => {
    const result = sizeChartSizesFormSchema.parse(
      JSON.stringify([{ label: 'L', tall: true }]),
    );
    expect(result).toEqual([{ label: 'L', tall: true }]);
  });

  it('rejects malformed JSON with a schema issue, not a throw', () => {
    const result = sizeChartSizesFormSchema.safeParse('{not json');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/valid JSON/);
    }
  });

  it('rejects JSON of the wrong shape', () => {
    expect(sizeChartSizesFormSchema.safeParse('{"label":"M"}').success).toBe(false);
  });
});
