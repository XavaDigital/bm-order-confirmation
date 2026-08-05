import { describe, expect, it } from 'vitest';
import type { GarmentTypeOption } from '@/db/schema';
import {
  visibleOptionLabels,
  isOptionVisible,
  resolveVisibleOptions,
  typeOptionDefaults,
} from './visibility';

const numbersChain: GarmentTypeOption[] = [
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
];

describe('visibleOptionLabels / isOptionVisible', () => {
  it('an option with no showWhen is always visible', () => {
    const opts: GarmentTypeOption[] = [{ label: 'Zip Type', type: 'select', options: ['full'] }];
    expect(visibleOptionLabels(opts, {})).toEqual(new Set(['Zip Type']));
  });

  it('shows a child when the checkbox parent matches', () => {
    const visible = visibleOptionLabels(numbersChain, { 'Numbers?': 'true' });
    expect(visible).toEqual(new Set(['Numbers?', 'Numbers Front', 'Numbers Back']));
  });

  it('hides children when the checkbox parent is unchecked', () => {
    const visible = visibleOptionLabels(numbersChain, { 'Numbers?': 'false' });
    expect(visible).toEqual(new Set(['Numbers?']));
  });

  it('hides children when the parent value is absent entirely', () => {
    const visible = visibleOptionLabels(numbersChain, {});
    expect(visible).toEqual(new Set(['Numbers?']));
  });

  it('a hidden parent hides its grandchildren transitively', () => {
    const chain: GarmentTypeOption[] = [
      { label: 'Numbers?', type: 'checkbox' },
      {
        label: 'Numbers Front',
        type: 'checkbox',
        showWhen: { parentLabel: 'Numbers?', equals: ['true'] },
      },
      {
        label: 'Front Color',
        type: 'select',
        options: ['white', 'black'],
        showWhen: { parentLabel: 'Numbers Front', equals: ['true'] },
      },
    ];
    // Numbers? is unchecked -> Numbers Front hidden -> Front Color hidden too,
    // even though its own parent value (if evaluated in isolation) would match.
    const visible = visibleOptionLabels(chain, {
      'Numbers?': 'false',
      'Numbers Front': 'true',
    });
    expect(visible).toEqual(new Set(['Numbers?']));
  });

  it('select parent gates on its own values', () => {
    const opts: GarmentTypeOption[] = [
      { label: 'Zip Type', type: 'select', options: ['full-zip', 'pullover'] },
      {
        label: 'Zip Color',
        type: 'select',
        options: ['black', 'white'],
        showWhen: { parentLabel: 'Zip Type', equals: ['full-zip'] },
      },
    ];
    expect(isOptionVisible(opts, 'Zip Color', { 'Zip Type': 'full-zip' })).toBe(true);
    expect(isOptionVisible(opts, 'Zip Color', { 'Zip Type': 'pullover' })).toBe(false);
  });
});

describe('resolveVisibleOptions', () => {
  it('drops a hidden child value but keeps the visible parent + sibling', () => {
    const pruned = resolveVisibleOptions(numbersChain, {
      'Numbers?': 'false',
      'Numbers Front': 'true',
      'Numbers Back': 'true',
    });
    expect(pruned).toEqual({ 'Numbers?': 'false' });
  });

  it('keeps a child value when its parent matches', () => {
    const pruned = resolveVisibleOptions(numbersChain, {
      'Numbers?': 'true',
      'Numbers Front': 'true',
    });
    expect(pruned).toEqual({ 'Numbers?': 'true', 'Numbers Front': 'true' });
  });

  it('leaves keys with no matching option definition untouched', () => {
    const pruned = resolveVisibleOptions(numbersChain, {
      'Numbers?': 'false',
      'Some Legacy Field': 'kept',
    });
    expect(pruned).toEqual({ 'Numbers?': 'false', 'Some Legacy Field': 'kept' });
  });

  it('passes through null/undefined unchanged', () => {
    expect(resolveVisibleOptions(numbersChain, null)).toBeNull();
    expect(resolveVisibleOptions(numbersChain, undefined)).toBeNull();
  });
});

describe('typeOptionDefaults', () => {
  it('includes defaults for options with no showWhen', () => {
    const opts: GarmentTypeOption[] = [
      { label: 'Zip Type', type: 'select', options: ['full-zip'], defaultOption: 'full-zip' },
      { label: 'Notes', type: 'text', defaultValue: 'std' },
      { label: 'Rush?', type: 'checkbox', defaultValue: true },
    ];
    expect(typeOptionDefaults(opts)).toEqual({
      'Zip Type': 'full-zip',
      Notes: 'std',
      'Rush?': 'true',
    });
  });

  it('does not pre-fill a child whose parent defaults to a non-matching value', () => {
    const chain: GarmentTypeOption[] = [
      { label: 'Numbers?', type: 'checkbox', defaultValue: false },
      {
        label: 'Numbers Front',
        type: 'checkbox',
        defaultValue: true,
        showWhen: { parentLabel: 'Numbers?', equals: ['true'] },
      },
    ];
    expect(typeOptionDefaults(chain)).toEqual({ 'Numbers?': 'false' });
  });

  it('includes a child default when the parent defaults to a matching value', () => {
    const chain: GarmentTypeOption[] = [
      { label: 'Numbers?', type: 'checkbox', defaultValue: true },
      {
        label: 'Numbers Front',
        type: 'checkbox',
        defaultValue: true,
        showWhen: { parentLabel: 'Numbers?', equals: ['true'] },
      },
    ];
    expect(typeOptionDefaults(chain)).toEqual({ 'Numbers?': 'true', 'Numbers Front': 'true' });
  });
});
