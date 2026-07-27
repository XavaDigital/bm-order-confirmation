/**
 * Purchase-order PDF — the document a supplier receives. Renders ONLY from an
 * immutable PoSnapshot (never live order rows), so a regenerated PDF for a
 * given revision is always identical to what was originally sent.
 * Mirrors OrderPdf's fleet look (indigo accent, Helvetica, A4).
 */
import type { ReactNode } from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { APP_NAME, PDF_FOOTER_TEXT } from '@/lib/config';
import type { PoSnapshot, PoSnapshotGarment } from '@/db/schema';

const ACCENT = '#4f46e5'; // fleet indigo
const INK = '#191919';
const WHITE = '#ffffff';
const LIGHT_GREY = '#f5f5f5';
const MID_GREY = '#e0e0e0';
const TEXT_DARK = '#1a1a1a';
const TEXT_MID = '#555555';
const AMBER_BG = '#fff7e6';
const AMBER = '#d46b08';

const s = StyleSheet.create({
  page: {
    backgroundColor: WHITE,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: TEXT_DARK,
    padding: 36,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 3,
    borderBottomColor: ACCENT,
    paddingBottom: 10,
    marginBottom: 16,
  },
  brand: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  brandSub: {
    fontSize: 8,
    color: TEXT_MID,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  poNumber: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: ACCENT,
  },
  revisionBadge: {
    marginTop: 4,
    backgroundColor: AMBER_BG,
    color: AMBER,
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    padding: '3 6',
    borderRadius: 3,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 1,
    borderBottomWidth: 1,
    borderBottomColor: MID_GREY,
    paddingBottom: 3,
    marginBottom: 6,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 16,
  },
  colHalf: { flex: 1 },
  row: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  label: {
    width: 110,
    color: TEXT_MID,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  value: {
    flex: 1,
    color: TEXT_DARK,
  },
  garmentCard: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: MID_GREY,
    borderRadius: 4,
  },
  garmentHeader: {
    backgroundColor: INK,
    color: WHITE,
    padding: '6 8',
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
  },
  garmentBody: {
    padding: '6 8',
    backgroundColor: LIGHT_GREY,
  },
  table: {
    marginTop: 6,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: MID_GREY,
    padding: '3 4',
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  tableRow: {
    flexDirection: 'row',
    padding: '2 4',
    borderBottomWidth: 1,
    borderBottomColor: MID_GREY,
  },
  tableRowAlt: {
    flexDirection: 'row',
    padding: '2 4',
    borderBottomWidth: 1,
    borderBottomColor: MID_GREY,
    backgroundColor: WHITE,
  },
  col: { flex: 1 },
  sizeSummary: {
    marginTop: 4,
    fontSize: 8,
    color: TEXT_MID,
    fontFamily: 'Helvetica-Bold',
  },
  grandTotal: {
    marginTop: 4,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    textAlign: 'right',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: TEXT_MID,
    fontSize: 7,
    borderTopWidth: 1,
    borderTopColor: MID_GREY,
    paddingTop: 4,
  },
});

function LabelValueRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

/** "S ×4 · M ×7 · (no size) ×1" strip under a garment's line table. */
function summarizeSizes(garment: PoSnapshotGarment): { text: string; total: number } {
  const counts = new Map<string, number>();
  for (const line of garment.lines) {
    const key = line.size?.trim() || '(no size)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const text = [...counts.entries()].map(([size, n]) => `${size} ×${n}`).join(' · ');
  return { text, total: garment.lines.length };
}

export interface PoPdfProps {
  poNumber: string;
  revisionNumber: number;
  /** Reason for the amendment — shown for revision > 1 when present. */
  revisionReason?: string | null;
  createdAt: string;
  deadlineDate: string | null;
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

export function PoPdf({
  poNumber,
  revisionNumber,
  revisionReason,
  createdAt,
  deadlineDate,
  expectedShipDate,
  notes,
  supplier,
  snapshot,
}: PoPdfProps) {
  const printDate = new Date().toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const amended = revisionNumber > 1;
  const grandTotal = snapshot.garments.reduce((sum, g) => sum + g.lines.length, 0);

  return (
    <Document title={`Purchase Order ${poNumber} — ${APP_NAME}`}>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>{APP_NAME.toUpperCase()}</Text>
            <Text style={s.brandSub}>Purchase Order</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.poNumber}>{poNumber}</Text>
            {amended && (
              <Text style={s.revisionBadge}>REVISION {revisionNumber} — AMENDED</Text>
            )}
          </View>
        </View>

        {/* Supplier + order reference, side by side */}
        <View style={[s.section, s.twoCol]}>
          <View style={s.colHalf}>
            <Text style={s.sectionTitle}>Supplier</Text>
            <LabelValueRow label="Name" value={supplier.name} />
            {supplier.contactPerson && (
              <LabelValueRow label="Contact" value={supplier.contactPerson} />
            )}
            {supplier.email && <LabelValueRow label="Email" value={supplier.email} />}
            {supplier.phone && <LabelValueRow label="Phone" value={supplier.phone} />}
          </View>
          <View style={s.colHalf}>
            <Text style={s.sectionTitle}>Reference</Text>
            <LabelValueRow label="Our order" value={snapshot.orderNumber} />
            {snapshot.reprintOfOrderNumber && (
              <LabelValueRow label="Reprint of" value={snapshot.reprintOfOrderNumber} />
            )}
            <LabelValueRow
              label="PO issued"
              value={new Date(createdAt).toLocaleDateString('en-NZ', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            />
            {deadlineDate && <LabelValueRow label="Deadline" value={deadlineDate} />}
            {expectedShipDate && (
              <LabelValueRow label="Expected ship" value={expectedShipDate} />
            )}
          </View>
        </View>

        {amended && revisionReason && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Reason for amendment</Text>
            <Text>{revisionReason}</Text>
          </View>
        )}

        {/* Garments */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Garments ({snapshot.garments.length})</Text>
          {snapshot.garments.map((g) => {
            const summary = summarizeSizes(g);
            return (
              <View key={g.garmentId} style={s.garmentCard} wrap={false}>
                <Text style={s.garmentHeader}>
                  {g.name}
                  {g.garmentTypeName ? `  ·  ${g.garmentTypeName}` : ''}
                </Text>
                <View style={s.garmentBody}>
                  {g.selectedFabrics &&
                    Object.entries(g.selectedFabrics)
                      .filter(([, v]) => v)
                      .map(([label, valueText]) => (
                        <LabelValueRow key={`fabric-${label}`} label={label} value={valueText} />
                      ))}
                  {g.fabrics.length > 0 && (
                    <LabelValueRow label="Fabrics" value={g.fabrics.join(', ')} />
                  )}
                  {g.selectedOptions &&
                    Object.entries(g.selectedOptions)
                      .filter(([, v]) => v)
                      .map(([label, valueText]) => (
                        <LabelValueRow key={label} label={label} value={valueText} />
                      ))}
                  {g.notes && <LabelValueRow label="Notes" value={g.notes} />}
                  {g.lines.length > 0 && (
                    <View style={s.table}>
                      <View style={s.tableHeader}>
                        <Text style={s.col}>Size</Text>
                        <Text style={s.col}>Player Name</Text>
                        <Text style={s.col}>Number</Text>
                        {/* Custom columns as captured in THIS revision. */}
                        {(g.sizingColumns ?? []).map((c) => (
                          <Text key={c.label} style={s.col}>
                            {c.label}
                          </Text>
                        ))}
                        <Text style={s.col}>Notes</Text>
                      </View>
                      {g.lines.map((row, ri) => (
                        <View
                          key={row.sizingRowId}
                          style={ri % 2 === 0 ? s.tableRow : s.tableRowAlt}
                        >
                          <Text style={s.col}>{row.size ?? '—'}</Text>
                          <Text style={s.col}>{row.playerName ?? '—'}</Text>
                          <Text style={s.col}>{row.playerNumber ?? '—'}</Text>
                          {(g.sizingColumns ?? []).map((c) => (
                            <Text key={c.label} style={s.col}>
                              {row.customValues?.[c.label] ?? '—'}
                            </Text>
                          ))}
                          <Text style={s.col}>{row.notes ?? ''}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {summary.total > 0 && (
                    <Text style={s.sizeSummary}>
                      {summary.text}  —  {summary.total} piece{summary.total === 1 ? '' : 's'}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
          <Text style={s.grandTotal}>Total pieces: {grandTotal}</Text>
        </View>

        {(snapshot.assets ?? []).length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Design &amp; font files</Text>
            {(snapshot.assets ?? []).map((asset, i) => (
              <View key={`${asset.url}-${i}`} style={s.row}>
                <Text style={s.label}>
                  {asset.kind === 'font' ? 'Font' : asset.kind === 'design' ? 'Design' : 'File'}
                </Text>
                <Text style={s.value}>
                  {[
                    asset.garmentName ? `${asset.name} (${asset.garmentName})` : asset.name,
                    asset.url,
                    asset.notes,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                </Text>
              </View>
            ))}
          </View>
        )}

        {notes && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notes to supplier</Text>
            <Text>{notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text>{PDF_FOOTER_TEXT}</Text>
          <Text>
            {poNumber}
            {amended ? ` rev ${revisionNumber}` : ''} · Printed {printDate}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
