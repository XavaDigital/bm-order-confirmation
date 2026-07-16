/**
 * Server-side Google Ads Enhanced Conversions for Leads.
 *
 * Uses the Google Ads API uploadClickConversions endpoint to send a hashed
 * customer email + order value when a customer confirms. This is immune to
 * ad-blockers and is the authoritative record; the GTM client-side push
 * (gtm.ts) is kept as a redundant fallback.
 *
 * Required env vars (all six must be present to enable):
 *   GOOGLE_ADS_CUSTOMER_ID           — 10-digit account ID, no dashes
 *   GOOGLE_ADS_CONVERSION_ACTION_ID  — numeric conversion action ID
 *   GOOGLE_ADS_DEVELOPER_TOKEN       — from Google Ads API Center
 *   GOOGLE_ADS_OAUTH_CLIENT_ID       — OAuth2 client ID (Google Cloud Console)
 *   GOOGLE_ADS_OAUTH_CLIENT_SECRET   — OAuth2 client secret
 *   GOOGLE_ADS_OAUTH_REFRESH_TOKEN   — OAuth2 refresh token (offline access)
 *
 * How to obtain credentials:
 *   1. Enable the Google Ads API in Google Cloud Console.
 *   2. Create an OAuth2 "Desktop" client → download client_id + secret.
 *   3. Run the OAuth2 consent flow once (e.g. google-ads-api CLI or Postman)
 *      with scope https://www.googleapis.com/auth/adwords → get refresh_token.
 *   4. Copy developer_token from Google Ads → Admin → API Center.
 *   5. Find the conversion action numeric ID in Google Ads → Goals →
 *      Conversions → click the action → ID in the URL (?resourceName=...).
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversionEvents, orders } from '@/db/schema';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const GOOGLE_ADS_API_VERSION = 'v18';

// ---------------------------------------------------------------------------
// Public guard
// ---------------------------------------------------------------------------

export function isGoogleAdsApiConfigured(): boolean {
  return Boolean(
    env.GOOGLE_ADS_CUSTOMER_ID &&
    env.GOOGLE_ADS_CONVERSION_ACTION_ID &&
    env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    env.GOOGLE_ADS_OAUTH_CLIENT_ID &&
    env.GOOGLE_ADS_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN,
  );
}

// ---------------------------------------------------------------------------
// Main entry point — call fire-and-forget after a successful confirmation
// ---------------------------------------------------------------------------

export async function fireGoogleAdsConversion(orderId: string): Promise<void> {
  if (!isGoogleAdsApiConfigured()) return;

  // Load the pending conversion event for this order.
  const [convEvent] = await db
    .select()
    .from(conversionEvents)
    .where(eq(conversionEvents.orderId, orderId))
    .limit(1);

  if (!convEvent) {
    logger.warn('[google-ads] no conversion_events row for order', orderId);
    return;
  }

  // Idempotency: never re-fire a conversion that already succeeded.
  if (convEvent.status === 'sent') return;

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return;

  const customerId = env.GOOGLE_ADS_CUSTOMER_ID!;
  const convActionId = env.GOOGLE_ADS_CONVERSION_ACTION_ID!;

  const payload = {
    conversions: [
      {
        conversionAction: `customers/${customerId}/conversionActions/${convActionId}`,
        conversionDateTime: toGoogleAdsDateTime(convEvent.firedAt ?? new Date()),
        conversionValue: convEvent.valueAmount ? parseFloat(convEvent.valueAmount) : undefined,
        currencyCode: convEvent.valueCurrency ?? 'NZD',
        // orderId is Google's deduplication key — identical uploads won't be double-counted.
        orderId,
        userIdentifiers: [{ hashedEmail: hashEmail(order.customerEmail) }],
        conversionEnvironment: 'WEB',
      },
    ],
    partialFailure: true,
  };

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken();
  } catch (err) {
    await persistResult(convEvent.id, 'failed', { error: String(err), stage: 'oauth' });
    throw err;
  }

  const apiUrl = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/conversionUploads:uploadClickConversions`;

  let res: Response;
  let responseBody: unknown;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    responseBody = await res.json();
  } catch (err) {
    await persistResult(convEvent.id, 'failed', { error: String(err), stage: 'api_fetch' });
    throw err;
  }

  if (!res.ok) {
    await persistResult(convEvent.id, 'failed', responseBody);
    throw new Error(`[google-ads] API ${res.status}: ${JSON.stringify(responseBody)}`);
  }

  // partialFailure:true means HTTP 200 can still contain per-item errors.
  const body = responseBody as Record<string, unknown>;
  if (body.partialFailureError) {
    await persistResult(convEvent.id, 'failed', responseBody);
    throw new Error(`[google-ads] partial failure: ${JSON.stringify(body.partialFailureError)}`);
  }

  await persistResult(convEvent.id, 'sent', responseBody);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function refreshAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_OAUTH_CLIENT_ID!,
      client_secret: env.GOOGLE_ADS_OAUTH_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function hashEmail(email: string): string {
  // Google requires: lowercase, trimmed, then SHA-256 hex.
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

function toGoogleAdsDateTime(date: Date): string {
  // Google Ads expects "yyyy-MM-dd HH:mm:ss+HH:mm" (timezone-aware).
  // We always store times in UTC, so offset is +00:00.
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+00:00`
  );
}

async function persistResult(
  eventId: string,
  status: 'sent' | 'failed',
  providerResponse: unknown,
): Promise<void> {
  await db
    .update(conversionEvents)
    .set({ status, providerResponse })
    .where(eq(conversionEvents.id, eventId));
}
