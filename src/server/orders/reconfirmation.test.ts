/**
 * The change detector behind re-confirmation (David, 2026-08-07). Everything
 * downstream — the banner, the hold on sending a purchase order, the request to
 * the customer — is a consequence of what this says, so it is tested hardest at
 * two edges: it must not cry wolf on an untouched order, and it must not stay
 * silent when the substance of the job changed.
 */
import { describe, expect, it } from 'vitest';
import { diffAgainstConfirmation } from './reconfirmation';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: 'BM-1042',
    customerName: 'Jane Coach',
    clubName: 'Northside FC',
    orderValueAmount: '1200.00',
    orderValueCurrency: 'NZD',
    expectedShipDate: '2026-09-01',
    deadlineDate: '2026-09-15',
    invoiceUrl: null,
    generalNotes: null,
    shippingAddress: { line1: '1 Main St', city: 'Auckland', country: 'NZ' },
    garments: [
      {
        name: 'Home Jersey',
        notes: null,
        fabrics: ['Polyester'],
        selectedOptions: null,
        selectedFabrics: null,
        sizeChartNames: ['Adult Jersey'],
        sizing: [
          { size: 'M', quantity: 10, playerName: null, playerNumber: null },
          { size: 'L', quantity: 10, playerName: null, playerNumber: null },
        ],
      },
    ],
    ...overrides,
  };
}

function garment(overrides: Record<string, unknown> = {}) {
  return { ...snapshot().garments[0], ...overrides };
}

describe('diffAgainstConfirmation — nothing changed', () => {
  it('reports no changes for an identical order', () => {
    const result = diffAgainstConfirmation(snapshot(), snapshot());

    expect(result.changes).toEqual([]);
    expect(result.hasMaterialChanges).toBe(false);
  });

  // Older snapshots use snake_case keys. Without this, every order confirmed
  // before 2026-07-26 would report every field as changed the day this shipped.
  it('reads a legacy snake_case snapshot without reporting false changes', () => {
    const legacy = {
      order_value_amount: '1200.00',
      order_value_currency: 'NZD',
      club_name: 'Northside FC',
      expected_ship_date: '2026-09-01',
      deadline_date: '2026-09-15',
      invoice_url: null,
      general_notes: null,
      shipping_address: { line1: '1 Main St', city: 'Auckland', country: 'NZ' },
      garments: snapshot().garments,
    };

    expect(diffAgainstConfirmation(legacy, snapshot()).changes).toEqual([]);
  });

  // A garment list that is reordered is the same agreement.
  it('does not report reordered garments as changed', () => {
    const before = snapshot({
      garments: [garment({ name: 'Home Jersey' }), garment({ name: 'Away Jersey' })],
    });
    const after = snapshot({
      garments: [garment({ name: 'Away Jersey' }), garment({ name: 'Home Jersey' })],
    });

    expect(diffAgainstConfirmation(before, after).changes).toEqual([]);
  });

  /**
   * The stored side has been through Postgres `jsonb`, which does not preserve
   * object key order; the live side carries JavaScript insertion order. Compare
   * those with a plain JSON.stringify and every re-confirmed order reads as
   * still-changed forever, holding its purchase order with it.
   */
  it('ignores object key order, which jsonb does not preserve', () => {
    const before = snapshot({
      shippingAddress: { line1: '1 Main St', city: 'Auckland', country: 'NZ' },
      garments: [
        {
          ...snapshot().garments[0],
          sizing: [{ size: 'M', quantity: 10, playerName: null, playerNumber: null }],
        },
      ],
    });
    const after = snapshot({
      // Same values, keys written in a different order.
      shippingAddress: { country: 'NZ', city: 'Auckland', line1: '1 Main St' },
      garments: [
        {
          ...snapshot().garments[0],
          sizing: [{ playerNumber: null, quantity: 10, playerName: null, size: 'M' }],
        },
      ],
    });

    expect(diffAgainstConfirmation(before, after).changes).toEqual([]);
  });

  // A list is not a set: two sizing rows swapped is a different document.
  it('still notices when array ORDER changes', () => {
    const before = snapshot();
    const after = snapshot({
      garments: [
        {
          ...snapshot().garments[0],
          sizing: [
            { size: 'L', quantity: 10, playerName: null, playerNumber: null },
            { size: 'M', quantity: 10, playerName: null, playerNumber: null },
          ],
        },
      ],
    });

    expect(diffAgainstConfirmation(before, after).changes.map((c) => c.key)).toContain(
      'garment:Home Jersey:sizing',
    );
  });

  it('treats a null and a missing value as the same "not set"', () => {
    const before = snapshot({ invoiceUrl: null });
    const withoutKey: Record<string, unknown> = snapshot();
    delete withoutKey.invoiceUrl;

    expect(diffAgainstConfirmation(before, withoutKey).changes).toEqual([]);
  });
});

describe('diffAgainstConfirmation — material changes', () => {
  it('flags a changed order value, saying what it was and what it is', () => {
    const result = diffAgainstConfirmation(snapshot(), snapshot({ orderValueAmount: '1450.00' }));

    expect(result.hasMaterialChanges).toBe(true);
    expect(result.changes).toContainEqual({
      key: 'orderValueAmount',
      severity: 'material',
      label: 'Order value: 1200.00 → 1450.00',
    });
  });

  it('flags a changed delivery address', () => {
    const result = diffAgainstConfirmation(
      snapshot(),
      snapshot({ shippingAddress: { line1: '9 Other Rd', city: 'Wellington', country: 'NZ' } }),
    );

    expect(result.hasMaterialChanges).toBe(true);
    expect(result.changes.map((c) => c.key)).toContain('shippingAddress');
  });

  it('flags an added garment by name', () => {
    const result = diffAgainstConfirmation(
      snapshot(),
      snapshot({ garments: [garment(), garment({ name: 'Training Top' })] }),
    );

    expect(result.hasMaterialChanges).toBe(true);
    expect(result.changes).toContainEqual({
      key: 'garment:Training Top:added',
      severity: 'material',
      label: 'Garment added: Training Top',
    });
  });

  it('flags a removed garment by name', () => {
    const result = diffAgainstConfirmation(
      snapshot({ garments: [garment(), garment({ name: 'Training Top' })] }),
      snapshot(),
    );

    expect(result.changes).toContainEqual({
      key: 'garment:Training Top:removed',
      severity: 'material',
      label: 'Garment removed: Training Top',
    });
  });

  // The number people check without opening the order.
  it('reports a quantity change as a before and after total', () => {
    const result = diffAgainstConfirmation(
      snapshot(),
      snapshot({
        garments: [
          garment({
            sizing: [
              { size: 'M', quantity: 10, playerName: null, playerNumber: null },
              { size: 'L', quantity: 14, playerName: null, playerNumber: null },
            ],
          }),
        ],
      }),
    );

    expect(result.changes).toContainEqual({
      key: 'garment:Home Jersey:quantity',
      severity: 'material',
      label: 'Home Jersey: quantity 20 → 24',
    });
  });

  it('counts a sizing row with no quantity as one item', () => {
    const before = snapshot({ garments: [garment({ sizing: [{ size: 'M' }] })] });
    const after = snapshot({ garments: [garment({ sizing: [{ size: 'M' }, { size: 'L' }] })] });

    expect(diffAgainstConfirmation(before, after).changes).toContainEqual(
      expect.objectContaining({ label: 'Home Jersey: quantity 1 → 2' }),
    );
  });

  // A swapped size at the same total is still not what they agreed to.
  it('flags changed sizes even when the total quantity is unchanged', () => {
    const result = diffAgainstConfirmation(
      snapshot(),
      snapshot({
        garments: [
          garment({
            sizing: [
              { size: 'S', quantity: 10, playerName: null, playerNumber: null },
              { size: 'L', quantity: 10, playerName: null, playerNumber: null },
            ],
          }),
        ],
      }),
    );

    expect(result.hasMaterialChanges).toBe(true);
    expect(result.changes.map((c) => c.key)).toContain('garment:Home Jersey:sizing');
    expect(result.changes.map((c) => c.key)).not.toContain('garment:Home Jersey:quantity');
  });

  it('flags changed fabric or options', () => {
    const result = diffAgainstConfirmation(
      snapshot(),
      snapshot({ garments: [garment({ selectedFabrics: { Body: 'Mesh' } })] }),
    );

    expect(result.hasMaterialChanges).toBe(true);
    expect(result.changes.map((c) => c.key)).toContain('garment:Home Jersey:options');
  });

  // Renaming is reported as a removal plus an addition: the customer agreed to
  // a line called something else, and saying so is more honest than "renamed".
  it('reads a renamed garment as one removed and one added', () => {
    const result = diffAgainstConfirmation(
      snapshot(),
      snapshot({ garments: [garment({ name: 'Home Shirt' })] }),
    );

    expect(result.changes.map((c) => c.key)).toEqual(
      expect.arrayContaining(['garment:Home Jersey:removed', 'garment:Home Shirt:added']),
    );
  });

  it('distinguishes unnamed garments rather than merging them', () => {
    const before = snapshot({ garments: [garment({ name: '' })] });
    const after = snapshot({ garments: [garment({ name: '' }), garment({ name: '' })] });

    expect(diffAgainstConfirmation(before, after).changes).toContainEqual(
      expect.objectContaining({ key: 'garment:Garment 2:added' }),
    );
  });
});

describe('diffAgainstConfirmation — minor changes', () => {
  // Staff move a ship date routinely. Re-asking the customer to sign for it
  // would train them to click through without reading.
  it('reports a moved ship date without calling it material', () => {
    const result = diffAgainstConfirmation(snapshot(), snapshot({ expectedShipDate: '2026-09-08' }));

    expect(result.hasMaterialChanges).toBe(false);
    expect(result.changes).toContainEqual({
      key: 'expectedShipDate',
      severity: 'minor',
      label: 'Expected ship date: 2026-09-01 → 2026-09-08',
    });
  });

  it('reports changed general notes as minor', () => {
    const result = diffAgainstConfirmation(snapshot(), snapshot({ generalNotes: 'Rush job' }));

    expect(result.hasMaterialChanges).toBe(false);
    expect(result.changes).toContainEqual({
      key: 'generalNotes',
      severity: 'minor',
      label: 'General notes: not set → Rush job',
    });
  });

  it('reports changed size charts as minor', () => {
    const result = diffAgainstConfirmation(
      snapshot(),
      snapshot({ garments: [garment({ sizeChartNames: ['Youth Jersey'] })] }),
    );

    expect(result.hasMaterialChanges).toBe(false);
    expect(result.changes.map((c) => c.key)).toContain('garment:Home Jersey:sizeCharts');
  });

  it('carries both severities at once when both kinds changed', () => {
    const result = diffAgainstConfirmation(
      snapshot(),
      snapshot({ orderValueAmount: '1450.00', deadlineDate: '2026-10-01' }),
    );

    expect(result.hasMaterialChanges).toBe(true);
    expect(result.changes.map((c) => c.severity).sort()).toEqual(['material', 'minor']);
  });
});
