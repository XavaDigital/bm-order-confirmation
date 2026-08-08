/**
 * Per-garment readiness (David, 2026-08-08) — the pure half.
 *
 * These four requirements decide whether a purchase order can be sent, so the
 * cases that matter most are the ones where a garment legitimately has nothing
 * to answer: a typeless garment has no options, and a garment whose required
 * option is hidden by another answer is not missing anything. Getting those
 * wrong would block jobs that are perfectly specified, and a check that cries
 * wolf gets sidestepped or switched off.
 */
import { describe, expect, it } from 'vitest';
import { garmentIssues } from './garment-readiness';

function garment(overrides: Record<string, unknown> = {}) {
  return {
    images: [{ id: 'img-1' }],
    sizeChartLinks: [{ id: 'link-1' }],
    fabrics: ['Polyester'],
    selectedFabrics: null,
    selectedOptions: null,
    garmentType: null,
    ...overrides,
  } as Parameters<typeof garmentIssues>[0];
}

describe('garmentIssues — a fully specified garment', () => {
  it('reports nothing', () => {
    expect(garmentIssues(garment())).toEqual([]);
  });

  // Typeless garments keep the legacy free-text fabric list and have no option
  // set at all, so nothing can be required of them.
  it('reports nothing for a typeless garment with free-text fabrics', () => {
    expect(garmentIssues(garment({ garmentType: null, fabrics: ['Cotton'] }))).toEqual([]);
  });

  it('accepts fabrics chosen through a garment type instead of the free-text list', () => {
    const issues = garmentIssues(
      garment({ fabrics: null, selectedFabrics: { Body: 'Mesh' } }),
    );
    expect(issues).toEqual([]);
  });
});

describe('garmentIssues — what is missing', () => {
  it('flags a garment with no image', () => {
    expect(garmentIssues(garment({ images: [] }))).toEqual([
      { requirement: 'image', label: 'No image uploaded' },
    ]);
  });

  it('flags a garment with no size chart', () => {
    expect(garmentIssues(garment({ sizeChartLinks: [] }))).toEqual([
      { requirement: 'sizeChart', label: 'No size chart linked' },
    ]);
  });

  it('flags a garment with no fabric at all', () => {
    expect(garmentIssues(garment({ fabrics: null, selectedFabrics: null }))).toEqual([
      { requirement: 'fabric', label: 'No fabric selected' },
    ]);
  });

  it('treats an empty fabric list as no fabric', () => {
    expect(garmentIssues(garment({ fabrics: [], selectedFabrics: {} }))).toEqual([
      { requirement: 'fabric', label: 'No fabric selected' },
    ]);
  });

  // The label names the options, because "required options not set" without
  // saying which is not something anyone can act on.
  it('names the unanswered required options', () => {
    const issues = garmentIssues(
      garment({
        selectedOptions: {},
        garmentType: {
          orderOptions: [
            { label: 'Cord Color', type: 'select', options: ['black'], required: true },
            { label: 'Button Color', type: 'select', options: ['white'], required: true },
          ],
        },
      }),
    );

    expect(issues).toEqual([
      { requirement: 'requiredOptions', label: 'Required options not set: Cord Color, Button Color' },
    ]);
  });

  it('is satisfied once the required options are answered', () => {
    const issues = garmentIssues(
      garment({
        selectedOptions: { 'Cord Color': 'black' },
        garmentType: {
          orderOptions: [
            { label: 'Cord Color', type: 'select', options: ['black'], required: true },
          ],
        },
      }),
    );

    expect(issues).toEqual([]);
  });

  it('does not require an option that is not marked required', () => {
    const issues = garmentIssues(
      garment({
        selectedOptions: {},
        garmentType: {
          orderOptions: [{ label: 'Trim', type: 'select', options: ['a'], required: false }],
        },
      }),
    );

    expect(issues).toEqual([]);
  });

  it('lists every gap at once rather than stopping at the first', () => {
    const issues = garmentIssues(
      garment({ images: [], sizeChartLinks: [], fabrics: null, selectedFabrics: null }),
    );

    expect(issues.map((i) => i.requirement)).toEqual(['image', 'sizeChart', 'fabric']);
  });
});
