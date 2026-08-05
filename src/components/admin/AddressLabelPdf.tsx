/**
 * Printed address label (David, 2026-08-05) — replaces the Word document.
 *
 * One label per page at the physical stock size (ADDRESS_LABEL_MM, ~174×100mm)
 * so the printer driver needs no scaling: print at 100% on the label media.
 *
 * PORTABLE BY DESIGN: this component depends only on react-pdf and two config
 * constants (RETURN_ADDRESS, ADDRESS_LABEL_MM). The fleet spec —
 * FLEET_COORDINATION/2026-08-05-address-label-spec.md — describes the layout
 * so any sibling app (the CRM especially) can reimplement it verbatim; keep
 * this file and that spec in step.
 *
 * The brand is the styled wordmark (same treatment as PoPdf) rather than an
 * image: the repo's only raster logo is favicon-sized and would print blurry.
 * Swapping in a print-resolution logo later is a one-line <Image> change here
 * and a note in the spec.
 */
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { ADDRESS_LABEL_MM, APP_NAME, RETURN_ADDRESS } from '@/lib/config';

const MM_TO_PT = 72 / 25.4;
const PAGE_W = ADDRESS_LABEL_MM.width * MM_TO_PT;
const PAGE_H = ADDRESS_LABEL_MM.height * MM_TO_PT;

const INK = '#191919';
const ACCENT = '#4f46e5';
const MUTED = '#555555';

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    color: INK,
    padding: 5 * MM_TO_PT,
    flexDirection: 'column',
  },
  // Sender strip across the top: wordmark left, return address right.
  senderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1.5,
    borderBottomColor: ACCENT,
    paddingBottom: 3 * MM_TO_PT,
  },
  brand: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  brandSub: {
    fontSize: 6,
    color: MUTED,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  sender: {
    textAlign: 'right',
    fontSize: 6.5,
    color: MUTED,
    lineHeight: 1.35,
  },
  // The destination block dominates the label — that is its whole job.
  toBlock: {
    flex: 1,
    justifyContent: 'center',
    paddingLeft: 8 * MM_TO_PT,
  },
  toTag: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: ACCENT,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 2 * MM_TO_PT,
  },
  toName: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 1.5 * MM_TO_PT,
  },
  toLine: {
    fontSize: 12,
    lineHeight: 1.4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 6.5,
    color: MUTED,
  },
});

export interface AddressLabelProps {
  /** Recipient display name — person, or club with the person underneath. */
  toName: string;
  /** Pre-split address lines, blanks already removed. */
  toLines: string[];
  /** Optional reference printed bottom-right (order number). */
  reference?: string | null;
}

export function AddressLabelPdf({ toName, toLines, reference }: AddressLabelProps) {
  return (
    <Document title={`Address label — ${toName}`}>
      <Page size={[PAGE_W, PAGE_H]} style={s.page}>
        <View style={s.senderRow}>
          <View>
            <Text style={s.brand}>{APP_NAME.toUpperCase()}</Text>
            <Text style={s.brandSub}>Custom Sportswear</Text>
          </View>
          <View style={s.sender}>
            <Text>{RETURN_ADDRESS.name}</Text>
            {RETURN_ADDRESS.lines.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
            <Text>{RETURN_ADDRESS.phone}</Text>
          </View>
        </View>

        <View style={s.toBlock}>
          <Text style={s.toTag}>Deliver to</Text>
          <Text style={s.toName}>{toName}</Text>
          {toLines.map((line, i) => (
            <Text key={`${i}-${line}`} style={s.toLine}>
              {line}
            </Text>
          ))}
        </View>

        <View style={s.footer}>
          <Text>{RETURN_ADDRESS.website}</Text>
          {reference ? <Text>{reference}</Text> : <Text />}
        </View>
      </Page>
    </Document>
  );
}
