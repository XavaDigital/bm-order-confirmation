import { describe, expect, it } from 'vitest';
import {
  garmentTypeOptionSchema,
  createGarmentTypeSchema,
  updateGarmentTypeSchema,
} from './contract';

describe('garmentTypeOptionSchema', () => {
  it('parses a select option with options and a valid default', () => {
    const parsed = garmentTypeOptionSchema.parse({
      label: 'Zip Type',
      type: 'select',
      options: ['full-zip', 'quarter-zip', 'pullover'],
      defaultOption: 'pullover',
    });
    expect(parsed).toEqual({
      label: 'Zip Type',
      type: 'select',
      options: ['full-zip', 'quarter-zip', 'pullover'],
      defaultOption: 'pullover',
    });
  });

  it('defaults a Sales-Hub-shaped option (no type field) to select', () => {
    const parsed = garmentTypeOptionSchema.parse({
      label: 'Hood Lining Fabric',
      options: ['self-fabric', 'light-fabric'],
      defaultOption: 'self-fabric',
    });
    expect(parsed.type).toBe('select');
  });

  it('rejects a defaultOption that is not one of the options', () => {
    const result = garmentTypeOptionSchema.safeParse({
      label: 'Zip Type',
      type: 'select',
      options: ['full-zip'],
      defaultOption: 'pullover',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a select option with no values', () => {
    const result = garmentTypeOptionSchema.safeParse({
      label: 'Zip Type',
      type: 'select',
      options: [],
    });
    expect(result.success).toBe(false);
  });

  it('parses a free-text option with an optional default value', () => {
    const parsed = garmentTypeOptionSchema.parse({
      label: 'Cord Color',
      type: 'text',
      defaultValue: 'Black',
    });
    expect(parsed).toEqual({ label: 'Cord Color', type: 'text', defaultValue: 'Black' });
  });

  it('parses a checkbox option with an optional default', () => {
    const parsed = garmentTypeOptionSchema.parse({
      label: 'Numbers?',
      type: 'checkbox',
      defaultValue: true,
    });
    expect(parsed).toEqual({ label: 'Numbers?', type: 'checkbox', defaultValue: true });
  });

  it('parses an option with a showWhen rule', () => {
    const parsed = garmentTypeOptionSchema.parse({
      label: 'Numbers Front',
      type: 'checkbox',
      showWhen: { parentLabel: 'Numbers?', equals: ['true'] },
    });
    expect(parsed.showWhen).toEqual({ parentLabel: 'Numbers?', equals: ['true'] });
  });
});

describe('createGarmentTypeSchema', () => {
  it('applies defaults for all optional collections', () => {
    const parsed = createGarmentTypeSchema.parse({ name: 'Pullover Hoodie' });
    expect(parsed).toMatchObject({
      name: 'Pullover Hoodie',
      fabricFields: [],
      orderOptions: [],
      sizeChartIds: [],
      isActive: true,
      sortOrder: 0,
    });
  });

  it('rejects duplicate option labels (case-insensitive)', () => {
    const result = createGarmentTypeSchema.safeParse({
      name: 'Hoodie',
      orderOptions: [
        { label: 'Zip Type', type: 'text' },
        { label: 'zip type', type: 'select', options: ['a'] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a full valid payload', () => {
    const result = createGarmentTypeSchema.safeParse({
      name: 'Hoodie',
      category: 'Hoodies',
      fabricFields: [{ label: 'Outer Fabric', options: ['Cotton Fleece', 'Poly Fleece'] }],
      orderOptions: [
        { label: 'Zip Type', type: 'select', options: ['full-zip', 'pullover'], defaultOption: 'pullover' },
        { label: 'Cord Color', type: 'text' },
      ],
      sizeChartIds: ['4d0f1f3e-58a3-4a44-bb62-cf7c88a11a10'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a chained checkbox: parent + two children gated on it', () => {
    const result = createGarmentTypeSchema.safeParse({
      name: 'Hoodie',
      orderOptions: [
        { label: 'Numbers?', type: 'checkbox' },
        {
          label: 'Numbers Front',
          type: 'checkbox',
          showWhen: { parentLabel: 'Numbers?', equals: ['true'] },
        },
        {
          label: 'Numbers Back',
          type: 'checkbox',
          showWhen: { parentLabel: 'Numbers?', equals: ['true'] },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a showWhen that references an option later in the list', () => {
    const result = createGarmentTypeSchema.safeParse({
      name: 'Hoodie',
      orderOptions: [
        {
          label: 'Numbers Front',
          type: 'checkbox',
          showWhen: { parentLabel: 'Numbers?', equals: ['true'] },
        },
        { label: 'Numbers?', type: 'checkbox' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a showWhen that references its own label', () => {
    const result = createGarmentTypeSchema.safeParse({
      name: 'Hoodie',
      orderOptions: [
        {
          label: 'Numbers?',
          type: 'checkbox',
          showWhen: { parentLabel: 'Numbers?', equals: ['true'] },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a showWhen gated on a free-text parent', () => {
    const result = createGarmentTypeSchema.safeParse({
      name: 'Hoodie',
      orderOptions: [
        { label: 'Cord Color', type: 'text' },
        {
          label: 'Cord Length',
          type: 'text',
          showWhen: { parentLabel: 'Cord Color', equals: ['Black'] },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a showWhen.equals value not in the select parent options', () => {
    const result = createGarmentTypeSchema.safeParse({
      name: 'Hoodie',
      orderOptions: [
        { label: 'Zip Type', type: 'select', options: ['full-zip', 'pullover'] },
        {
          label: 'Zip Color',
          type: 'select',
          options: ['black'],
          showWhen: { parentLabel: 'Zip Type', equals: ['quarter-zip'] },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a showWhen.equals value outside true/false for a checkbox parent', () => {
    const result = createGarmentTypeSchema.safeParse({
      name: 'Hoodie',
      orderOptions: [
        { label: 'Numbers?', type: 'checkbox' },
        {
          label: 'Numbers Front',
          type: 'checkbox',
          showWhen: { parentLabel: 'Numbers?', equals: ['yes'] },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateGarmentTypeSchema', () => {
  it('accepts a partial patch', () => {
    const parsed = updateGarmentTypeSchema.parse({ isActive: false });
    expect(parsed).toEqual({ isActive: false });
  });
});

describe('fabricFields', () => {
  it('accepts labeled fabric fields with option lists', () => {
    const result = createGarmentTypeSchema.parse({
      name: 'Hoodie',
      fabricFields: [
        { label: 'Outer Fabric', options: ['Cotton Fleece'] },
        { label: 'Hood Lining', options: ['Self-fabric', 'Mesh'] },
      ],
    });
    expect(result.fabricFields).toHaveLength(2);
  });

  it('rejects a fabric field without options', () => {
    expect(
      createGarmentTypeSchema.safeParse({
        name: 'Hoodie',
        fabricFields: [{ label: 'Outer Fabric', options: [] }],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate fabric field labels (case-insensitive)', () => {
    expect(
      createGarmentTypeSchema.safeParse({
        name: 'Hoodie',
        fabricFields: [
          { label: 'Outer', options: ['a'] },
          { label: 'outer', options: ['b'] },
        ],
      }).success,
    ).toBe(false);
  });
});
