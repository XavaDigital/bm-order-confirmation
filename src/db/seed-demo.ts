/**
 * Demo seed — populates realistic sample orders across all statuses,
 * uploads the two BeastMode size charts (Rain Jackets, T-Shirts) to S3,
 * and links them to garments.
 *
 * Run with:  npx tsx --env-file=.env.local src/db/seed-demo.ts
 * Safe to re-run: cleans up rows whose order_number starts with "OC-DEMO-" first.
 */
import { eq, inArray, like } from 'drizzle-orm';
import { db } from './index';
import {
  orders,
  garments,
  garmentSizing,
  sizeCharts,
  garmentSizeChartLinks,
  orderAccess,
  acknowledgments,
  confirmations,
} from './schema';
import { uploadFile, sizeChartKey } from '@/lib/storage';
import { generateToken, hashToken } from '@/lib/tokens';

// ---------------------------------------------------------------------------
// Minimal 1×1 transparent PNG — valid file that S3 will serve + signed URLs work.
// Replace with actual chart images later via the admin Size Charts page.
// ---------------------------------------------------------------------------
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
    'AAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=',
  'base64',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function uploadChart(filename: string): Promise<string> {
  const key = sizeChartKey(filename);
  await uploadFile(key, PLACEHOLDER_PNG, 'image/png');
  console.log(`  ✓ Uploaded ${key}`);
  return key;
}

// ---------------------------------------------------------------------------
// Clean up previous demo runs
// ---------------------------------------------------------------------------
async function cleanup() {
  const existing = await db
    .select({ id: orders.id })
    .from(orders)
    .where(like(orders.orderNumber, 'OC-DEMO-%'));

  if (existing.length > 0) {
    const ids = existing.map((r) => r.id);
    // cascade deletes handle garments, sizing, images, access, confirmations
    await db.delete(orders).where(inArray(orders.id, ids));
    console.log(`  Cleaned up ${ids.length} previous demo order(s)`);
  }

  // Remove demo size charts
  await db.delete(sizeCharts).where(like(sizeCharts.name, '%(BeastMode Demo)%'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed() {
  console.log('\n🌱 BeastMode demo seed starting…\n');

  // 1. Clean up
  console.log('─ Cleaning previous demo data…');
  await cleanup();

  // 2. Upload size chart files to S3
  console.log('\n─ Uploading size chart files to S3…');
  const rainJacketsKey = await uploadChart('rain-jackets-v2507.png');
  const tShirtsKey = await uploadChart('t-shirts-v2308.png');

  // 3. Insert size chart library records
  console.log('\n─ Creating size chart records…');
  const [rainJacketsChart] = await db
    .insert(sizeCharts)
    .values({
      name: 'Rain Jackets (BeastMode Demo)',
      description: 'Youth/Adult Unisex + Womens. Version 2507.',
      storageKey: rainJacketsKey,
    })
    .returning();

  const [tShirtsChart] = await db
    .insert(sizeCharts)
    .values({
      name: 'T-Shirts (BeastMode Demo)',
      description: 'Youth/Adult Unisex + Womens. Tall sizing available. Version 2308.',
      storageKey: tShirtsKey,
    })
    .returning();

  console.log(`  ✓ Rain Jackets chart id: ${rainJacketsChart.id}`);
  console.log(`  ✓ T-Shirts chart id:     ${tShirtsChart.id}`);

  // =========================================================================
  // ORDER 1 — DRAFT: Waitakere Thunder Rugby Club
  // =========================================================================
  console.log('\n─ [1/5] DRAFT — Waitakere Thunder Rugby Club…');
  const [order1] = await db
    .insert(orders)
    .values({
      orderNumber: 'OC-DEMO-001',
      customerName: 'Marcus Webb',
      customerEmail: 'marcus@wtrugby.co.nz',
      customerContact: '+64 21 456 789',
      clubName: 'Waitakere Thunder Rugby Club',
      orderValueAmount: '4850.00',
      orderValueCurrency: 'NZD',
      expectedShipDate: isoDate(28),
      deadlineDate: isoDate(21),
      generalNotes: 'Club colours are navy and gold. Home kit for senior men\'s squad. Need all sizes confirmed before production start.',
      shippingMode: 'prefilled',
      shippingAddress: {
        line1: '14 Bethells Road',
        city: 'Waitakere',
        region: 'Auckland',
        postcode: '0781',
        country: 'NZ',
      },
      status: 'draft',
    })
    .returning();

  const [g1a] = await db.insert(garments).values({
    orderId: order1.id,
    name: 'Sublimated Rugby Jerseys',
    fabrics: ['Polyester Performance', 'BeastMode Pro Sublimation'],
    notes: 'Navy body, gold collar and sleeve panel. Player name and number on back.',
    sortOrder: 0,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g1a.id, size: 'S', playerName: 'Liam Faleolo', playerNumber: '1', sortOrder: 0 },
    { garmentId: g1a.id, size: 'M', playerName: 'Jordan Taufa', playerNumber: '2', sortOrder: 1 },
    { garmentId: g1a.id, size: 'M', playerName: 'Ben Hohepa', playerNumber: '3', sortOrder: 2 },
    { garmentId: g1a.id, size: 'L', playerName: 'Chris Makisi', playerNumber: '4', sortOrder: 3 },
    { garmentId: g1a.id, size: 'L', playerName: 'Sam Davids', playerNumber: '5', sortOrder: 4 },
    { garmentId: g1a.id, size: 'L', playerName: 'Tevita Vea', playerNumber: '6', sortOrder: 5 },
    { garmentId: g1a.id, size: 'XL', playerName: 'Mike Patterson', playerNumber: '7', sortOrder: 6 },
    { garmentId: g1a.id, size: 'XL', playerName: 'Rikki Tama', playerNumber: '8', sortOrder: 7 },
    { garmentId: g1a.id, size: '2XL', playerName: 'Daniel Ngata', playerNumber: '9', sortOrder: 8 },
    { garmentId: g1a.id, size: '3XL', playerName: 'Apo Finau', playerNumber: '10', sortOrder: 9 },
  ]);

  const [g1b] = await db.insert(garments).values({
    orderId: order1.id,
    name: 'Rugby Shorts',
    fabrics: ['Polyester Stretch', 'Inner Liner'],
    notes: 'Navy with gold side stripe. Club crest on left leg.',
    sortOrder: 1,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g1b.id, size: 'S', playerName: 'Liam Faleolo', playerNumber: '1', sortOrder: 0 },
    { garmentId: g1b.id, size: 'M', playerName: 'Jordan Taufa', playerNumber: '2', sortOrder: 1 },
    { garmentId: g1b.id, size: 'M', playerName: 'Ben Hohepa', playerNumber: '3', sortOrder: 2 },
    { garmentId: g1b.id, size: 'L', playerName: 'Chris Makisi', playerNumber: '4', sortOrder: 3 },
    { garmentId: g1b.id, size: 'L', playerName: 'Sam Davids', playerNumber: '5', sortOrder: 4 },
    { garmentId: g1b.id, size: 'XL', playerName: 'Mike Patterson', playerNumber: '7', sortOrder: 5 },
    { garmentId: g1b.id, size: 'XL', playerName: 'Rikki Tama', playerNumber: '8', sortOrder: 6 },
    { garmentId: g1b.id, size: '2XL', playerName: 'Daniel Ngata', playerNumber: '9', sortOrder: 7 },
    { garmentId: g1b.id, size: '3XL', playerName: 'Apo Finau', playerNumber: '10', sortOrder: 8 },
  ]);

  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g1a.id, sizeChartId: tShirtsChart.id },
    { garmentId: g1b.id, sizeChartId: tShirtsChart.id },
  ]);

  // =========================================================================
  // ORDER 2 — SENT: Auckland Netball Collective
  // =========================================================================
  console.log('─ [2/5] SENT — Auckland Netball Collective…');
  const [order2] = await db
    .insert(orders)
    .values({
      orderNumber: 'OC-DEMO-002',
      customerName: 'Sophie Brennan',
      customerEmail: 'sophie@aklnetball.co.nz',
      customerContact: '+64 27 890 123',
      clubName: 'Auckland Netball Collective',
      orderValueAmount: '2340.00',
      orderValueCurrency: 'NZD',
      expectedShipDate: isoDate(35),
      deadlineDate: isoDate(30),
      generalNotes: 'Sky blue and white. Need to match existing bib colours exactly — reference sample sent via email.',
      shippingMode: 'customer_entered',
      status: 'sent',
    })
    .returning();

  // Magic link token for sent order
  const token2 = generateToken();
  await db.insert(orderAccess).values({
    orderId: order2.id,
    tokenHash: hashToken(token2),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });

  const [g2a] = await db.insert(garments).values({
    orderId: order2.id,
    name: 'Netball Tops',
    fabrics: ['Polyester Performance', 'Lycra Panel'],
    notes: 'Sky blue body with white accents. Club logo on chest.',
    sortOrder: 0,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g2a.id, size: 'XS', playerName: 'Amy Chen', sortOrder: 0 },
    { garmentId: g2a.id, size: 'S', playerName: 'Brooke Harris', sortOrder: 1 },
    { garmentId: g2a.id, size: 'S', playerName: 'Caitlin Moore', sortOrder: 2 },
    { garmentId: g2a.id, size: 'M', playerName: 'Dana Wilson', sortOrder: 3 },
    { garmentId: g2a.id, size: 'M', playerName: 'Ella Nguyen', sortOrder: 4 },
    { garmentId: g2a.id, size: 'M', playerName: 'Fiona Baker', sortOrder: 5 },
    { garmentId: g2a.id, size: 'L', playerName: 'Grace Patel', sortOrder: 6 },
    { garmentId: g2a.id, size: 'XL', playerName: 'Hannah Scott', sortOrder: 7 },
    { garmentId: g2a.id, size: 'XL', playerName: 'Isla Turner', sortOrder: 8 },
  ]);

  const [g2b] = await db.insert(garments).values({
    orderId: order2.id,
    name: 'Netball Skirts',
    fabrics: ['Polyester Stretch', 'Short Undershort Attached'],
    notes: 'White with sky blue waistband. Same sizing as tops.',
    sortOrder: 1,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g2b.id, size: 'XS', playerName: 'Amy Chen', sortOrder: 0 },
    { garmentId: g2b.id, size: 'S', playerName: 'Brooke Harris', sortOrder: 1 },
    { garmentId: g2b.id, size: 'S', playerName: 'Caitlin Moore', sortOrder: 2 },
    { garmentId: g2b.id, size: 'M', playerName: 'Dana Wilson', sortOrder: 3 },
    { garmentId: g2b.id, size: 'M', playerName: 'Ella Nguyen', sortOrder: 4 },
    { garmentId: g2b.id, size: 'M', playerName: 'Fiona Baker', sortOrder: 5 },
    { garmentId: g2b.id, size: 'L', playerName: 'Grace Patel', sortOrder: 6 },
    { garmentId: g2b.id, size: 'XL', playerName: 'Hannah Scott', sortOrder: 7 },
    { garmentId: g2b.id, size: 'XL', playerName: 'Isla Turner', sortOrder: 8 },
  ]);

  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g2a.id, sizeChartId: tShirtsChart.id },
    { garmentId: g2b.id, sizeChartId: tShirtsChart.id },
  ]);

  // =========================================================================
  // ORDER 3 — VIEWED: Howick & Pakuranga AFC
  // =========================================================================
  console.log('─ [3/5] VIEWED — Howick & Pakuranga AFC…');
  const [order3] = await db
    .insert(orders)
    .values({
      orderNumber: 'OC-DEMO-003',
      customerName: 'Daniel Kowalski',
      customerEmail: 'daniel@hpafc.co.nz',
      customerContact: '+64 9 534 2210',
      clubName: 'Howick & Pakuranga AFC',
      orderValueAmount: '6120.00',
      orderValueCurrency: 'NZD',
      invoiceUrl: 'https://invoices.beastmode.co.nz/INV-2025-0312',
      expectedShipDate: isoDate(14),
      deadlineDate: isoDate(10),
      generalNotes: 'Senior men + youth squads combined order. Red and black. Please ensure youth YXS and YS are clearly labelled in packing.',
      shippingMode: 'prefilled',
      shippingAddress: {
        line1: '23 Pakuranga Highway',
        city: 'Pakuranga',
        region: 'Auckland',
        postcode: '2010',
        country: 'NZ',
      },
      status: 'viewed',
    })
    .returning();

  const token3 = generateToken();
  await db.insert(orderAccess).values({
    orderId: order3.id,
    tokenHash: hashToken(token3),
    lastViewedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // viewed 2 hours ago
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  const [g3a] = await db.insert(garments).values({
    orderId: order3.id,
    name: 'Match Jerseys',
    fabrics: ['Polyester Performance', 'Mesh Panel Sides'],
    notes: 'Red body, black shoulders. Number on back, club crest on chest. Name on back for senior players only.',
    sortOrder: 0,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g3a.id, size: 'YXS', playerName: 'Oliver Brown', playerNumber: '11', sortOrder: 0 },
    { garmentId: g3a.id, size: 'YXS', playerName: 'Noah Davis', playerNumber: '12', sortOrder: 1 },
    { garmentId: g3a.id, size: 'YS', playerName: 'Ethan Wilson', playerNumber: '13', sortOrder: 2 },
    { garmentId: g3a.id, size: 'YS', playerName: 'Luca Martinez', playerNumber: '14', sortOrder: 3 },
    { garmentId: g3a.id, size: 'YM', playerName: 'Mason Taylor', playerNumber: '15', sortOrder: 4 },
    { garmentId: g3a.id, size: 'YL', playerName: 'Elijah Anderson', playerNumber: '16', sortOrder: 5 },
    { garmentId: g3a.id, size: 'S', playerName: 'James Thomas', playerNumber: '1', sortOrder: 6 },
    { garmentId: g3a.id, size: 'S', playerName: 'Logan Jackson', playerNumber: '2', sortOrder: 7 },
    { garmentId: g3a.id, size: 'M', playerName: 'Aidan White', playerNumber: '3', sortOrder: 8 },
    { garmentId: g3a.id, size: 'M', playerName: 'Carter Harris', playerNumber: '4', sortOrder: 9 },
    { garmentId: g3a.id, size: 'L', playerName: 'Blake Martin', playerNumber: '5', sortOrder: 10 },
    { garmentId: g3a.id, size: 'XL', playerName: 'Tyler Garcia', playerNumber: '6', sortOrder: 11 },
    { garmentId: g3a.id, size: '2XL', playerName: 'Hunter Lee', playerNumber: '7', sortOrder: 12 },
  ]);

  const [g3b] = await db.insert(garments).values({
    orderId: order3.id,
    name: 'Match Shorts',
    fabrics: ['Polyester Stretch', 'Inner Brief'],
    notes: 'Black with red waistband. Club crest on left leg.',
    sortOrder: 1,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g3b.id, size: 'YXS', sortOrder: 0, notes: 'Youth — no name' },
    { garmentId: g3b.id, size: 'YXS', sortOrder: 1, notes: 'Youth — no name' },
    { garmentId: g3b.id, size: 'YS', sortOrder: 2 },
    { garmentId: g3b.id, size: 'YS', sortOrder: 3 },
    { garmentId: g3b.id, size: 'YM', sortOrder: 4 },
    { garmentId: g3b.id, size: 'YL', sortOrder: 5 },
    { garmentId: g3b.id, size: 'S', sortOrder: 6 },
    { garmentId: g3b.id, size: 'S', sortOrder: 7 },
    { garmentId: g3b.id, size: 'M', sortOrder: 8 },
    { garmentId: g3b.id, size: 'M', sortOrder: 9 },
    { garmentId: g3b.id, size: 'L', sortOrder: 10 },
    { garmentId: g3b.id, size: 'XL', sortOrder: 11 },
    { garmentId: g3b.id, size: '2XL', sortOrder: 12 },
  ]);

  const [g3c] = await db.insert(garments).values({
    orderId: order3.id,
    name: 'Training Tops',
    fabrics: ['Polyester Performance'],
    notes: 'Senior squad only. Same red/black colourway. No player number on training tops.',
    sortOrder: 2,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g3c.id, size: 'S', sortOrder: 0 },
    { garmentId: g3c.id, size: 'S', sortOrder: 1 },
    { garmentId: g3c.id, size: 'M', sortOrder: 2 },
    { garmentId: g3c.id, size: 'M', sortOrder: 3 },
    { garmentId: g3c.id, size: 'M', sortOrder: 4 },
    { garmentId: g3c.id, size: 'L', sortOrder: 5 },
    { garmentId: g3c.id, size: 'XL', sortOrder: 6 },
  ]);

  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g3a.id, sizeChartId: tShirtsChart.id },
    { garmentId: g3b.id, sizeChartId: tShirtsChart.id },
    { garmentId: g3c.id, sizeChartId: tShirtsChart.id },
    { garmentId: g3c.id, sizeChartId: rainJacketsChart.id },
  ]);

  // =========================================================================
  // ORDER 4 — CONFIRMED: Eastern Suburbs Hockey Club
  // =========================================================================
  console.log('─ [4/5] CONFIRMED — Eastern Suburbs Hockey Club…');
  const confirmedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

  const [order4] = await db
    .insert(orders)
    .values({
      orderNumber: 'OC-DEMO-004',
      customerName: 'Rachel Ngu',
      customerEmail: 'rachel@eshockey.co.nz',
      customerContact: '+64 21 334 556',
      clubName: 'Eastern Suburbs Hockey Club',
      orderValueAmount: '3780.00',
      orderValueCurrency: 'NZD',
      expectedShipDate: isoDate(-5), // already shipped
      deadlineDate: isoDate(-8),
      generalNotes: 'Green and gold. Women\'s Premier League squad. Confirmed and approved.',
      shippingMode: 'prefilled',
      shippingAddress: {
        line1: '7 Shore Road',
        city: 'Remuera',
        region: 'Auckland',
        postcode: '1050',
        country: 'NZ',
      },
      status: 'confirmed',
      confirmedAt,
    })
    .returning();

  const token4 = generateToken();
  await db.insert(orderAccess).values({
    orderId: order4.id,
    tokenHash: hashToken(token4),
    lastViewedAt: new Date(confirmedAt.getTime() - 30 * 60 * 1000),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  const [g4a] = await db.insert(garments).values({
    orderId: order4.id,
    name: 'Hockey Jerseys',
    fabrics: ['Polyester Performance', 'BeastMode Pro Sublimation'],
    notes: 'Green body with gold side panels. Player number on back.',
    sortOrder: 0,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g4a.id, size: 'XS', playerName: 'Priya Singh', playerNumber: '1', sortOrder: 0 },
    { garmentId: g4a.id, size: 'S', playerName: 'Jess Wilkinson', playerNumber: '2', sortOrder: 1 },
    { garmentId: g4a.id, size: 'S', playerName: 'Kate McDonald', playerNumber: '3', sortOrder: 2 },
    { garmentId: g4a.id, size: 'M', playerName: 'Nina Patel', playerNumber: '4', sortOrder: 3 },
    { garmentId: g4a.id, size: 'M', playerName: 'Olivia Clarke', playerNumber: '5', sortOrder: 4 },
    { garmentId: g4a.id, size: 'M', playerName: 'Sarah Tan', playerNumber: '6', sortOrder: 5 },
    { garmentId: g4a.id, size: 'L', playerName: 'Mia Johnson', playerNumber: '7', sortOrder: 6 },
    { garmentId: g4a.id, size: 'L', playerName: 'Zoe Williams', playerNumber: '8', sortOrder: 7 },
    { garmentId: g4a.id, size: 'XL', playerName: 'Amy Fraser', playerNumber: '9', sortOrder: 8 },
    { garmentId: g4a.id, size: '2XL', playerName: 'Bella Stone', playerNumber: '10', sortOrder: 9 },
  ]);

  const [g4b] = await db.insert(garments).values({
    orderId: order4.id,
    name: 'Hockey Shorts',
    fabrics: ['Polyester Stretch'],
    notes: 'Gold shorts with green waistband.',
    sortOrder: 1,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g4b.id, size: 'XS', playerName: 'Priya Singh', sortOrder: 0 },
    { garmentId: g4b.id, size: 'S', playerName: 'Jess Wilkinson', sortOrder: 1 },
    { garmentId: g4b.id, size: 'S', playerName: 'Kate McDonald', sortOrder: 2 },
    { garmentId: g4b.id, size: 'M', playerName: 'Nina Patel', sortOrder: 3 },
    { garmentId: g4b.id, size: 'M', playerName: 'Olivia Clarke', sortOrder: 4 },
    { garmentId: g4b.id, size: 'M', playerName: 'Sarah Tan', sortOrder: 5 },
    { garmentId: g4b.id, size: 'L', playerName: 'Mia Johnson', sortOrder: 6 },
    { garmentId: g4b.id, size: 'L', playerName: 'Zoe Williams', sortOrder: 7 },
    { garmentId: g4b.id, size: 'XL', playerName: 'Amy Fraser', sortOrder: 8 },
    { garmentId: g4b.id, size: '2XL', playerName: 'Bella Stone', sortOrder: 9 },
  ]);

  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g4a.id, sizeChartId: tShirtsChart.id },
    { garmentId: g4b.id, sizeChartId: tShirtsChart.id },
  ]);

  // Acknowledgments
  const ACK_KEYS = [
    'mockup_correct', 'sizing_correct', 'fabrics_accepted',
    'delivery_noted', 'no_changes', 'payment_terms', 'authorised',
  ];
  await db.insert(acknowledgments).values(
    ACK_KEYS.map((key) => ({
      orderId: order4.id,
      ackKey: key,
      ackTextVersion: 'v1',
      accepted: true,
      acceptedAt: confirmedAt,
    })),
  );

  // Confirmed snapshot
  await db.insert(confirmations).values({
    orderId: order4.id,
    signatureType: 'drawn',
    confirmedSnapshot: {
      orderNumber: 'OC-DEMO-004',
      customerName: 'Rachel Ngu',
      clubName: 'Eastern Suburbs Hockey Club',
      orderValueAmount: '3780.00',
      orderValueCurrency: 'NZD',
      customer_concerns: '',
      garments: [
        {
          name: 'Hockey Jerseys',
          fabrics: ['Polyester Performance', 'BeastMode Pro Sublimation'],
          sizing: [
            { size: 'XS', playerName: 'Priya Singh', playerNumber: '1' },
            { size: 'S', playerName: 'Jess Wilkinson', playerNumber: '2' },
            { size: 'S', playerName: 'Kate McDonald', playerNumber: '3' },
            { size: 'M', playerName: 'Nina Patel', playerNumber: '4' },
            { size: 'M', playerName: 'Olivia Clarke', playerNumber: '5' },
            { size: 'M', playerName: 'Sarah Tan', playerNumber: '6' },
            { size: 'L', playerName: 'Mia Johnson', playerNumber: '7' },
            { size: 'L', playerName: 'Zoe Williams', playerNumber: '8' },
            { size: 'XL', playerName: 'Amy Fraser', playerNumber: '9' },
            { size: '2XL', playerName: 'Bella Stone', playerNumber: '10' },
          ],
          size_chart_names: ['T-Shirts (BeastMode Demo)'],
        },
        {
          name: 'Hockey Shorts',
          fabrics: ['Polyester Stretch'],
          sizing: [
            { size: 'XS', playerName: 'Priya Singh' },
            { size: 'S', playerName: 'Jess Wilkinson' },
            { size: 'S', playerName: 'Kate McDonald' },
            { size: 'M', playerName: 'Nina Patel' },
            { size: 'M', playerName: 'Olivia Clarke' },
            { size: 'M', playerName: 'Sarah Tan' },
            { size: 'L', playerName: 'Mia Johnson' },
            { size: 'L', playerName: 'Zoe Williams' },
            { size: 'XL', playerName: 'Amy Fraser' },
            { size: '2XL', playerName: 'Bella Stone' },
          ],
          size_chart_names: ['T-Shirts (BeastMode Demo)'],
        },
      ],
      acknowledgments: ACK_KEYS.map((key) => ({ key, text: key, accepted: true })),
    },
    confirmedAt,
    ipAddress: '202.89.4.12',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  });

  // =========================================================================
  // ORDER 5 — CHANGES_REQUESTED: North Shore Athletics Club
  // =========================================================================
  console.log('─ [5/5] CHANGES_REQUESTED — North Shore Athletics Club…');
  const [order5] = await db
    .insert(orders)
    .values({
      orderNumber: 'OC-DEMO-005',
      customerName: 'James Taufa',
      customerEmail: 'james@nsathletics.co.nz',
      customerContact: '+64 9 481 3300',
      clubName: 'North Shore Athletics Club',
      orderValueAmount: '1650.00',
      orderValueCurrency: 'NZD',
      expectedShipDate: isoDate(42),
      deadlineDate: isoDate(38),
      generalNotes: 'Customer has requested changes to the singlet design — left chest logo needs to be repositioned. Awaiting revised mockup from design team.',
      shippingMode: 'later',
      status: 'changes_requested',
    })
    .returning();

  const token5 = generateToken();
  await db.insert(orderAccess).values({
    orderId: order5.id,
    tokenHash: hashToken(token5),
    lastViewedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // viewed yesterday
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  const [g5a] = await db.insert(garments).values({
    orderId: order5.id,
    name: 'Running Singlets',
    fabrics: ['UPF50+ Polyester', 'Racerback Cut'],
    notes: 'Teal with white accents. Logo placement needs sign-off — customer wants it moved 2cm lower.',
    sortOrder: 0,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g5a.id, size: 'XS', playerName: 'Aroha Parata', sortOrder: 0 },
    { garmentId: g5a.id, size: 'XS', playerName: 'Beth Kim', sortOrder: 1 },
    { garmentId: g5a.id, size: 'S', playerName: 'Claudia Rivera', sortOrder: 2 },
    { garmentId: g5a.id, size: 'S', playerName: 'Dani O\'Brien', sortOrder: 3 },
    { garmentId: g5a.id, size: 'S', playerName: 'Evie Nash', sortOrder: 4 },
    { garmentId: g5a.id, size: 'M', playerName: 'Faye Cooper', sortOrder: 5 },
    { garmentId: g5a.id, size: 'M', playerName: 'Gemma Reid', sortOrder: 6 },
    { garmentId: g5a.id, size: 'L', playerName: 'Hana Sato', sortOrder: 7 },
    { garmentId: g5a.id, size: 'L', playerName: 'Ivy Marsh', sortOrder: 8 },
    { garmentId: g5a.id, size: 'XL', playerName: 'Jade Flower', sortOrder: 9 },
  ]);

  const [g5b] = await db.insert(garments).values({
    orderId: order5.id,
    name: 'Running Shorts',
    fabrics: ['Polyester Stretch', '3" Split Side'],
    notes: 'Teal. No changes requested on shorts — approved as-is.',
    sortOrder: 1,
  }).returning();

  await db.insert(garmentSizing).values([
    { garmentId: g5b.id, size: 'XS', sortOrder: 0 },
    { garmentId: g5b.id, size: 'XS', sortOrder: 1 },
    { garmentId: g5b.id, size: 'S', sortOrder: 2 },
    { garmentId: g5b.id, size: 'S', sortOrder: 3 },
    { garmentId: g5b.id, size: 'S', sortOrder: 4 },
    { garmentId: g5b.id, size: 'M', sortOrder: 5 },
    { garmentId: g5b.id, size: 'M', sortOrder: 6 },
    { garmentId: g5b.id, size: 'L', sortOrder: 7 },
    { garmentId: g5b.id, size: 'L', sortOrder: 8 },
    { garmentId: g5b.id, size: 'XL', sortOrder: 9 },
  ]);

  await db.insert(garmentSizeChartLinks).values([
    { garmentId: g5a.id, sizeChartId: tShirtsChart.id },
    { garmentId: g5b.id, sizeChartId: tShirtsChart.id },
    { garmentId: g5a.id, sizeChartId: rainJacketsChart.id },
  ]);

  // =========================================================================
  // Done
  // =========================================================================
  console.log('\n✅ Demo seed complete!\n');
  console.log('  Orders created:');
  console.log('  OC-DEMO-001  DRAFT            Waitakere Thunder Rugby Club');
  console.log('  OC-DEMO-002  SENT             Auckland Netball Collective');
  console.log('  OC-DEMO-003  VIEWED           Howick & Pakuranga AFC');
  console.log('  OC-DEMO-004  CONFIRMED        Eastern Suburbs Hockey Club');
  console.log('  OC-DEMO-005  CHANGES_REQUESTED North Shore Athletics Club');
  console.log('\n  Size charts uploaded to S3:');
  console.log(`  ${rainJacketsKey}`);
  console.log(`  ${tShirtsKey}`);
  console.log('\n  ℹ  Replace placeholder PNGs with the real chart files via Admin → Size Charts.\n');

  process.exit(0);
}

seed().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
