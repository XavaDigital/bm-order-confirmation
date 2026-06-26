import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer';

const RED = '#BF272D';
const NAVY = '#0d1117';
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
    borderBottomColor: RED,
    paddingBottom: 10,
    marginBottom: 16,
  },
  brand: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
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
    color: RED,
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
    color: RED,
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
    backgroundColor: NAVY,
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

interface SizingRow {
  size?: string | null;
  playerName?: string | null;
  playerNumber?: string | null;
  notes?: string | null;
}

interface GarmentData {
  name: string;
  fabrics: string[];
  notes: string | null;
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
    <Document title={`Order ${orderNumber} — BeastMode`}>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>BEASTMODE</Text>
            <Text style={s.brandSub}>Order Confirmation</Text>
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
          <View style={s.row}><Text style={s.label}>Name</Text><Text style={s.value}>{customerName}</Text></View>
          <View style={s.row}><Text style={s.label}>Email</Text><Text style={s.value}>{customerEmail}</Text></View>
          {customerContact && (
            <View style={s.row}><Text style={s.label}>Contact</Text><Text style={s.value}>{customerContact}</Text></View>
          )}
          {clubName && (
            <View style={s.row}><Text style={s.label}>Club / Team</Text><Text style={s.value}>{clubName}</Text></View>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Order Details</Text>
          {orderValueAmount && (
            <View style={s.row}>
              <Text style={s.label}>Order Value</Text>
              <Text style={s.value}>
                {orderValueCurrency ?? 'NZD'} {Number(orderValueAmount).toFixed(2)}
              </Text>
            </View>
          )}
          {expectedShipDate && (
            <View style={s.row}><Text style={s.label}>Expected Ship</Text><Text style={s.value}>{expectedShipDate}</Text></View>
          )}
          {deadlineDate && (
            <View style={s.row}><Text style={s.label}>Deadline</Text><Text style={s.value}>{deadlineDate}</Text></View>
          )}
          {confirmedAt && (
            <View style={s.row}>
              <Text style={s.label}>Confirmed</Text>
              <Text style={s.value}>
                {new Date(confirmedAt).toLocaleString('en-NZ', {
                  day: 'numeric', month: 'long', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          )}
          {generalNotes && (
            <View style={s.row}><Text style={s.label}>Notes</Text><Text style={s.value}>{generalNotes}</Text></View>
          )}
        </View>

        {/* Garments */}
        {garments.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Garments ({garments.length})</Text>
            {garments.map((g, idx) => (
              <View key={idx} style={s.garmentCard}>
                <Text style={s.garmentHeader}>{g.name}</Text>
                <View style={s.garmentBody}>
                  {g.fabrics.length > 0 && (
                    <View style={s.row}>
                      <Text style={s.label}>Fabrics</Text>
                      <Text style={s.value}>{g.fabrics.join(', ')}</Text>
                    </View>
                  )}
                  {g.notes && (
                    <View style={s.row}>
                      <Text style={s.label}>Notes</Text>
                      <Text style={s.value}>{g.notes}</Text>
                    </View>
                  )}
                  {g.sizing.length > 0 && (
                    <View style={s.table}>
                      <View style={s.tableHeader}>
                        <Text style={s.col}>Size</Text>
                        <Text style={s.col}>Player Name</Text>
                        <Text style={s.col}>Number</Text>
                        <Text style={s.col}>Notes</Text>
                      </View>
                      {g.sizing.map((row, ri) => (
                        <View key={ri} style={ri % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                          <Text style={s.col}>{row.size ?? '—'}</Text>
                          <Text style={s.col}>{row.playerName ?? '—'}</Text>
                          <Text style={s.col}>{row.playerNumber ?? '—'}</Text>
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
          <Text>BeastMode — beastmode.co.nz</Text>
          <Text>Printed {printDate}</Text>
        </View>
      </Page>
    </Document>
  );
}
