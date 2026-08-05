import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { PoSnapshot } from '@/db/schema';
import { buildPoWorkbook, poXlsxFilename, type PoXlsxProps } from './xlsx';

function snapshot(overrides: Partial<PoSnapshot> = {}): PoSnapshot {
  return {
    orderNumber: 'OC-ABCD1234',
    garments: [
      {
        garmentId: 'g-1',
        name: 'Home Jersey',
        garmentTypeId: 't-1',
        garmentTypeName: 'Pullover Hoodie',
        fabrics: ['Legacy Poly'],
        selectedFabrics: { 'Outer Fabric': 'Cotton Fleece', 'Hood Lining': 'Mesh' },
        selectedOptions: { 'Zip Type': 'pullover', 'Cord Color': 'Black' },
        notes: 'Tight collar',
        lines: [
          { sizingRowId: 'r-1', size: 'M', playerName: 'Alex', playerNumber: '7', notes: 'sleeve' },
          { sizingRowId: 'r-2', size: 'M', playerName: 'Sam', playerNumber: '9', notes: null },
          { sizingRowId: 'r-3', size: 'L', playerName: null, playerNumber: null, notes: null },
          { sizingRowId: 'r-4', size: null, playerName: 'Sizeless', playerNumber: null, notes: null },
        ],
      },
      {
        garmentId: 'g-2',
        name: 'Shorts',
        garmentTypeId: null,
        garmentTypeName: null,
        fabrics: ['Poly Mesh'],
        selectedFabrics: null,
        selectedOptions: null,
        notes: null,
        lines: [{ sizingRowId: 'r-5', size: 'S', playerName: null, playerNumber: null, notes: null }],
      },
    ],
    ...overrides,
  };
}

function props(overrides: Partial<PoXlsxProps> = {}): PoXlsxProps {
  return {
    poNumber: 'PO-2607-GS01-ACMEUNITED',
    revisionNumber: 1,
    revisionReason: null,
    createdAt: '2026-07-27T02:30:00.000Z',
    expectedShipDate: '2026-08-20',
    notes: 'Pack by player name.',
    supplier: {
      name: 'Golden Stitch',
      contactPerson: 'Mei Chen',
      email: 'mei@goldenstitch.example',
      phone: '+86 555 0100',
    },
    snapshot: snapshot(),
    ...overrides,
  };
}

async function load(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}

/** Flatten a sheet into `[[cellText, ...], ...]` for easy assertions. */
function rows(sheet: ExcelJS.Worksheet): string[][] {
  const out: string[][] = [];
  sheet.eachRow((row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      values.push(cell.value === null || cell.value === undefined ? '' : String(cell.value));
    });
    out.push(values);
  });
  return out;
}

function findRow(sheet: ExcelJS.Worksheet, label: string): string[] | undefined {
  return rows(sheet).find((r) => r[0] === label);
}

describe('buildPoWorkbook', () => {
  it('produces both sheets', async () => {
    const wb = await load(await buildPoWorkbook(props()));
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Purchase Order', 'Lines']);
  });

  it('writes the PO meta, supplier block and notes on the summary sheet', async () => {
    const wb = await load(await buildPoWorkbook(props()));
    const sheet = wb.getWorksheet('Purchase Order')!;

    expect(rows(sheet)[0][0]).toBe('PURCHASE ORDER');
    expect(findRow(sheet, 'PO number')?.[1]).toBe('PO-2607-GS01-ACMEUNITED');
    expect(findRow(sheet, 'Revision')?.[1]).toBe('1 (original)');
    expect(findRow(sheet, 'Our order')?.[1]).toBe('OC-ABCD1234');
    expect(findRow(sheet, 'PO issued')?.[1]).toBe('2026-07-27');
    // The PO deadline is the CUSTOMER deadline (2026-08-05) — this factory-
    // facing workbook must never carry a Deadline row at all.
    expect(findRow(sheet, 'Deadline')).toBeUndefined();
    expect(findRow(sheet, 'Required ship date')?.[1]).toBe('2026-08-20');
    expect(findRow(sheet, 'Name')?.[1]).toBe('Golden Stitch');
    expect(findRow(sheet, 'Contact')?.[1]).toBe('Mei Chen');
    expect(findRow(sheet, 'Email')?.[1]).toBe('mei@goldenstitch.example');
    expect(rows(sheet).some((r) => r[0] === 'Pack by player name.')).toBe(true);
  });

  it('writes a Colour book row when the PO carries one', async () => {
    const wb = await load(await buildPoWorkbook(props({ colorBookName: 'Pantone 2026' })));
    const sheet = wb.getWorksheet('Purchase Order')!;

    expect(findRow(sheet, 'Colour book')?.[1]).toBe('Pantone 2026');
  });

  it('omits the Colour book row when the PO has none', async () => {
    const wb = await load(await buildPoWorkbook(props()));
    const sheet = wb.getWorksheet('Purchase Order')!;

    expect(findRow(sheet, 'Colour book')).toBeUndefined();
  });

  it('neutralizes a formula-shaped colour book name', async () => {
    const wb = await load(await buildPoWorkbook(props({ colorBookName: '=HYPERLINK("x")' })));
    const sheet = wb.getWorksheet('Purchase Order')!;

    expect(findRow(sheet, 'Colour book')?.[1]).toBe(`'=HYPERLINK("x")`);
  });

  it('marks an amendment in the title and records the reason', async () => {
    const wb = await load(
      await buildPoWorkbook(props({ revisionNumber: 3, revisionReason: 'Two sizes changed' })),
    );
    const sheet = wb.getWorksheet('Purchase Order')!;

    expect(rows(sheet)[0][0]).toBe('PURCHASE ORDER — REVISION 3 (AMENDED)');
    expect(findRow(sheet, 'Revision')?.[1]).toBe('3');
    expect(findRow(sheet, 'Reason for amendment')?.[1]).toBe('Two sizes changed');
  });

  it('summarizes sizes per garment as a flat table with a grand total', async () => {
    const wb = await load(await buildPoWorkbook(props()));
    const sheet = wb.getWorksheet('Purchase Order')!;
    const all = rows(sheet);
    const headerIdx = all.findIndex((r) => r[0] === 'Garment' && r[1] === 'Size');
    expect(headerIdx).toBeGreaterThan(-1);

    const body = all.slice(headerIdx + 1).filter((r) => r[0] && r[0] !== 'Total pieces');
    expect(body).toEqual([
      ['Home Jersey', 'M', '2'],
      ['Home Jersey', 'L', '1'],
      ['Home Jersey', '(no size)', '1'],
      ['Shorts', 'S', '1'],
    ]);

    // 4 jersey lines + 1 shorts line
    expect(findRow(sheet, 'Total pieces')?.[2]).toBe('5');
  });

  it('writes a Garment details section with fabrics, options, size charts and images', async () => {
    const detailed = snapshot();
    detailed.garments[0].sizeCharts = [
      { id: 'c-1', name: 'Adult Hoodie Chart', storageKey: 'charts/adult.pdf' },
    ];
    detailed.garments[0].images = [
      {
        id: 'i-1',
        storageKey: 'images/orders/front-mockup.png',
        thumbnailStorageKey: null,
        caption: 'Front mock-up',
      },
      {
        id: 'i-2',
        storageKey: 'images/orders/back-view.png',
        thumbnailStorageKey: null,
        caption: null,
      },
    ];
    const wb = await load(await buildPoWorkbook(props({ snapshot: detailed })));
    const sheet = wb.getWorksheet('Purchase Order')!;
    const all = rows(sheet);

    expect(all.some((r) => r[0] === 'GARMENT DETAILS')).toBe(true);
    expect(all.some((r) => r[0] === 'Home Jersey — Pullover Hoodie')).toBe(true);
    expect(findRow(sheet, 'Fabrics')?.[1]).toBe('Outer Fabric: Cotton Fleece; Hood Lining: Mesh');
    expect(findRow(sheet, 'Options')?.[1]).toBe('Zip Type: pullover; Cord Color: Black');
    expect(findRow(sheet, 'Size charts')?.[1]).toBe('Adult Hoodie Chart');
    // Captions where present, else the storage filename — never embedded.
    expect(findRow(sheet, 'Images')?.[1]).toBe('Front mock-up, back-view.png');

    // The typeless garment still gets its rows — a blank options map shows a
    // dash rather than the row disappearing (options must always display).
    const shortsIdx = all.findIndex((r) => r[0] === 'Shorts');
    expect(shortsIdx).toBeGreaterThan(-1);
    const shortsOptions = all
      .slice(shortsIdx)
      .find((r) => r[0] === 'Options');
    expect(shortsOptions?.[1]).toBe('—');
  });

  it('keeps blank option values visible as dashes in the Lines options cell', async () => {
    const blanks = snapshot();
    blanks.garments[0].selectedOptions = { 'Zip Type': 'pullover', 'Cord Color': '' };
    const wb = await load(await buildPoWorkbook(props({ snapshot: blanks })));
    const sheet = wb.getWorksheet('Lines')!;
    expect(rows(sheet)[1][3]).toBe('Zip Type: pullover; Cord Color: —');
  });

  it('writes one Lines row per sizing line with garment columns denormalized', async () => {
    const wb = await load(await buildPoWorkbook(props()));
    const sheet = wb.getWorksheet('Lines')!;
    const all = rows(sheet);

    expect(all[0]).toEqual([
      'Garment',
      'Garment Type',
      'Fabrics',
      'Options',
      'Size',
      'Player Name',
      'Number',
      'Qty',
      'Notes',
    ]);
    expect(all).toHaveLength(6); // header + 5 lines

    expect(all[1]).toEqual([
      'Home Jersey',
      'Pullover Hoodie',
      // labeled picks win over the legacy flat list, labels preserved
      'Outer Fabric: Cotton Fleece; Hood Lining: Mesh',
      'Zip Type: pullover; Cord Color: Black',
      'M',
      'Alex',
      '7',
      // The rows() helper stringifies; numeric-ness is asserted on the cell below.
      '1',
      'sleeve',
    ]);

    // Qty must be a real number cell, not text — the factory SUMs this column,
    // and Excel's SUM silently skips text cells, understating the run.
    const qtyCell = sheet.getRow(2).getCell(8);
    expect(typeof qtyCell.value).toBe('number');

    // Sizeless line gets the same '(no size)' wording as the PDF/summary.
    expect(all[4][4]).toBe('(no size)');

    // Typeless garment falls back to its free-text fabrics list.
    expect(all[5][1]).toBe('');
    expect(all[5][2]).toBe('Poly Mesh');
  });

  it('freezes the Lines header and adds an autofilter', async () => {
    const wb = await load(await buildPoWorkbook(props()));
    const sheet = wb.getWorksheet('Lines')!;
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it('neutralizes spreadsheet formulas in untrusted text', async () => {
    const evil = snapshot();
    evil.garments[0].lines[0] = {
      sizingRowId: 'r-1',
      size: '=1+1',
      playerName: '=cmd|" /c calc"!A0',
      playerNumber: '+7',
      notes: '@SUM(A1:A9)',
    };
    const wb = await load(await buildPoWorkbook(props({ snapshot: evil })));
    const sheet = wb.getWorksheet('Lines')!;
    const row = rows(sheet)[1];

    // Leading quote makes Excel treat these as literal text, not formulas.
    // row[7] is the numeric Qty column, which cannot carry a formula string —
    // the untrusted text fields around it are what must be neutralised.
    for (const value of [row[4], row[5], row[6], row[8]]) {
      expect(value.startsWith("'")).toBe(true);
    }
    // And nothing became a live formula cell.
    sheet.eachRow((r) =>
      r.eachCell((cell) => expect(cell.type).not.toBe(ExcelJS.ValueType.Formula)),
    );
  });

  it('omits optional meta rows when the PO has none', async () => {
    const wb = await load(
      await buildPoWorkbook(props({ expectedShipDate: null, notes: null })),
    );
    const sheet = wb.getWorksheet('Purchase Order')!;
    expect(findRow(sheet, 'Required ship date')).toBeUndefined();
    expect(rows(sheet).some((r) => r[0] === 'NOTES TO SUPPLIER')).toBe(false);
  });

  it('handles a garment with no lines without breaking the summary', async () => {
    const empty = snapshot();
    empty.garments[1].lines = [];
    const wb = await load(await buildPoWorkbook(props({ snapshot: empty })));
    const sheet = wb.getWorksheet('Purchase Order')!;
    // 'Shorts' also appears as a Garment-details title row, so match the
    // size-summary row specifically.
    expect(rows(sheet).some((r) => r[0] === 'Shorts' && r[1] === '(no lines)')).toBe(true);
    expect(findRow(sheet, 'Total pieces')?.[2]).toBe('4');
  });
});

describe('poXlsxFilename', () => {
  it('uses the bare PO number for revision 1 and a rev suffix beyond that', () => {
    expect(poXlsxFilename('PO-1', 1)).toBe('PO-1.xlsx');
    expect(poXlsxFilename('PO-1', 4)).toBe('PO-1-rev4.xlsx');
  });
});
