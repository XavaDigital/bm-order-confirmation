import { config } from 'dotenv';
import postgres from 'postgres';

/**
 * Direct database access for e2e FIXTURES only — never for assertions.
 *
 * Some setup cannot be done through the product's own screens without testing
 * something else along the way. The team page needs a garment with a linked
 * size chart carrying sizes, and the only route that creates a size chart
 * requires a file upload, which requires object storage — which CI does not
 * have. Seeding the two rows directly keeps the roster spec about the roster.
 *
 * Loads the same files the app does, in the same order: `.env` first, then
 * `.env.local` on top. Locally that points at the real dev database, which is
 * what the e2e suite already runs against (see playwright.config.ts); in CI it
 * is the throwaway Postgres the workflow writes.
 */
config({ path: '.env', quiet: true });
config({ path: '.env.local', override: true, quiet: true });

export function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — e2e fixtures cannot reach the database');
  return postgres(url, { max: 1, prepare: false });
}

/**
 * Give an order's FIRST garment a customer size chart with pickable sizes, and
 * return the labels.
 *
 * `storage_key` is left null on purpose: the chart has no file, and every
 * signing call in the app already falls back to null rather than throwing, so
 * a chart with sizes and no image renders fine. That is what makes this work
 * without storage configured.
 */
export async function seedSizeChartForOrder(
  orderId: string,
  name: string,
  labels: string[] = ['S', 'M', 'L'],
): Promise<string[]> {
  const sql = connect();
  try {
    const sizes = labels.map((label) => ({ label, tall: false }));
    const [chart] = await sql`
      INSERT INTO confirmation.size_charts ${sql({
        name,
        kind: 'customer',
        sizes: JSON.stringify(sizes),
      })}
      RETURNING id
    `;
    const [garment] = await sql`
      SELECT id FROM confirmation.garments
      WHERE order_id = ${orderId}
      ORDER BY sort_order, created_at
      LIMIT 1
    `;
    if (!garment) throw new Error(`order ${orderId} has no garments to link a size chart to`);
    await sql`
      INSERT INTO confirmation.garment_size_chart_links (garment_id, size_chart_id)
      VALUES (${garment.id}, ${chart.id})
    `;
    return labels;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
