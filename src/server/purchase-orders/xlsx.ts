/**
 * Purchase-order .xlsx export — the spreadsheet twin of PoPdf.
 *
 * Renders ONLY from an immutable PoSnapshot (never live order rows), so a
 * regenerated workbook for a given revision always matches what the supplier
 * was sent — same guarantee as the PDF.
 *
 * Shape is chosen for how a factory actually uses a spreadsheet rather than as
 * a visual replica of the PDF:
 *  - "Purchase Order" — the header/meta block plus a flat Garment/Size/Qty
 *    table that pivots and sums directly.
 *  - "Lines" — one row per sizing line with the garment columns denormalized,
 *    frozen header and autofilter, so it can be sorted/filtered/counted.
 *
 * All customer-supplied text goes through `neutralizeFormula` — spreadsheet
 * formula injection applies to real workbooks exactly as it does to CSV.
 */
import ExcelJS from 'exceljs';
import type { PoSnapshot } from '@/db/schema';
import { neutralizeFormula } from '@/lib/csv';
import { effectiveFabrics } from '@/lib/fabric-fields';
import { sizeSummary, NO_SIZE_LABEL } from './snapshot';

const ACCENT = 'FF4F46E5'; // fleet indigo (ARGB)
const HEADER_FILL = 'FF191919';

export interface PoXlsxProps {
  poNumber: string;
  revisionNumber: number;
  revisionReason?: string | null;
  createdAt: string;
  // No deadlineDate: the PO deadline is the CUSTOMER deadline (2026-08-05)
  // and this workbook goes to the factory — it must never carry it.
  expectedShipDate: string | null;
  notes: string | null;
  supplier: {
    name: string;
    contactPerson: string | null;
    email: string | null;
    phone: string | null;
  };
  snapshot: PoSnapshot;
}

/**
 * "Label: value; Label2: value2" — flattens an options map for one cell,
 * keeping EVERY key (David, 2026-08-05: all garment options must always be
 * displayed, relevant or blank — a blank value renders as a dash).
 */
function flattenMap(map: Record<string, string> | null): string {
  if (!map) return '';
  return Object.entries(map)
    .map(([label, value]) => `${label}: ${value?.trim() ? value : '—'}`)
    .join('; ');
}

/**
 * The fabrics cell: labeled picks when the garment is typed ("Outer Fabric:
 * Poly 300"), else the legacy free-text list — labels preserved, unlike
 * effectiveFabrics which flattens to bare values.
 */
function fabricSummary(garment: {
  fabrics: string[];
  selectedFabrics: Record<string, string> | null;
}): string {
  const labeled = Object.entries(garment.selectedFabrics ?? {})
    .filter(([, v]) => v)
    .map(([label, value]) => `${label}: ${value}`);
  if (labeled.length > 0) return labeled.join('; ');
  return effectiveFabrics(garment).join(', ');
}

function labelCell(sheet: ExcelJS.Worksheet, row: number, label: string, value: string) {
  const labelCellRef = sheet.getCell(`A${row}`);
  labelCellRef.value = label;
  labelCellRef.font = { bold: true, color: { argb: 'FF555555' }, size: 10 };
  sheet.getCell(`B${row}`).value = value;
}

function sectionTitle(sheet: ExcelJS.Worksheet, row: number, title: string) {
  const cell = sheet.getCell(`A${row}`);
  cell.value = title.toUpperCase();
  cell.font = { bold: true, size: 10, color: { argb: ACCENT } };
}

function styleTableHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle' };
  });
}

function buildSummarySheet(wb: ExcelJS.Workbook, props: PoXlsxProps): void {
  const sheet = wb.addWorksheet('Purchase Order', {
    properties: { defaultColWidth: 18 },
  });
  sheet.getColumn('A').width = 22;
  sheet.getColumn('B').width = 46;
  sheet.getColumn('C').width = 14;

  const amended = props.revisionNumber > 1;

  const title = sheet.getCell('A1');
  title.value = amended
    ? `PURCHASE ORDER — REVISION ${props.revisionNumber} (AMENDED)`
    : 'PURCHASE ORDER';
  title.font = { bold: true, size: 14, color: { argb: ACCENT } };

  let row = 3;
  labelCell(sheet, row++, 'PO number', props.poNumber);
  labelCell(sheet, row++, 'Revision', amended ? String(props.revisionNumber) : '1 (original)');
  if (amended && props.revisionReason) {
    labelCell(sheet, row++, 'Reason for amendment', neutralizeFormula(props.revisionReason));
  }
  labelCell(sheet, row++, 'Our order', props.snapshot.orderNumber);
  if (props.snapshot.reprintOfOrderNumber) {
    labelCell(sheet, row++, 'Reprint of', props.snapshot.reprintOfOrderNumber);
  }
  labelCell(sheet, row++, 'PO issued', props.createdAt.slice(0, 10));
  if (props.expectedShipDate) labelCell(sheet, row++, 'Required ship date', props.expectedShipDate);

  row++;
  sectionTitle(sheet, row++, 'Supplier');
  labelCell(sheet, row++, 'Name', neutralizeFormula(props.supplier.name));
  if (props.supplier.contactPerson) {
    labelCell(sheet, row++, 'Contact', neutralizeFormula(props.supplier.contactPerson));
  }
  if (props.supplier.email) labelCell(sheet, row++, 'Email', neutralizeFormula(props.supplier.email));
  if (props.supplier.phone) labelCell(sheet, row++, 'Phone', neutralizeFormula(props.supplier.phone));

  if (props.notes) {
    row++;
    sectionTitle(sheet, row++, 'Notes to supplier');
    const notesCell = sheet.getCell(`A${row}`);
    notesCell.value = neutralizeFormula(props.notes);
    notesCell.alignment = { wrapText: true, vertical: 'top' };
    sheet.mergeCells(`A${row}:C${row}`);
    row++;
  }

  const assets = props.snapshot.assets ?? [];
  if (assets.length > 0) {
    row++;
    sectionTitle(sheet, row++, 'Design & font files');
    const assetHeader = sheet.getRow(row++);
    assetHeader.values = ['Type', 'Name', 'Used for', 'Link'];
    styleTableHeader(assetHeader);
    for (const asset of assets) {
      const label = asset.garmentName
        ? `${asset.name} (${asset.garmentName})`
        : asset.name;
      const assetRow = sheet.getRow(row++);
      assetRow.values = [
        asset.kind,
        neutralizeFormula(label),
        neutralizeFormula(asset.usage ?? ''),
        // Left as text, not a hyperlink object: Excel's HYPERLINK handling is
        // one more thing to sanitise, and a plain URL is copy-pasteable.
        // An uploaded file has no durable URL — it rides the send email.
        neutralizeFormula(asset.url ?? (asset.storageKey ? '(attachment)' : '')),
      ];
    }
  }

  // Per-garment specs (David, 2026-08-05: fabrics, options, size charts and
  // images must all reach the factory in the spreadsheet too). Fabrics and
  // Options rows always render — a blank shows as a dash, never disappears.
  // Images are listed by caption/filename only, never embedded.
  row++;
  sectionTitle(sheet, row++, 'Garment details');
  for (const garment of props.snapshot.garments) {
    const titleCell = sheet.getCell(`A${row++}`);
    titleCell.value = neutralizeFormula(
      garment.garmentTypeName ? `${garment.name} — ${garment.garmentTypeName}` : garment.name,
    );
    titleCell.font = { bold: true, size: 10 };

    labelCell(sheet, row++, 'Fabrics', neutralizeFormula(fabricSummary(garment)) || '—');
    labelCell(sheet, row++, 'Options', neutralizeFormula(flattenMap(garment.selectedOptions)) || '—');
    const charts = garment.sizeCharts ?? [];
    if (charts.length > 0) {
      labelCell(sheet, row++, 'Size charts', neutralizeFormula(charts.map((c) => c.name).join(', ')));
    }
    const images = garment.images ?? [];
    if (images.length > 0) {
      labelCell(
        sheet,
        row++,
        'Images',
        neutralizeFormula(
          images
            .map((img) => img.caption?.trim() || img.storageKey.split('/').pop() || 'image')
            .join(', '),
        ),
      );
    }
    if (garment.notes) labelCell(sheet, row++, 'Notes', neutralizeFormula(garment.notes));
    row++; // spacer between garments
  }

  // Flat Garment/Size/Quantity table — pivots and sums directly in Excel.
  sectionTitle(sheet, row++, 'Size summary');
  const headerRow = sheet.getRow(row++);
  headerRow.values = ['Garment', 'Size', 'Quantity'];
  styleTableHeader(headerRow);

  const summary = sizeSummary(props.snapshot);
  for (const garment of summary.perGarment) {
    const sizes = Object.keys(garment.counts);
    if (sizes.length === 0) {
      sheet.getRow(row++).values = [neutralizeFormula(garment.name), '(no lines)', 0];
      continue;
    }
    for (const size of sizes) {
      sheet.getRow(row++).values = [
        neutralizeFormula(garment.name),
        size,
        garment.counts[size],
      ];
    }
  }

  const totalRow = sheet.getRow(row);
  totalRow.values = ['Total pieces', '', summary.grandTotal];
  totalRow.font = { bold: true };
}

function buildLinesSheet(wb: ExcelJS.Workbook, props: PoXlsxProps): void {
  const sheet = wb.addWorksheet('Lines');

  // Custom columns vary per garment, so the flat sheet carries the union of
  // them (first-seen order); a garment without a given column leaves it blank.
  const customLabels: string[] = [];
  for (const garment of props.snapshot.garments) {
    for (const column of garment.sizingColumns ?? []) {
      if (!customLabels.includes(column.label)) customLabels.push(column.label);
    }
  }

  sheet.columns = [
    { header: 'Garment', key: 'garment', width: 26 },
    { header: 'Garment Type', key: 'type', width: 18 },
    { header: 'Fabrics', key: 'fabrics', width: 28 },
    { header: 'Options', key: 'options', width: 30 },
    { header: 'Size', key: 'size', width: 12 },
    { header: 'Player Name', key: 'playerName', width: 22 },
    { header: 'Number', key: 'playerNumber', width: 10 },
    { header: 'Qty', key: 'quantity', width: 8 },
    ...customLabels.map((label) => ({ header: label, key: `custom:${label}`, width: 18 })),
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  styleTableHeader(sheet.getRow(1));

  for (const garment of props.snapshot.garments) {
    const fabrics = fabricSummary(garment);
    const options = flattenMap(garment.selectedOptions);

    for (const line of garment.lines) {
      const custom: Record<string, string> = {};
      for (const label of customLabels) {
        custom[`custom:${label}`] = neutralizeFormula(line.customValues?.[label]);
      }
      sheet.addRow({
        garment: neutralizeFormula(garment.name),
        type: neutralizeFormula(garment.garmentTypeName),
        fabrics: neutralizeFormula(fabrics),
        options: neutralizeFormula(options),
        // '(no size)' matches the PDF/summary wording for sizeless rows.
        size: line.size?.trim() ? neutralizeFormula(line.size) : NO_SIZE_LABEL,
        playerName: neutralizeFormula(line.playerName),
        playerNumber: neutralizeFormula(line.playerNumber),
        // A real number so Excel can SUM it; pre-quantity lines are one each.
        quantity: line.quantity ?? 1,
        ...custom,
        notes: neutralizeFormula(line.notes),
      });
    }
  }

  // Frozen header + autofilter so the factory can sort/filter immediately.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (sheet.rowCount > 1) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
  }
}

/** Build the .xlsx for one PO revision. */
export async function buildPoWorkbook(props: PoXlsxProps): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BeastMode Orders';
  // No created/modified timestamps: keeps a regenerated workbook for the same
  // revision byte-identical, matching the PDF's reproducibility guarantee.

  buildSummarySheet(wb, props);
  buildLinesSheet(wb, props);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** `PO-….xlsx`, or `PO-…-revN.xlsx` for an amendment — mirrors the PDF route. */
export function poXlsxFilename(poNumber: string, revisionNumber: number): string {
  return revisionNumber > 1 ? `${poNumber}-rev${revisionNumber}.xlsx` : `${poNumber}.xlsx`;
}
