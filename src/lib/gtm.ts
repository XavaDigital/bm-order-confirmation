/**
 * Google Tag Manager — client-side dataLayer helpers.
 *
 * Usage: call pushOrderConfirmed() after a successful confirmation POST so that
 * GTM fires the configured Google Ads conversion tag with the order value and
 * hashed customer email (Enhanced Conversions for Leads — see PROJECT_BRIEF.md §10).
 *
 * You don't call the Google Ads API here; you push a structured event and GTM
 * is responsible for sending it to Google Ads. Wire the tag in GTM UI:
 *   - Trigger on custom event "order_confirmed"
 *   - Conversion action: your conversion ID + label
 *   - Enhanced Conversions on: map {{DL - email}} → the email field
 */

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

/** Push any payload to the GTM dataLayer, initialising the array if needed. */
export function pushDataLayer(payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(payload);
}

/**
 * Push the order_confirmed conversion event.
 *
 * Fields mapped to Google Ads Enhanced Conversions for Leads:
 *   transaction_id → dedup key (prevents double-counting on refresh)
 *   value / currency → conversion value
 *   email → hashed by GTM/Google on their side for identity matching
 */
export function pushOrderConfirmed(params: {
  transaction_id: string; // order UUID
  value: number;
  currency: string;
  email: string; // plain — GTM hashes it before sending to Google
}): void {
  pushDataLayer({ event: 'order_confirmed', ...params });
}
