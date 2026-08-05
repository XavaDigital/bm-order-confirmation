/**
 * Central place for app-wide branding/copy constants and tunable preferences.
 * Change values here rather than hunting for hardcoded strings across the app.
 */

export const APP_NAME = 'BeastMode';
const APP_DOMAIN = 'beastmode.co.nz';

/** Shown next to the wordmark on auth pages and the default email header. */
export const APP_TAGLINE = 'Order Confirmation';

/**
 * Product name shown to people on the standalone auth pages (login, 2FA,
 * invite, password reset).
 *
 * Deliberately separate from APP_NAME rather than replacing it: APP_NAME
 * composes into APP_PORTAL_NAME, SALES_REP_LABEL, the TOTP issuer and the PDF
 * footer, where the longer product name reads badly — "BeastMode OrderFlow
 * sales representative".
 */
export const APP_DISPLAY_NAME = `${APP_NAME} OrderFlow`;

/** How the staff-facing portal is referred to in invite/notification copy. */
export const APP_PORTAL_NAME = `${APP_NAME} Order Portal`;

/** Used wherever customer-facing copy points them back to a human contact. */
export const SALES_REP_LABEL = `${APP_NAME} sales representative`;

/** Falls back to this when MAIL_FROM isn't set in env. */
export const EMAIL_FROM_DEFAULT = `${APP_NAME} Orders <orders@${APP_DOMAIN}>`;

/** TOTP/2FA authenticator-app issuer name (shown in Google Authenticator etc). */
export const TOTP_ISSUER = `${APP_NAME} Portal`;

/** Footer line on the exported order PDF. */
export const PDF_FOOTER_TEXT = `${APP_NAME} — ${APP_DOMAIN}`;

/**
 * The sender block on printed address labels (David, 2026-08-05 — replaces
 * the Word-document label). Also the fleet's shared label spec:
 * FLEET_COORDINATION/2026-08-05-address-label-spec.md. Change the address
 * here, not in the component.
 */
export const RETURN_ADDRESS = {
  name: `${APP_NAME} Sports`,
  lines: ['11/8 Dakota Cres', 'Wigram, Christchurch 8042', 'New Zealand'],
  phone: '022 1929 746',
  website: APP_DOMAIN,
} as const;

/** Label stock size in millimetres (David: "roughly 174 by 100"). */
export const ADDRESS_LABEL_MM = { width: 174, height: 100 } as const;

/**
 * "Needs Follow-up" dashboard widget (FEATURE_PROPOSALS.md #1) — days an
 * order can sit in each status before it's surfaced as stale. 'sent' (never
 * opened) gets a shorter fuse than 'viewed' (opened but went quiet).
 */
export const STALE_THRESHOLD_DAYS: Record<'sent' | 'viewed', number> = {
  sent: 3,
  viewed: 5,
};
