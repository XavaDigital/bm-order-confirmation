import { describe, expect, it } from 'vitest';
import { effectiveFabrics } from './fabric-fields';

describe('effectiveFabrics', () => {
  it('returns the labeled picks for a typed garment', () => {
    expect(
      effectiveFabrics({
        fabrics: ['ignored'],
        selectedFabrics: { 'Outer Fabric': 'Cotton Fleece', 'Hood Lining': 'Mesh' },
      }),
    ).toEqual(['Cotton Fleece', 'Mesh']);
  });

  it('skips empty pick values', () => {
    expect(
      effectiveFabrics({ fabrics: null, selectedFabrics: { Outer: 'Poly', Lining: '' } }),
    ).toEqual(['Poly']);
  });

  it('falls back to the free-text fabrics list for typeless garments', () => {
    expect(effectiveFabrics({ fabrics: ['Poly', 'Mesh'], selectedFabrics: null })).toEqual([
      'Poly',
      'Mesh',
    ]);
    expect(effectiveFabrics({ fabrics: ['Poly'], selectedFabrics: {} })).toEqual(['Poly']);
  });

  it('returns [] when the garment has neither', () => {
    expect(effectiveFabrics({ fabrics: null, selectedFabrics: null })).toEqual([]);
  });
});
