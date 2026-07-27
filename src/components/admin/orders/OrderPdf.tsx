import type { ReactNode } from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer';
import { APP_NAME, APP_TAGLINE, PDF_FOOTER_TEXT } from '@/lib/config';

const ACCENT = '#4f46e5'; // fleet indigo
const INK = '#191919';
const WHITE = '#ffffff';
const LIGHT_GREY = '#f5f5f5';
const MID_GREY = '#e0e0e0';
const TEXT_DARK = '#1a1a1a';
const TEXT_MID = '#555555';

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
  orderNumber: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: ACCENT,
  },
  confirmedBadge: {
    marginTop: 4,
    backgroundColor: '#d4edda',
    color: '#155724',
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
  row: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  label: {
    width: 120,
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

/**
 * "Muted label + value" row — the PDF twin of the label/value convention on
 * the customer pages (customerStyles.ts FIELD_LABEL_STYLE). react-pdf only.
 */
function LabelValueRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

interface SizingRow {
  size?: string | null;
  playerName?: string | null;
  playerNumber?: string | null;
  notes?: string | null;
  customValues?: Record<string, string> | null;
}

interface GarmentData {
  name: string;
  fabrics: string[];
  notes: string | null;
  selectedOptions?: Record<string, string> | null;
  selectedFabrics?: Record<string, string> | null;
  sizingColumns?: { label: string }[];
  sizing: SizingRow[];
}

export interface OrderPdfProps {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerContact: string | null;
  clubName: string | null;
  orderValueAmount: string | null;
  orderValueCurrency: string | null;
  expectedShipDate: string | null;
  deadlineDate: string | null;
  generalNotes: string | null;
  confirmedAt: string | null;
  garments: GarmentData[];
}

export function OrderPdf({
  orderNumber,
  customerName,
  customerEmail,
  customerContact,
  clubName,
  orderValueAmount,
  orderValueCurrency,
  expectedShipDate,
  deadlineDate,
  generalNotes,
  confirmedAt,
  garments,
}: OrderPdfProps) {
  const printDate = new Date().toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <Document title={`Order ${orderNumber} — ${APP_NAME}`}>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>{APP_NAME.toUpperCase()}</Text>
            <Text style={s.brandSub}>{APP_TAGLINE}</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.orderNumber}>{orderNumber}</Text>
            {confirmedAt && (
              <Text style={s.confirmedBadge}>CONFIRMED</Text>
            )}
          </View>
        </View>

        {/* Order details */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Customer Details</Text>
          <LabelValueRow label="Name" value={customerName} />
          <LabelValueRow label="Email" value={customerEmail} />
          {customerContact && <LabelValueRow label="Contact" value={customerContact} />}
          {clubName && <LabelValueRow label="Club / Team" value={clubName} />}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Order Details</Text>
          {orderValueAmount && (
            <LabelValueRow
              label="Order Value"
              value={`${orderValueCurrency ?? 'NZD'} ${Number(orderValueAmount).toFixed(2)}`}
            />
          )}
          {expectedShipDate && <LabelValueRow label="Expected Ship" value={expectedShipDate} />}
          {deadlineDate && <LabelValueRow label="Deadline" value={deadlineDate} />}
          {confirmedAt && (
            <LabelValueRow
              label="Confirmed"
              value={new Date(confirmedAt).toLocaleString('en-NZ', {
                day: 'numeric', month: 'long', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            />
          )}
          {generalNotes && <LabelValueRow label="Notes" value={generalNotes} />}
        </View>

        {/* Garments */}
        {garments.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Garments ({garments.length})</Text>
            {garments.map((g, idx) => (
              <View key={idx} style={s.garmentCard}>
                <Text style={s.garmentHeader}>{g.name}</Text>
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
                  {g.sizing.length > 0 && (
                    <View style={s.table}>
                      <View style={s.tableHeader}>
                        <Text style={s.col}>Size</Text>
                        <Text style={s.col}>Player Name</Text>
                        <Text style={s.col}>Number</Text>
                        {(g.sizingColumns ?? []).map((c) => (
                          <Text key={c.label} style={s.col}>
                            {c.label}
                          </Text>
                        ))}
                        <Text style={s.col}>Notes</Text>
                      </View>
                      {g.sizing.map((row, ri) => (
                        <View key={ri} style={ri % 2 === 0 ? s.tableRow : s.tableRowAlt}>
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
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text>{PDF_FOOTER_TEXT}</Text>
          <Text>Printed {printDate}</Text>
        </View>
      </Page>
    </Document>
  );
}
