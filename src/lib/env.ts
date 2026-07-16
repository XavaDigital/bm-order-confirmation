/**
 * Centralised, validated environment access. Import `env` instead of reading
 * process.env directly so missing config fails fast and loudly.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  TOKEN_PEPPER: z.string().min(1, 'TOKEN_PEPPER is required'),
  INTERNAL_API_KEY: z.string().min(1, 'INTERNAL_API_KEY is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // Set only if using Vercel Cron to trigger /api/internal/process-outbox.
  // Vercel sets this automatically as a project env var and sends it as
  // `Authorization: Bearer $CRON_SECRET` on cron-triggered requests.
  CRON_SECRET: z.string().optional(),

  // Customer magic-link lifetime, in days. Unset → links never expire
  // (today's behavior). Suggested value once enabled: 30.
  LINK_EXPIRY_DAYS: z.coerce.number().optional(),

  // Object storage (AWS S3). Optional at boot — fails gracefully at upload time if absent.
  AWS_S3_BUCKET: z.string().optional(),
  AWS_S3_REGION: z.string().optional(),
  AWS_S3_ACCESS_KEY: z.string().optional(),
  AWS_S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Google Tag Manager container ID (e.g. "GTM-XXXXXXX").
  // NEXT_PUBLIC_ prefix makes it available in client bundles at build time.
  // Leave unset to disable GTM injection (useful in non-prod envs).
  NEXT_PUBLIC_GTM_ID: z.string().optional(),

  // Google Ads — client-side GTM tag parameters.
  GOOGLE_ADS_CONVERSION_ID: z.string().optional(),
  GOOGLE_ADS_CONVERSION_LABEL: z.string().optional(),

  // Google Ads — server-side Enhanced Conversions for Leads (API upload).
  // All six must be set together; leave any unset to disable server-side firing.
  // GOOGLE_ADS_CUSTOMER_ID  — 10-digit account ID, no dashes (from Google Ads UI).
  // GOOGLE_ADS_CONVERSION_ACTION_ID — numeric ID of the "Order Confirmed" action.
  // GOOGLE_ADS_DEVELOPER_TOKEN — from Google Ads API Center (manager account).
  // GOOGLE_ADS_OAUTH_* — OAuth2 credentials from Google Cloud Console.
  GOOGLE_ADS_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_CONVERSION_ACTION_ID: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_OAUTH_REFRESH_TOKEN: z.string().optional(),

  // SMTP (Phase 7 — magic-link email delivery).
  // Leave SMTP_HOST unset to disable email sending (links must be shared manually).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // "true" enables TLS (port 465); omit or "false" for STARTTLS (port 587).
  SMTP_SECURE: z.string().optional().transform((v) => v === 'true'),
  // From address shown to the customer.
  MAIL_FROM: z.string().optional(),
  // Optional CC address for all staff notification emails (change-request + confirmation).
  // Set to a team inbox to ensure the whole team sees these events.
  STAFF_NOTIFICATIONS_CC: z.string().optional(),

  // Error monitoring (src/lib/logger.ts). Leave unset to disable — logger.error()
  // still logs to stdout as usual, it just skips the Sentry delivery.
  SENTRY_DSN: z.string().optional(),
});

// Next.js sets NEXT_PHASE=phase-production-build only during `next build` — not
// during `next dev`, `next start`, or a deployed serverless invocation. Some
// hosts (Docker multi-stage builds, etc.) run the build without runtime
// secrets present, so we can't hard-validate at build time. Every other phase
// is an actual run of the app, where missing config must fail fast and loudly.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  if (isBuildPhase) {
    console.warn(
      '[env] invalid or missing environment variables (ignored during `next build`; this will crash at runtime if still missing):',
      parsed.error.flatten().fieldErrors,
    );
  } else {
    throw new Error(
      `[env] invalid or missing environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
}

export const env = (parsed.success ? parsed.data : (process.env as unknown)) as z.infer<
  typeof schema
>;
