# BeastMode Order Confirmation

Customer-facing order confirmation portal + internal sales admin. First module of
the BeastMode sales platform. **Full scope, decisions, and build phases live in
[PROJECT_BRIEF.md](./PROJECT_BRIEF.md) — read that first.**

## Stack

- **Next.js (App Router)** + **TypeScript** — one deployable; API via route handlers.
- **Ant Design (antd)** — theming via `ConfigProvider` (BeastMode tokens in `src/lib/theme.ts`).
- **PostgreSQL** via **Drizzle ORM** — tables namespaced under the `confirmation` schema.
- Host-agnostic container (`output: 'standalone'`) — targets **AWS App Runner**, runs anywhere.

## Project layout

```
src/
  app/
    layout.tsx            root layout (antd registry + providers + noindex)
    page.tsx              admin landing (stub)
    robots.ts             disallow all (not discoverable)
    o/[token]/page.tsx    customer confirmation page (token-gated, BeastMode dark)
    api/
      orders/route.ts     POST (create) + GET (list)  ← integration seam (BRIEF §15)
      orders/[id]/route.ts GET one
      health/route.ts     liveness probe
      internal/
        process-outbox/route.ts  POST — cron endpoint for the outbox processor
  db/
    schema.ts             full schema (BRIEF §6), under the `confirmation` pg schema
    index.ts              drizzle client (+ Transaction type)
  server/
    orders/contract.ts    zod ORDER CONTRACT — the documented create-order input
    orders/service.ts     createOrder / getOrderByToken / list  ← all order writes go here
    events/outbox.ts      domain_events outbox (order.confirmed etc.)
    events/processor.ts   outbox processor — handler registry + batch delivery
  lib/
    env.ts                validated env access
    theme.ts              BeastMode antd tokens (light + dark)
    tokens.ts             magic-link token gen + SHA-256 hashing
    api-auth.ts           internal x-api-key guard (stub for service-to-service auth)
  middleware.ts           X-Robots-Tag noindex on every response
```

---

## Getting started (local dev)

1. **Install** (Node 20+):
   ```bash
   npm install
   ```

2. **Configure env**: copy `.env.example` → `.env.local` and fill in the required variables
   (see [Environment variables](#environment-variables) below).

3. **Create the schema**:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

4. **Seed an admin user**:
   ```bash
   npm run db:seed
   ```

5. **Run**:
   ```bash
   npm run dev
   ```
   - Admin portal: http://localhost:3000/admin
   - Customer page: http://localhost:3000/o/\<token\>

---

## Environment variables

Add all to `.env.local` locally and to your hosting secrets in production.

```bash
# ── Required ────────────────────────────────────────────────────────────────
DATABASE_URL=              # postgresql://... (Supabase connection string)
APP_BASE_URL=              # Public URL of the app, e.g. https://orders.beastmode.co.nz
TOKEN_PEPPER=              # 32+ random hex bytes — mixed into magic-link token hashes
INTERNAL_API_KEY=          # Shared secret for /api/orders and /api/internal/* endpoints
SESSION_SECRET=            # 32+ random bytes — encrypts the iron-session admin cookie

# ── File storage (Supabase Storage / S3-compatible) ─────────────────────────
AWS_S3_BUCKET=             # e.g. bm-order-assets
AWS_S3_REGION=             # e.g. ap-southeast-2
AWS_S3_ACCESS_KEY=
AWS_S3_SECRET_ACCESS_KEY=

# ── Email (SMTP) ─────────────────────────────────────────────────────────────
# Leave SMTP_HOST unset to disable email (links must be shared manually).
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=true           # true = TLS (port 465); false = STARTTLS (port 587)
MAIL_FROM=                 # e.g. orders@beastmode.co.nz
STAFF_NOTIFICATIONS_CC=    # Optional team inbox CC for all staff notification emails

# ── Google Ads (optional — leave unset to disable) ──────────────────────────
NEXT_PUBLIC_GTM_ID=                  # GTM container ID (client-side, e.g. GTM-XXXXXXX)
GOOGLE_ADS_CONVERSION_ID=            # Client-side conversion ID (GTM tag)
GOOGLE_ADS_CONVERSION_LABEL=         # Client-side conversion label (GTM tag)
GOOGLE_ADS_CUSTOMER_ID=              # 10-digit account ID, no dashes
GOOGLE_ADS_CONVERSION_ACTION_ID=     # Numeric conversion action ID
GOOGLE_ADS_DEVELOPER_TOKEN=          # From Google Ads API Center (manager account)
GOOGLE_ADS_OAUTH_CLIENT_ID=          # OAuth2 client ID (Google Cloud Console)
GOOGLE_ADS_OAUTH_CLIENT_SECRET=      # OAuth2 client secret
GOOGLE_ADS_OAUTH_REFRESH_TOKEN=      # OAuth2 refresh token (offline access scope)

# ── Seeding (never commit values, local only) ────────────────────────────────
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
SEED_ADMIN_NAME=
```

---

## Production setup checklist

### 1. Deploy the app

Build and deploy to your host (Vercel, AWS App Runner, Railway, etc.):

```bash
npm run build
```

Set all required environment variables in your hosting dashboard. At minimum:
`DATABASE_URL`, `APP_BASE_URL`, `TOKEN_PEPPER`, `INTERNAL_API_KEY`, `SESSION_SECRET`.

Health check endpoint: `GET /api/health`

### 2. Run database migrations

```bash
npm run db:migrate
```

### 3. Seed the first admin user

```bash
npm run db:seed
```

### 4. Configure file storage

Create an S3-compatible bucket (Supabase Storage recommended). Set the `AWS_S3_*`
variables. Uploads will fail gracefully if these are absent — configure before going live.

### 5. Configure email

Set `SMTP_*` and `MAIL_FROM`. Without this, confirmation links must be copied and
shared manually. Staff notification emails (order confirmed, changes requested) are
also disabled until SMTP is configured.

### 6. Set up the outbox processor cron job

The outbox processor delivers domain events to their handlers (Google Ads conversion,
staff email notifications). It must be called on a schedule via
`POST /api/internal/process-outbox` with the `x-api-key` header.

**Option A — Supabase pg_cron (recommended if using Supabase)**

Enable the `pg_cron` and `pg_net` extensions in Supabase → Database → Extensions,
then run this once in the SQL Editor (replace the URL and key):

```sql
select cron.schedule(
  'process-outbox',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://your-app.com/api/internal/process-outbox',
    headers := jsonb_build_object('x-api-key', 'your-INTERNAL_API_KEY'),
    body := '{}'::jsonb
  );
  $$
);
```

To check it is running:
```sql
select * from cron.job_run_details order by start_time desc limit 10;
```

To remove it:
```sql
select cron.unschedule('process-outbox');
```

**Option B — Vercel Cron**

Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/internal/process-outbox",
      "schedule": "* * * * *"
    }
  ]
}
```
Vercel injects a valid `Authorization` header automatically — no `x-api-key` needed
for Vercel-originated cron calls (update `isInternalAuthorized` in `src/lib/api-auth.ts`
to also accept Vercel's header if using this option).

**Option C — External cron (Railway, cron-job.org, etc.)**

Make a POST request every minute:
```bash
curl -X POST https://your-app.com/api/internal/process-outbox \
  -H "x-api-key: your-INTERNAL_API_KEY"
```

### 7. Configure Google Ads (optional)

Set the `GOOGLE_ADS_*` environment variables. All six server-side variables must be
present together — leaving any one unset disables server-side conversion firing.

To obtain credentials:
1. Enable the Google Ads API in Google Cloud Console.
2. Create an OAuth2 "Desktop" client → get `client_id` + `client_secret`.
3. Run the OAuth2 consent flow with scope `https://www.googleapis.com/auth/adwords` → get `refresh_token`.
4. Copy `developer_token` from Google Ads → Admin → API Center.
5. Find the conversion action numeric ID in Google Ads → Goals → Conversions → click the action → ID in the URL.

---

## Useful commands

```bash
npm run dev          # start dev server (localhost:3000)
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint via next lint
npm run db:generate  # generate SQL migration from schema changes
npm run db:migrate   # apply pending migrations
npm run db:push      # push schema directly (dev only)
npm run db:studio    # Drizzle Studio UI
npm run db:seed      # create/update the first admin user
npm run db:seed-demo # seed demo orders
```

---

## Conventions

- **Never write order rows outside `src/server/orders/service.ts`** — it's the seam the
  future platform integrates through (BRIEF §15).
- **State changes emit a `domain_events` row in-transaction** — the outbox processor
  delivers them asynchronously to handlers.
- **Migrations are additive** once the DB is shared with the platform (BRIEF §15).
- Treat all customer input as untrusted; keep the customer surface minimal.
