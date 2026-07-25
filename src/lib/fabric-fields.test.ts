import { describe, expect, it } from 'vitest';
import { effectiveFabricFields } from './fabric-fields';

describe('effectiveFabricFields', () => {
  it('returns fabricFields when defined', () => {
    const fields = [
      { label: 'Outer Fabric', options: ['Cotton Fleece'] },
      { label: 'Hood Lining', options: ['Self-fabric', 'Light mesh'] },
    ];
    expect(effectiveFabricFields({ fabricFields: fields, fabricOptions: ['Legacy'] })).toBe(fields);
  });

  it('adapts a legacy flat fabricOptions list into a single "Fabric" field', () => {
    expect(
      effectiveFabricFields({ fabricFields: [], fabricOptions: ['Poly', 'Mesh'] }),
    ).toEqual([{ label: 'Fabric', options: ['Poly', 'Mesh'] }]);
  });

  it('returns [] when the type has neither', () => {
    expect(effectiveFabricFields({ fabricFields: [], fabricOptions: [] })).toEqual([]);
  });
});
