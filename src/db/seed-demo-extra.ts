/**
 * Adds 20 more demo orders (OC-DEMO-006 … OC-DEMO-025).
 * Re-uses size charts already in the DB from seed-demo.ts.
 * Safe to re-run — cleans up its own range first.
 *
 * Run with:  npm run db:seed-demo-extra
 */
import { inArray, like, and, eq } from 'drizzle-orm';
import { db } from './index';
import {
  orders, garments, garmentSizing, sizeCharts,
  garmentSizeChartLinks, orderAccess, acknowledgments, confirmations,
} from './schema';
import { generateToken, hashToken } from '@/lib/tokens';

const ACK_KEYS = [
  'mockup_correct', 'sizing_correct', 'fabrics_accepted',
  'delivery_noted', 'no_changes', 'payment_terms', 'authorised',
] as const;

function isoDate(offsetDays: number) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) { return new Date(Date.now() - n * 86_400_000); }

async function mkToken(orderId: string, viewedDaysAgo?: number) {
  const raw = generateToken();
  await db.insert(orderAccess).values({
    orderId,
    tokenHash: hashToken(raw),
    lastViewedAt: viewedDaysAgo != null ? daysAgo(viewedDaysAgo) : null,
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  return raw;
}

async function mkConfirmed(
  orderId: string,
  orderNumber: string,
  customerName: string,
  clubName: string,
  amount: string,
  garmentSnapshots: { name: string; fabrics: string[]; sizing: object[]; chartNames: string[] }[],
  confirmedAt: Date,
) {
  await db.insert(acknowledgments).values(
    ACK_KEYS.map((key) => ({ orderId, ackKey: key, ackTextVersion: 'v1', accepted: true, acceptedAt: confirmedAt })),
  );
  await db.insert(confirmations).values({
    orderId,
    signatureType: 'drawn',
    confirmedSnapshot: {
      orderNumber, customerName, clubName,
      orderValueAmount: amount, orderValueCurrency: 'NZD',
      customer_concerns: '',
      garments: garmentSnapshots.map((g) => ({
        name: g.name, fabrics: g.fabrics, sizing: g.sizing,
        size_chart_names: g.chartNames,
      })),
      acknowledgments: ACK_KEYS.map((k) => ({ key: k, text: k, accepted: true })),
    },
    confirmedAt,
    ipAddress: '210.55.7.' + Math.floor(Math.random() * 254 + 1),
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  });
}

// ---------------------------------------------------------------------------
async function seed() {
  console.log('\n🌱 Demo extra seed (orders 006–025)…\n');

  // Clean up this batch
  const existing = await db.select({ id: orders.id }).from(orders)
    .where(inArray(orders.orderNumber, Array.from({ length: 20 }, (_, i) => `OC-DEMO-${String(i + 6).padStart(3, '0')}`)));
  if (existing.length) {
    await db.delete(orders).where(inArray(orders.id, existing.map((r) => r.id)));
    console.log(`  Cleaned up ${existing.length} previous extra demo order(s)`);
  }

  // Resolve size charts
  const charts = await db.select({ id: sizeCharts.id, name: sizeCharts.name }).from(sizeCharts)
    .where(like(sizeCharts.name, '%(BeastMode Demo)%'));
  const tShirtsId = charts.find((c) => c.name.startsWith('T-Shirts'))?.id;
  const rainJacketsId = charts.find((c) => c.name.startsWith('Rain Jackets'))?.id;

  if (!tShirtsId || !rainJacketsId) {
    console.error('Size charts not found — run npm run db:seed-demo first.');
    process.exit(1);
  }

  // ─── DRAFT ─────────────────────────────────────────────────────────────────

  // 006 — Taranaki Bulls Rugby Club
  console.log('─ [006] DRAFT — Taranaki Bulls Rugby Club');
  const [o6] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-006',
    customerName: 'Hemi Parata',
    customerEmail: 'hemi@taranakibulls.co.nz',
    customerContact: '+64 27 111 222',
    clubName: 'Taranaki Bulls Rugby Club',
    orderValueAmount: '5200.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(30), deadlineDate: isoDate(24),
    generalNotes: 'Amber and black. Senior + colts squads combined. Home and away jerseys required.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: '88 Devon Street East', city: 'New Plymouth', region: 'Taranaki', postcode: '4310', country: 'NZ' },
    status: 'draft',
  }).returning();

  const [g6a] = await db.insert(garments).values({ orderId: o6.id, name: 'Home Jerseys', fabrics: ['Polyester Performance', 'BeastMode Pro Sublimation'], notes: 'Amber body, black collar.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g6a.id, size: 'S', playerName: 'Taine Rawiri', playerNumber: '1', sortOrder: 0 },
    { garmentId: g6a.id, size: 'M', playerName: 'Kupe Waititi', playerNumber: '2', sortOrder: 1 },
    { garmentId: g6a.id, size: 'M', playerName: 'Rangi Piripi', playerNumber: '3', sortOrder: 2 },
    { garmentId: g6a.id, size: 'L', playerName: 'Dev Sharma', playerNumber: '4', sortOrder: 3 },
    { garmentId: g6a.id, size: 'XL', playerName: 'Cole Henare', playerNumber: '5', sortOrder: 4 },
    { garmentId: g6a.id, size: '2XL', playerName: 'Manu Tūhoe', playerNumber: '6', sortOrder: 5 },
  ]);

  const [g6b] = await db.insert(garments).values({ orderId: o6.id, name: 'Rugby Shorts', fabrics: ['Polyester Stretch'], notes: 'Black with amber waistband.', sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g6b.id, size: 'S', sortOrder: 0 }, { garmentId: g6b.id, size: 'M', sortOrder: 1 },
    { garmentId: g6b.id, size: 'M', sortOrder: 2 }, { garmentId: g6b.id, size: 'L', sortOrder: 3 },
    { garmentId: g6b.id, size: 'XL', sortOrder: 4 }, { garmentId: g6b.id, size: '2XL', sortOrder: 5 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g6a.id, sizeChartId: tShirtsId },
    { garmentId: g6b.id, sizeChartId: tShirtsId },
  ]);

  // 007 — Marlborough Falcons Netball Club
  console.log('─ [007] DRAFT — Marlborough Falcons Netball Club');
  const [o7] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-007',
    customerName: 'Vanessa Kaye',
    customerEmail: 'vanessa@marlboroughfalcons.co.nz',
    customerContact: '+64 21 345 678',
    clubName: 'Marlborough Falcons Netball Club',
    orderValueAmount: '1980.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(40), deadlineDate: isoDate(33),
    generalNotes: 'Teal and silver. Awaiting final squad confirmation before sizing is locked in.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: '3 Seymour Square', city: 'Blenheim', region: 'Marlborough', postcode: '7201', country: 'NZ' },
    status: 'draft',
  }).returning();

  const [g7a] = await db.insert(garments).values({ orderId: o7.id, name: 'Netball Bibs', fabrics: ['Polyester Performance'], notes: 'Teal with silver trim.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g7a.id, size: 'XS', playerName: 'Emma Tahu', sortOrder: 0 },
    { garmentId: g7a.id, size: 'S', playerName: 'Mia Rawson', sortOrder: 1 },
    { garmentId: g7a.id, size: 'M', playerName: 'Lea Bright', sortOrder: 2 },
    { garmentId: g7a.id, size: 'M', playerName: 'Tara Frost', sortOrder: 3 },
    { garmentId: g7a.id, size: 'L', playerName: 'Bev Cross', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([{ garmentId: g7a.id, sizeChartId: tShirtsId }]);

  // 008 — Kapiti Coast United FC
  console.log('─ [008] DRAFT — Kapiti Coast United FC');
  const [o8] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-008',
    customerName: 'Pierre Lefebvre',
    customerEmail: 'pierre@kapiticoastfc.co.nz',
    clubName: 'Kapiti Coast United FC',
    orderValueAmount: '3350.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(25), deadlineDate: isoDate(20),
    generalNotes: 'Royal blue and white. U18 and U21 squads. Youth sizing especially important.',
    shippingMode: 'customer_entered',
    status: 'draft',
  }).returning();

  const [g8a] = await db.insert(garments).values({ orderId: o8.id, name: 'Match Jerseys', fabrics: ['Polyester Performance', 'Mesh Sides'], notes: 'Royal blue, white collar.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g8a.id, size: 'YM', playerName: 'Ollie Reid', playerNumber: '7', sortOrder: 0 },
    { garmentId: g8a.id, size: 'YL', playerName: 'Finn Casey', playerNumber: '9', sortOrder: 1 },
    { garmentId: g8a.id, size: 'S', playerName: 'Tom Blake', playerNumber: '11', sortOrder: 2 },
    { garmentId: g8a.id, size: 'M', playerName: 'Jed Norris', playerNumber: '10', sortOrder: 3 },
    { garmentId: g8a.id, size: 'L', playerName: 'Bryn Holt', playerNumber: '8', sortOrder: 4 },
  ]);

  const [g8b] = await db.insert(garments).values({ orderId: o8.id, name: 'Training Tops', fabrics: ['Polyester Performance'], notes: 'Plain royal blue. No name/number on training.', sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g8b.id, size: 'YM', sortOrder: 0 }, { garmentId: g8b.id, size: 'YL', sortOrder: 1 },
    { garmentId: g8b.id, size: 'S', sortOrder: 2 }, { garmentId: g8b.id, size: 'M', sortOrder: 3 },
    { garmentId: g8b.id, size: 'L', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g8a.id, sizeChartId: tShirtsId },
    { garmentId: g8b.id, sizeChartId: tShirtsId },
  ]);

  // 009 — Gisborne Surf Lifesaving Club
  console.log('─ [009] DRAFT — Gisborne Surf Lifesaving Club');
  const [o9] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-009',
    customerName: 'Aroha Mead',
    customerEmail: 'aroha@gisbornesurf.co.nz',
    customerContact: '+64 6 868 4400',
    clubName: 'Gisborne Surf Lifesaving Club',
    orderValueAmount: '2890.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(50), deadlineDate: isoDate(45),
    generalNotes: 'Red and yellow — standard patrol colours. High-vis required. UPF50+ fabric mandatory.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: '1 Childers Road', city: 'Gisborne', region: 'Gisborne', postcode: '4010', country: 'NZ' },
    status: 'draft',
  }).returning();

  const [g9a] = await db.insert(garments).values({ orderId: o9.id, name: 'Patrol Rashguards', fabrics: ['UPF50+ Polyester', 'BeastMode Pro Sublimation'], notes: 'Red and yellow block pattern. "SURF RESCUE" on back.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g9a.id, size: 'S', playerName: 'Jake Tūpou', sortOrder: 0 },
    { garmentId: g9a.id, size: 'M', playerName: 'Sam Keene', sortOrder: 1 },
    { garmentId: g9a.id, size: 'M', playerName: 'Harry Quinn', sortOrder: 2 },
    { garmentId: g9a.id, size: 'L', playerName: 'Ethan Roy', sortOrder: 3 },
    { garmentId: g9a.id, size: 'XL', playerName: 'Mat Cole', sortOrder: 4 },
    { garmentId: g9a.id, size: 'XL', playerName: 'Ben Fox', sortOrder: 5 },
  ]);
  await db.insert(garmentSizeChartLinks).values([{ garmentId: g9a.id, sizeChartId: tShirtsId }]);

  // ─── SENT ──────────────────────────────────────────────────────────────────

  // 010 — Wellington Phoenix Youth FC
  console.log('─ [010] SENT — Wellington Phoenix Youth FC');
  const [o10] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-010',
    customerName: 'Carlos Mendez',
    customerEmail: 'carlos@phoenixyouth.co.nz',
    clubName: 'Wellington Phoenix Youth FC',
    orderValueAmount: '4450.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(18), deadlineDate: isoDate(14),
    generalNotes: 'Yellow and black. Academy colours. Three garment types — link all charts.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: 'Sky Stadium, Waterfront', city: 'Wellington', region: 'Wellington', postcode: '6011', country: 'NZ' },
    status: 'sent',
  }).returning();
  await mkToken(o10.id);

  const [g10a] = await db.insert(garments).values({ orderId: o10.id, name: 'Match Jerseys', fabrics: ['Polyester Performance'], notes: 'Yellow body, black accents.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g10a.id, size: 'YS', playerName: 'Leo Park', playerNumber: '9', sortOrder: 0 },
    { garmentId: g10a.id, size: 'YM', playerName: 'Zac Hunt', playerNumber: '10', sortOrder: 1 },
    { garmentId: g10a.id, size: 'YL', playerName: 'Finn Bell', playerNumber: '7', sortOrder: 2 },
    { garmentId: g10a.id, size: 'S', playerName: 'Nico Díaz', playerNumber: '11', sortOrder: 3 },
    { garmentId: g10a.id, size: 'M', playerName: 'Kai Stone', playerNumber: '8', sortOrder: 4 },
  ]);

  const [g10b] = await db.insert(garments).values({ orderId: o10.id, name: 'Match Shorts', fabrics: ['Polyester Stretch'], notes: 'Black.', sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g10b.id, size: 'YS', sortOrder: 0 }, { garmentId: g10b.id, size: 'YM', sortOrder: 1 },
    { garmentId: g10b.id, size: 'YL', sortOrder: 2 }, { garmentId: g10b.id, size: 'S', sortOrder: 3 },
    { garmentId: g10b.id, size: 'M', sortOrder: 4 },
  ]);

  const [g10c] = await db.insert(garments).values({ orderId: o10.id, name: 'Rain Jackets', fabrics: ['Polyester Shell', 'Fleece Lining'], notes: 'Yellow shell, black zip and collar.', sortOrder: 2 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g10c.id, size: 'YS', sortOrder: 0 }, { garmentId: g10c.id, size: 'YM', sortOrder: 1 },
    { garmentId: g10c.id, size: 'YL', sortOrder: 2 }, { garmentId: g10c.id, size: 'S', sortOrder: 3 },
    { garmentId: g10c.id, size: 'M', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g10a.id, sizeChartId: tShirtsId },
    { garmentId: g10b.id, sizeChartId: tShirtsId },
    { garmentId: g10c.id, sizeChartId: rainJacketsId },
  ]);

  // 011 — Waikato Chiefs Junior Rugby
  console.log('─ [011] SENT — Waikato Chiefs Junior Rugby Academy');
  const [o11] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-011',
    customerName: 'Tūhoe Ngāti',
    customerEmail: 'tuhoe@chiefsjunior.co.nz',
    customerContact: '+64 7 838 0000',
    clubName: 'Waikato Chiefs Junior Rugby Academy',
    orderValueAmount: '7800.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(22), deadlineDate: isoDate(17),
    generalNotes: 'Red, gold and black. Largest order this season — 60 jerseys, 60 shorts across four age groups.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: '64 Garnett Ave', city: 'Hamilton', region: 'Waikato', postcode: '3200', country: 'NZ' },
    status: 'sent',
  }).returning();
  await mkToken(o11.id);

  const [g11a] = await db.insert(garments).values({ orderId: o11.id, name: 'Match Jerseys — All Age Groups', fabrics: ['Polyester Performance', 'BeastMode Pro Sublimation'], notes: 'Red/gold/black. Age group label on collar tag.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g11a.id, size: 'YXS', notes: 'U10', sortOrder: 0 },
    { garmentId: g11a.id, size: 'YS', notes: 'U12', sortOrder: 1 },
    { garmentId: g11a.id, size: 'YM', notes: 'U14', sortOrder: 2 },
    { garmentId: g11a.id, size: 'YL', notes: 'U14', sortOrder: 3 },
    { garmentId: g11a.id, size: 'S', notes: 'U16', sortOrder: 4 },
    { garmentId: g11a.id, size: 'M', notes: 'U16', sortOrder: 5 },
    { garmentId: g11a.id, size: 'L', notes: 'U18', sortOrder: 6 },
  ]);

  const [g11b] = await db.insert(garments).values({ orderId: o11.id, name: 'Rugby Shorts — All Age Groups', fabrics: ['Polyester Stretch'], sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g11b.id, size: 'YXS', sortOrder: 0 }, { garmentId: g11b.id, size: 'YS', sortOrder: 1 },
    { garmentId: g11b.id, size: 'YM', sortOrder: 2 }, { garmentId: g11b.id, size: 'YL', sortOrder: 3 },
    { garmentId: g11b.id, size: 'S', sortOrder: 4 }, { garmentId: g11b.id, size: 'M', sortOrder: 5 },
    { garmentId: g11b.id, size: 'L', sortOrder: 6 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g11a.id, sizeChartId: tShirtsId },
    { garmentId: g11b.id, sizeChartId: tShirtsId },
  ]);

  // 012 — Hutt Valley Netball Association
  console.log('─ [012] SENT — Hutt Valley Netball Association');
  const [o12] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-012',
    customerName: 'Sandra Lowe',
    customerEmail: 'sandra@huttnetball.co.nz',
    clubName: 'Hutt Valley Netball Association',
    orderValueAmount: '3100.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(35), deadlineDate: isoDate(28),
    generalNotes: 'Purple and white. Multi-team order — three grade teams sharing same kit design.',
    shippingMode: 'customer_entered',
    status: 'sent',
  }).returning();
  await mkToken(o12.id);

  const [g12a] = await db.insert(garments).values({ orderId: o12.id, name: 'Netball Tops', fabrics: ['Polyester Performance', 'Lycra Stretch Panel'], notes: 'Purple body, white contrast panel.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g12a.id, size: 'XS', sortOrder: 0 }, { garmentId: g12a.id, size: 'S', sortOrder: 1 },
    { garmentId: g12a.id, size: 'S', sortOrder: 2 }, { garmentId: g12a.id, size: 'M', sortOrder: 3 },
    { garmentId: g12a.id, size: 'M', sortOrder: 4 }, { garmentId: g12a.id, size: 'L', sortOrder: 5 },
  ]);

  const [g12b] = await db.insert(garments).values({ orderId: o12.id, name: 'Netball Skirts', fabrics: ['Polyester Stretch', 'Attached Short'], sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g12b.id, size: 'XS', sortOrder: 0 }, { garmentId: g12b.id, size: 'S', sortOrder: 1 },
    { garmentId: g12b.id, size: 'S', sortOrder: 2 }, { garmentId: g12b.id, size: 'M', sortOrder: 3 },
    { garmentId: g12b.id, size: 'M', sortOrder: 4 }, { garmentId: g12b.id, size: 'L', sortOrder: 5 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g12a.id, sizeChartId: tShirtsId },
    { garmentId: g12b.id, sizeChartId: tShirtsId },
  ]);

  // 013 — Eastbourne Eagles Rugby
  console.log('─ [013] SENT — Eastbourne Eagles Rugby Club');
  const [o13] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-013',
    customerName: 'Wayne Burrows',
    customerEmail: 'wayne@eastbourneeagles.co.nz',
    clubName: 'Eastbourne Eagles Rugby Club',
    orderValueAmount: '5950.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(16), deadlineDate: isoDate(12),
    generalNotes: 'Maroon and gold. Full senior squad kit including warm-up jackets.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: '42 Muritai Road', city: 'Eastbourne', region: 'Wellington', postcode: '5013', country: 'NZ' },
    status: 'sent',
  }).returning();
  await mkToken(o13.id);

  const [g13a] = await db.insert(garments).values({ orderId: o13.id, name: 'Match Jerseys', fabrics: ['Polyester Performance'], notes: 'Maroon body, gold band across chest.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g13a.id, size: 'S', playerName: 'Rhys Evans', playerNumber: '9', sortOrder: 0 },
    { garmentId: g13a.id, size: 'M', playerName: 'Craig Hall', playerNumber: '10', sortOrder: 1 },
    { garmentId: g13a.id, size: 'L', playerName: 'Ben Yates', playerNumber: '11', sortOrder: 2 },
    { garmentId: g13a.id, size: 'XL', playerName: 'Drew King', playerNumber: '12', sortOrder: 3 },
    { garmentId: g13a.id, size: '2XL', playerName: 'Matt Gore', playerNumber: '13', sortOrder: 4 },
  ]);

  const [g13b] = await db.insert(garments).values({ orderId: o13.id, name: 'Warm-Up Jackets', fabrics: ['Polyester Shell', 'Mesh Lining'], notes: 'Maroon with gold zip detail.', sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g13b.id, size: 'S', sortOrder: 0 }, { garmentId: g13b.id, size: 'M', sortOrder: 1 },
    { garmentId: g13b.id, size: 'L', sortOrder: 2 }, { garmentId: g13b.id, size: 'XL', sortOrder: 3 },
    { garmentId: g13b.id, size: '2XL', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g13a.id, sizeChartId: tShirtsId },
    { garmentId: g13b.id, sizeChartId: rainJacketsId },
  ]);

  // ─── VIEWED ────────────────────────────────────────────────────────────────

  // 014 — Canterbury Volleyball Club
  console.log('─ [014] VIEWED — Canterbury Volleyball Club');
  const [o14] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-014',
    customerName: 'Natalie Cheng',
    customerEmail: 'natalie@cantvball.co.nz',
    clubName: 'Canterbury Volleyball Club',
    orderValueAmount: '2100.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(10), deadlineDate: isoDate(7),
    generalNotes: 'Crimson and white. Men\'s and women\'s teams in same order.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: '55 Nga Mahi Road', city: 'Christchurch', region: 'Canterbury', postcode: '8042', country: 'NZ' },
    status: 'viewed',
  }).returning();
  await mkToken(o14.id, 1);

  const [g14a] = await db.insert(garments).values({ orderId: o14.id, name: 'Volleyball Jerseys', fabrics: ['Polyester Performance'], notes: 'Crimson, white side panels.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g14a.id, size: 'XS', playerName: 'Lily Ng', playerNumber: '1', sortOrder: 0 },
    { garmentId: g14a.id, size: 'S', playerName: 'Rose Lee', playerNumber: '3', sortOrder: 1 },
    { garmentId: g14a.id, size: 'M', playerName: 'Ada Wong', playerNumber: '5', sortOrder: 2 },
    { garmentId: g14a.id, size: 'L', playerName: 'Iris Ho', playerNumber: '7', sortOrder: 3 },
    { garmentId: g14a.id, size: 'XL', playerName: 'Vera Yip', playerNumber: '9', sortOrder: 4 },
  ]);

  const [g14b] = await db.insert(garments).values({ orderId: o14.id, name: 'Volleyball Shorts', fabrics: ['Polyester Stretch'], sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g14b.id, size: 'XS', sortOrder: 0 }, { garmentId: g14b.id, size: 'S', sortOrder: 1 },
    { garmentId: g14b.id, size: 'M', sortOrder: 2 }, { garmentId: g14b.id, size: 'L', sortOrder: 3 },
    { garmentId: g14b.id, size: 'XL', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g14a.id, sizeChartId: tShirtsId },
    { garmentId: g14b.id, sizeChartId: tShirtsId },
  ]);

  // 015 — Southland Stags Touch Rugby
  console.log('─ [015] VIEWED — Southland Stags Touch Rugby');
  const [o15] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-015',
    customerName: 'Greg Millar',
    customerEmail: 'greg@southlandstags.co.nz',
    clubName: 'Southland Stags Touch Rugby',
    orderValueAmount: '1750.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(20), deadlineDate: isoDate(16),
    generalNotes: 'Dark green, white, and black. Mixed team — men\'s and women\'s sizing in same run.',
    shippingMode: 'later',
    status: 'viewed',
  }).returning();
  await mkToken(o15.id, 2);

  const [g15a] = await db.insert(garments).values({ orderId: o15.id, name: 'Touch Rugby Jerseys', fabrics: ['Polyester Performance', 'BeastMode Pro Sublimation'], notes: 'Dark green base, white chevron.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g15a.id, size: 'WS', playerName: 'Kelly Pene', sortOrder: 0 },
    { garmentId: g15a.id, size: 'WM', playerName: 'Donna Hill', sortOrder: 1 },
    { garmentId: g15a.id, size: 'S', playerName: 'Paul Lang', sortOrder: 2 },
    { garmentId: g15a.id, size: 'M', playerName: 'Nick Bell', sortOrder: 3 },
    { garmentId: g15a.id, size: 'L', playerName: 'Tony Gray', sortOrder: 4 },
    { garmentId: g15a.id, size: 'XL', playerName: 'Steve Dunn', sortOrder: 5 },
  ]);
  await db.insert(garmentSizeChartLinks).values([{ garmentId: g15a.id, sizeChartId: tShirtsId }]);

  // 016 — Nelson Bays FC
  console.log('─ [016] VIEWED — Nelson Bays FC');
  const [o16] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-016',
    customerName: 'Sam Renwick',
    customerEmail: 'sam@nelsonbaysfc.co.nz',
    customerContact: '+64 3 546 7890',
    clubName: 'Nelson Bays FC',
    orderValueAmount: '4200.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(12), deadlineDate: isoDate(8),
    generalNotes: 'Sky blue and yellow. Full kit: jerseys, shorts, and socks. Socks not listed separately — please add if needed.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: '12 Trafalgar Square', city: 'Nelson', region: 'Nelson', postcode: '7010', country: 'NZ' },
    status: 'viewed',
  }).returning();
  await mkToken(o16.id, 3);

  const [g16a] = await db.insert(garments).values({ orderId: o16.id, name: 'Match Jerseys', fabrics: ['Polyester Performance', 'Mesh Panel'], sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g16a.id, size: 'S', playerName: 'Hayden Rich', playerNumber: '1', sortOrder: 0 },
    { garmentId: g16a.id, size: 'M', playerName: 'Josh Kerr', playerNumber: '4', sortOrder: 1 },
    { garmentId: g16a.id, size: 'M', playerName: 'Dylan Fry', playerNumber: '8', sortOrder: 2 },
    { garmentId: g16a.id, size: 'L', playerName: 'Aaron Vos', playerNumber: '10', sortOrder: 3 },
    { garmentId: g16a.id, size: 'XL', playerName: 'Ben Lake', playerNumber: '11', sortOrder: 4 },
  ]);

  const [g16b] = await db.insert(garments).values({ orderId: o16.id, name: 'Match Shorts', fabrics: ['Polyester Stretch'], sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g16b.id, size: 'S', sortOrder: 0 }, { garmentId: g16b.id, size: 'M', sortOrder: 1 },
    { garmentId: g16b.id, size: 'M', sortOrder: 2 }, { garmentId: g16b.id, size: 'L', sortOrder: 3 },
    { garmentId: g16b.id, size: 'XL', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g16a.id, sizeChartId: tShirtsId },
    { garmentId: g16b.id, sizeChartId: tShirtsId },
  ]);

  // 017 — West Coast Rovers Hockey Club
  console.log('─ [017] VIEWED — West Coast Rovers Hockey Club');
  const [o17] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-017',
    customerName: 'Isla Mackenzie',
    customerEmail: 'isla@wcrovers.co.nz',
    clubName: 'West Coast Rovers Hockey Club',
    orderValueAmount: '2650.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(17), deadlineDate: isoDate(13),
    generalNotes: 'Navy and orange. Women\'s club — please check women\'s sizing charts carefully.',
    shippingMode: 'customer_entered',
    status: 'viewed',
  }).returning();
  await mkToken(o17.id, 1);

  const [g17a] = await db.insert(garments).values({ orderId: o17.id, name: 'Hockey Jerseys', fabrics: ['Polyester Performance'], notes: 'Navy body, orange contrast shoulder.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g17a.id, size: 'WXS', playerName: 'Ali Stone', sortOrder: 0 },
    { garmentId: g17a.id, size: 'WS', playerName: 'Bex Hill', sortOrder: 1 },
    { garmentId: g17a.id, size: 'WM', playerName: 'Cal Day', sortOrder: 2 },
    { garmentId: g17a.id, size: 'WL', playerName: 'Di Fox', sortOrder: 3 },
    { garmentId: g17a.id, size: 'WXL', playerName: 'Eva Ray', sortOrder: 4 },
  ]);

  const [g17b] = await db.insert(garments).values({ orderId: o17.id, name: 'Hockey Skorts', fabrics: ['Polyester Stretch'], sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g17b.id, size: 'WXS', sortOrder: 0 }, { garmentId: g17b.id, size: 'WS', sortOrder: 1 },
    { garmentId: g17b.id, size: 'WM', sortOrder: 2 }, { garmentId: g17b.id, size: 'WL', sortOrder: 3 },
    { garmentId: g17b.id, size: 'WXL', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g17a.id, sizeChartId: tShirtsId },
    { garmentId: g17b.id, sizeChartId: tShirtsId },
  ]);

  // ─── CONFIRMED ─────────────────────────────────────────────────────────────

  // 018 — Northland Kauri Netball Club
  console.log('─ [018] CONFIRMED — Northland Kauri Netball Club');
  const confirmedAt18 = daysAgo(5);
  const [o18] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-018',
    customerName: 'Helen Rangi',
    customerEmail: 'helen@northlandkauri.co.nz',
    clubName: 'Northland Kauri Netball Club',
    orderValueAmount: '2250.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(-2),
    shippingMode: 'prefilled',
    shippingAddress: { line1: '5 Bank Street', city: 'Whangārei', region: 'Northland', postcode: '0110', country: 'NZ' },
    status: 'confirmed', confirmedAt: confirmedAt18,
  }).returning();
  await mkToken(o18.id, 6);

  const [g18a] = await db.insert(garments).values({ orderId: o18.id, name: 'Netball Tops', fabrics: ['Polyester Performance'], notes: 'Forest green and gold. Squad of 10.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g18a.id, size: 'XS', playerName: 'Anna Hira', sortOrder: 0 },
    { garmentId: g18a.id, size: 'S', playerName: 'Beth Tū', sortOrder: 1 },
    { garmentId: g18a.id, size: 'M', playerName: 'Clare Ngāti', sortOrder: 2 },
    { garmentId: g18a.id, size: 'L', playerName: 'Dana Parata', sortOrder: 3 },
    { garmentId: g18a.id, size: 'XL', playerName: 'Evie Moka', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([{ garmentId: g18a.id, sizeChartId: tShirtsId }]);
  await mkConfirmed(o18.id, 'OC-DEMO-018', 'Helen Rangi', 'Northland Kauri Netball Club', '2250.00',
    [{ name: 'Netball Tops', fabrics: ['Polyester Performance'], sizing: [{ size: 'XS' }, { size: 'S' }, { size: 'M' }, { size: 'L' }, { size: 'XL' }], chartNames: ['T-Shirts (BeastMode Demo)'] }],
    confirmedAt18,
  );

  // 019 — Manawatu Turbos Basketball
  console.log('─ [019] CONFIRMED — Manawatu Turbos Basketball Club');
  const confirmedAt19 = daysAgo(8);
  const [o19] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-019',
    customerName: 'Derek Lisi',
    customerEmail: 'derek@manawatubasket.co.nz',
    clubName: 'Manawatu Turbos Basketball Club',
    orderValueAmount: '3300.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(-1),
    shippingMode: 'prefilled',
    shippingAddress: { line1: '354 Main Street', city: 'Palmerston North', region: 'Manawatu', postcode: '4410', country: 'NZ' },
    status: 'confirmed', confirmedAt: confirmedAt19,
  }).returning();
  await mkToken(o19.id, 9);

  const [g19a] = await db.insert(garments).values({ orderId: o19.id, name: 'Basketball Jerseys', fabrics: ['Polyester Performance', 'Mesh'], notes: 'Blue and white reversible design.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g19a.id, size: 'S', playerName: 'Marcus Webb', playerNumber: '4', sortOrder: 0 },
    { garmentId: g19a.id, size: 'M', playerName: 'Jordan Tui', playerNumber: '7', sortOrder: 1 },
    { garmentId: g19a.id, size: 'L', playerName: 'Nathan Pio', playerNumber: '11', sortOrder: 2 },
    { garmentId: g19a.id, size: 'XL', playerName: 'Chris Ah Sam', playerNumber: '23', sortOrder: 3 },
    { garmentId: g19a.id, size: '2XL', playerName: 'Damo Ngata', playerNumber: '32', sortOrder: 4 },
  ]);

  const [g19b] = await db.insert(garments).values({ orderId: o19.id, name: 'Basketball Shorts', fabrics: ['Polyester Stretch'], sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g19b.id, size: 'S', sortOrder: 0 }, { garmentId: g19b.id, size: 'M', sortOrder: 1 },
    { garmentId: g19b.id, size: 'L', sortOrder: 2 }, { garmentId: g19b.id, size: 'XL', sortOrder: 3 },
    { garmentId: g19b.id, size: '2XL', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g19a.id, sizeChartId: tShirtsId },
    { garmentId: g19b.id, sizeChartId: tShirtsId },
  ]);
  await mkConfirmed(o19.id, 'OC-DEMO-019', 'Derek Lisi', 'Manawatu Turbos Basketball Club', '3300.00',
    [
      { name: 'Basketball Jerseys', fabrics: ['Polyester Performance', 'Mesh'], sizing: [{ size: 'S' }, { size: 'M' }, { size: 'L' }, { size: 'XL' }, { size: '2XL' }], chartNames: ['T-Shirts (BeastMode Demo)'] },
      { name: 'Basketball Shorts', fabrics: ['Polyester Stretch'], sizing: [{ size: 'S' }, { size: 'M' }, { size: 'L' }, { size: 'XL' }, { size: '2XL' }], chartNames: ['T-Shirts (BeastMode Demo)'] },
    ],
    confirmedAt19,
  );

  // 020 — Thames Valley Volleyball
  console.log('─ [020] CONFIRMED — Thames Valley Volleyball');
  const confirmedAt20 = daysAgo(12);
  const [o20] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-020',
    customerName: 'Tony Sinclair',
    customerEmail: 'tony@thamesvalleyvball.co.nz',
    clubName: 'Thames Valley Volleyball',
    orderValueAmount: '1420.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(-10),
    shippingMode: 'prefilled',
    shippingAddress: { line1: '4 Pollen Street', city: 'Thames', region: 'Waikato', postcode: '3500', country: 'NZ' },
    status: 'confirmed', confirmedAt: confirmedAt20,
  }).returning();
  await mkToken(o20.id, 13);

  const [g20a] = await db.insert(garments).values({ orderId: o20.id, name: 'Volleyball Jerseys', fabrics: ['Polyester Performance'], sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g20a.id, size: 'S', sortOrder: 0 }, { garmentId: g20a.id, size: 'M', sortOrder: 1 },
    { garmentId: g20a.id, size: 'M', sortOrder: 2 }, { garmentId: g20a.id, size: 'L', sortOrder: 3 },
    { garmentId: g20a.id, size: 'XL', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([{ garmentId: g20a.id, sizeChartId: tShirtsId }]);
  await mkConfirmed(o20.id, 'OC-DEMO-020', 'Tony Sinclair', 'Thames Valley Volleyball', '1420.00',
    [{ name: 'Volleyball Jerseys', fabrics: ['Polyester Performance'], sizing: [{ size: 'S' }, { size: 'M' }, { size: 'M' }, { size: 'L' }, { size: 'XL' }], chartNames: ['T-Shirts (BeastMode Demo)'] }],
    confirmedAt20,
  );

  // 021 — Otago Highlanders Women's Rugby
  console.log('─ [021] CONFIRMED — Otago Highlanders Women\'s Rugby');
  const confirmedAt21 = daysAgo(2);
  const [o21] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-021',
    customerName: 'Cora Sinclair',
    customerEmail: 'cora@otagohighlanders.co.nz',
    clubName: "Otago Highlanders Women's Rugby",
    orderValueAmount: '4600.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(3),
    shippingMode: 'prefilled',
    shippingAddress: { line1: '100 Anzac Avenue', city: 'Dunedin', region: 'Otago', postcode: '9016', country: 'NZ' },
    status: 'confirmed', confirmedAt: confirmedAt21,
  }).returning();
  await mkToken(o21.id, 3);

  const [g21a] = await db.insert(garments).values({ orderId: o21.id, name: 'Rugby Jerseys', fabrics: ['Polyester Performance', 'BeastMode Pro Sublimation'], notes: 'Blue and gold. Women\'s cut.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g21a.id, size: 'WXS', playerName: 'Aoife Ryan', sortOrder: 0 },
    { garmentId: g21a.id, size: 'WS', playerName: 'Beth Walsh', sortOrder: 1 },
    { garmentId: g21a.id, size: 'WM', playerName: 'Cath Drew', sortOrder: 2 },
    { garmentId: g21a.id, size: 'WL', playerName: 'Di Carr', sortOrder: 3 },
    { garmentId: g21a.id, size: 'WXL', playerName: 'Eve Long', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([{ garmentId: g21a.id, sizeChartId: tShirtsId }]);
  await mkConfirmed(o21.id, 'OC-DEMO-021', 'Cora Sinclair', "Otago Highlanders Women's Rugby", '4600.00',
    [{ name: 'Rugby Jerseys', fabrics: ['Polyester Performance'], sizing: [{ size: 'WXS' }, { size: 'WS' }, { size: 'WM' }, { size: 'WL' }, { size: 'WXL' }], chartNames: ['T-Shirts (BeastMode Demo)'] }],
    confirmedAt21,
  );

  // ─── CHANGES_REQUESTED ─────────────────────────────────────────────────────

  // 022 — Otago Mountain Biking Association
  console.log('─ [022] CHANGES_REQUESTED — Otago Mountain Biking Association');
  const [o22] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-022',
    customerName: 'Ross Tanner',
    customerEmail: 'ross@otagomtb.co.nz',
    clubName: 'Otago Mountain Biking Association',
    orderValueAmount: '3150.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(28), deadlineDate: isoDate(24),
    generalNotes: 'Changes requested: customer wants sponsor logo on left sleeve removed from all jerseys. Awaiting updated artwork file.',
    shippingMode: 'later',
    status: 'changes_requested',
  }).returning();
  await mkToken(o22.id, 4);

  const [g22a] = await db.insert(garments).values({ orderId: o22.id, name: 'MTB Race Jerseys', fabrics: ['Polyester Performance', 'BeastMode Pro Sublimation'], notes: 'Black and neon green. Full zip.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g22a.id, size: 'S', playerName: 'Pete Hall', sortOrder: 0 },
    { garmentId: g22a.id, size: 'M', playerName: 'Dan Reid', sortOrder: 1 },
    { garmentId: g22a.id, size: 'L', playerName: 'Al Buck', sortOrder: 2 },
    { garmentId: g22a.id, size: 'XL', playerName: 'Tom Hale', sortOrder: 3 },
  ]);

  const [g22b] = await db.insert(garments).values({ orderId: o22.id, name: 'MTB Race Bibs', fabrics: ['Polyester Stretch', 'Lycra Panel'], sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g22b.id, size: 'S', sortOrder: 0 }, { garmentId: g22b.id, size: 'M', sortOrder: 1 },
    { garmentId: g22b.id, size: 'L', sortOrder: 2 }, { garmentId: g22b.id, size: 'XL', sortOrder: 3 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g22a.id, sizeChartId: tShirtsId },
    { garmentId: g22b.id, sizeChartId: tShirtsId },
  ]);

  // 023 — Hawke's Bay Magpies Cricket Club
  console.log('─ [023] CHANGES_REQUESTED — Hawke\'s Bay Magpies Cricket Club');
  const [o23] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-023',
    customerName: 'Ian Dunlop',
    customerEmail: 'ian@hbmagpies.co.nz',
    customerContact: '+64 6 843 2200',
    clubName: "Hawke's Bay Magpies Cricket Club",
    orderValueAmount: '2800.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(32), deadlineDate: isoDate(28),
    generalNotes: 'Changes: trouser length needs adjustment — player 5 needs 2cm shorter hemline noted separately. Updated measurement sent by email.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: '1 Park Island Drive', city: 'Napier', region: "Hawke's Bay", postcode: '4110', country: 'NZ' },
    status: 'changes_requested',
  }).returning();
  await mkToken(o23.id, 2);

  const [g23a] = await db.insert(garments).values({ orderId: o23.id, name: 'Cricket Playing Shirts', fabrics: ['Polyester Moisture Wicking'], notes: 'Black and white. Club crest on left chest.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g23a.id, size: 'S', playerName: 'Jack Orr', sortOrder: 0 },
    { garmentId: g23a.id, size: 'M', playerName: 'Will Ross', sortOrder: 1 },
    { garmentId: g23a.id, size: 'L', playerName: 'Ed Nash', sortOrder: 2 },
    { garmentId: g23a.id, size: 'XL', playerName: 'Rob Kane', sortOrder: 3 },
    { garmentId: g23a.id, size: '2XL', playerName: 'Stu Ford', notes: 'Hemline -2cm', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([{ garmentId: g23a.id, sizeChartId: tShirtsId }]);

  // 024 — Poverty Bay Athletics Club
  console.log('─ [024] CHANGES_REQUESTED — Poverty Bay Athletics Club');
  const [o24] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-024',
    customerName: 'Rosa Waru',
    customerEmail: 'rosa@povertybaytheathletics.co.nz',
    clubName: 'Poverty Bay Athletics Club',
    orderValueAmount: '1380.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(45), deadlineDate: isoDate(40),
    generalNotes: 'Customer has flagged that the background colour in the mockup looks more olive than the requested lime green. Needs colour correction before approval.',
    shippingMode: 'later',
    status: 'changes_requested',
  }).returning();
  await mkToken(o24.id, 1);

  const [g24a] = await db.insert(garments).values({ orderId: o24.id, name: 'Athletics Singlets', fabrics: ['UPF50+ Polyester', 'Racerback'], notes: 'Lime green — colour currently incorrect on mockup.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g24a.id, size: 'XS', playerName: 'Kiri Mere', sortOrder: 0 },
    { garmentId: g24a.id, size: 'S', playerName: 'Lou Puru', sortOrder: 1 },
    { garmentId: g24a.id, size: 'M', playerName: 'Jade Kaa', sortOrder: 2 },
    { garmentId: g24a.id, size: 'L', playerName: 'Nia Tūhoe', sortOrder: 3 },
  ]);
  await db.insert(garmentSizeChartLinks).values([{ garmentId: g24a.id, sizeChartId: tShirtsId }]);

  // 025 — Whanganui Collegiate Rowing Club
  console.log('─ [025] CHANGES_REQUESTED — Whanganui Collegiate Rowing Club');
  const [o25] = await db.insert(orders).values({
    orderNumber: 'OC-DEMO-025',
    customerName: 'Mark Dillon',
    customerEmail: 'mark@whanganuirowing.co.nz',
    clubName: 'Whanganui Collegiate Rowing Club',
    orderValueAmount: '5400.00', orderValueCurrency: 'NZD',
    expectedShipDate: isoDate(38), deadlineDate: isoDate(32),
    generalNotes: 'Changes: coxswain kit needs to be in WM not WL — wrong size was listed in original submission. Confirmed via phone.',
    shippingMode: 'prefilled',
    shippingAddress: { line1: 'Whanganui River Road', city: 'Whanganui', region: 'Manawatu-Whanganui', postcode: '4500', country: 'NZ' },
    status: 'changes_requested',
  }).returning();
  await mkToken(o25.id, 3);

  const [g25a] = await db.insert(garments).values({ orderId: o25.id, name: 'Rowing Unitards', fabrics: ['Lycra Performance', 'UPF50+'], notes: 'Red with white diagonal stripe. Long-sleeve unitard.', sortOrder: 0 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g25a.id, size: 'WS', playerName: 'Tia Henare', notes: 'Bow', sortOrder: 0 },
    { garmentId: g25a.id, size: 'WM', playerName: 'Nina Cross', notes: '2 seat', sortOrder: 1 },
    { garmentId: g25a.id, size: 'WM', playerName: 'Amy Fox', notes: '3 seat', sortOrder: 2 },
    { garmentId: g25a.id, size: 'WL', playerName: 'Bex Kay', notes: '4 seat — update to WM', sortOrder: 3 },
    { garmentId: g25a.id, size: 'WM', playerName: 'Cara Lee', notes: 'Cox', sortOrder: 4 },
  ]);

  const [g25b] = await db.insert(garments).values({ orderId: o25.id, name: 'Warm-Up Jackets', fabrics: ['Polyester Shell', 'Fleece Lining'], notes: 'Red zip jacket for pre/post race.', sortOrder: 1 }).returning();
  await db.insert(garmentSizing).values([
    { garmentId: g25b.id, size: 'WS', sortOrder: 0 }, { garmentId: g25b.id, size: 'WM', sortOrder: 1 },
    { garmentId: g25b.id, size: 'WM', sortOrder: 2 }, { garmentId: g25b.id, size: 'WL', sortOrder: 3 },
    { garmentId: g25b.id, size: 'WM', sortOrder: 4 },
  ]);
  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g25a.id, sizeChartId: tShirtsId },
    { garmentId: g25b.id, sizeChartId: rainJacketsId },
  ]);

  // ─── Done ──────────────────────────────────────────────────────────────────
  console.log('\n✅ 20 extra demo orders seeded.\n');
  console.log('  006 DRAFT             Taranaki Bulls Rugby Club');
  console.log('  007 DRAFT             Marlborough Falcons Netball Club');
  console.log('  008 DRAFT             Kapiti Coast United FC');
  console.log('  009 DRAFT             Gisborne Surf Lifesaving Club');
  console.log('  010 SENT              Wellington Phoenix Youth FC');
  console.log('  011 SENT              Waikato Chiefs Junior Rugby Academy');
  console.log('  012 SENT              Hutt Valley Netball Association');
  console.log('  013 SENT              Eastbourne Eagles Rugby Club');
  console.log('  014 VIEWED            Canterbury Volleyball Club');
  console.log('  015 VIEWED            Southland Stags Touch Rugby');
  console.log('  016 VIEWED            Nelson Bays FC');
  console.log('  017 VIEWED            West Coast Rovers Hockey Club');
  console.log('  018 CONFIRMED         Northland Kauri Netball Club');
  console.log('  019 CONFIRMED         Manawatu Turbos Basketball Club');
  console.log('  020 CONFIRMED         Thames Valley Volleyball');
  console.log('  021 CONFIRMED         Otago Highlanders Women\'s Rugby');
  console.log('  022 CHANGES_REQUESTED Otago Mountain Biking Association');
  console.log('  023 CHANGES_REQUESTED Hawke\'s Bay Magpies Cricket Club');
  console.log('  024 CHANGES_REQUESTED Poverty Bay Athletics Club');
  console.log('  025 CHANGES_REQUESTED Whanganui Collegiate Rowing Club\n');

  process.exit(0);
}

seed().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
