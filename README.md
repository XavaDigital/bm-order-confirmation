# BeastMode Order Confirmation

Customer-facing order confirmation portal + internal sales admin. First module of
the BeastMode sales platform. **Full scope, decisions, and build phases live in
[PROJECT_BRIEF.md](./PROJECT_BRIEF.md) — read that first.**

## Stack

- **Next.js (App Router)** + **TypeScript** — one deployable; API via route handlers.
- **Ant Design (antd)** — theming via `ConfigProvider` (BeastMode tokens in `src/lib/theme.ts`).
- **PostgreSQL** via **Drizzle ORM** — tables namespaced under the `confirmation` schema.
- **Vitest** — unit + integration tests (integration tests run against an in-process
  PGlite Postgres, no real DB needed). See [Tests](#tests).
- Host-agnostic container (`output: 'standalone'`) — targets **AWS App Runner**, runs anywhere.

## Project layout

```
src/
  app/
    layout.tsx              root layout (antd registry + providers + noindex)
    page.tsx                landing (stub)
    robots.ts               disallow all (not discoverable)
    login/page.tsx          staff login (email + password)
    login/2fa/page.tsx      TOTP verification step (when 2FA is enabled on the account)
    accept-invite/page.tsx  invited-user account setup (set password, join)
    o/[token]/page.tsx      customer confirmation page (token-gated, BeastMode dark)
    admin/                  admin portal (iron-session gated, see src/middleware.ts)
      layout.tsx             reads session → AppShell
      dashboard/              order stats + recent activity (recharts)
      orders/                 list, detail (tabs incl. audit log), new-order form
      size-charts/            reference size-chart library CRUD
      users/                  staff user management (admin role only)
      profile/                own-account settings incl. 2FA enrollment
    api/
      orders/route.ts        POST (create) + GET (list)  ← integration seam (BRIEF §15)
      orders/[id]/route.ts   GET one
      o/confirm/route.ts     POST — customer finalizes (acks + shipping + signature)
      o/request-changes/route.ts  POST — customer requests changes instead of confirming
      auth/                  login, logout, me, 2fa/verify, accept-invite
      admin/
        auth/2fa/             setup, confirm, disable, status — TOTP enrollment
        orders/                CRUD, garments, sizing, images, send-link, token, audit, pdf
        size-charts/           CRUD
        users/                 CRUD (invite, role, disable)
      health/route.ts        liveness probe
      internal/
        process-outbox/route.ts  POST — cron endpoint for the outbox processor
  db/
    schema.ts               full schema (BRIEF §6), under the `confirmation` pg schema
    index.ts                drizzle client (+ Transaction type)
    test-helpers.ts         in-process PGlite Postgres for integration tests
  server/
    orders/
      contract.ts            zod ORDER CONTRACT — the documented create-order input
      admin-contract.ts       zod schemas for admin update operations
      service.ts              createOrder / getOrderByToken / list ← ALL order writes go here
      customer-service.ts     confirm / requestChanges — the token-gated customer flow
      notifications.ts        staff email notification on customer confirmation
    users/service.ts          staff user CRUD, invites, role management
    size-charts/service.ts    size-chart library CRUD
    auth/
      service.ts              login, password hashing, session issuance
      totp.ts                 TOTP secret gen/verify (otplib) for staff 2FA
    events/
      outbox.ts               domain_events outbox (order.confirmed etc.)
      processor.ts             outbox processor — handler registry + batch delivery
    conversions/google-ads.ts server-side Enhanced Conversions upload
  lib/
    env.ts                   validated env access — never read process.env directly
    session.ts               SessionData shape + getSession() (iron-session)
    theme.ts                 BeastMode antd tokens (light + dark)
    tokens.ts                magic-link token gen + SHA-256 hashing
    password.ts              bcrypt hashing helpers
    rate-limit.ts            in-memory sliding-window limiter (login, confirm, etc.)
    email.ts                 SMTP/nodemailer — magic links + staff notifications
    storage.ts               S3-compatible upload/signed-URL helpers
    api-auth.ts              internal x-api-key guard + Vercel Cron bearer-token guard
    gtm.ts                   client-side GTM/dataLayer helpers
  components/
    admin/                   AppShell, ThemeToggle, UserMenu, orders/* (form, PDF, sizing…)
    customer/                AcknowledgmentPanel, ConfirmButton, SignaturePad, etc.
    GoogleTagManager.tsx
  middleware.ts              noindex header + session/2FA gating for /admin & /api/admin
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
   Additional staff accounts are created from the admin UI (Users, admin role only) via an
   invite link — the invitee sets their own password at `/accept-invite`. Each staff member
   can optionally enable TOTP-based 2FA from their Profile page.

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
DATABASE_URL=              # postgresql://... pooled connection, used by the app at runtime
DATABASE_DIRECT_URL=       # postgresql://... direct connection, used by drizzle-kit for migrations
APP_BASE_URL=              # Public URL of the app, e.g. https://orders.beastmode.co.nz
TOKEN_PEPPER=              # 32+ random hex bytes — mixed into magic-link token hashes
INTERNAL_API_KEY=          # Shared secret for /api/orders and /api/internal/* endpoints
SESSION_SECRET=            # 32+ random bytes — encrypts the iron-session admin cookie

# ── Cron auth (optional — only needed if using Vercel Cron, see below) ──────
CRON_SECRET=               # Vercel sets this automatically and sends it as a bearer token

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

## Tests

```bash
npm test               # full suite (unit + integration)
npm run test:watch     # watch mode
npm run test:unit      # excludes *.integration.test.ts
npm run test:integration  # only integration tests
npm run coverage       # coverage report
```

Covers: orders service, customer confirmation flow, size charts, users, auth (login + 2FA/TOTP),
tokens, rate limiting, outbox/event processor, and the `/api/orders` + admin order routes.
Integration tests (`*.integration.test.ts`) mock `@/db` to run against an in-process PGlite
Postgres (`src/db/test-helpers.ts`) — no real database or `.env.local` needed. `.env.test`
holds dummy schema-valid env vars only. CI (`.github/workflows/test.yml`) runs
typecheck → lint → test:unit → test:integration on every push/PR. Playwright is installed but
has no spec files yet (reserved for future e2e).

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

Invite additional staff (with `sales` or `admin` role) from the admin Users page once logged in.

### 4. Configure file storage

Create an S3-compatible bucket (Supabase Storage recommended). Set the `AWS_S3_*`
variables. Uploads will fail gracefully if these are absent — configure before going live.

### 5. Configure email

Set `SMTP_*` and `MAIL_FROM`. Without this, confirmation links must be copied and
shared manually. Staff notification emails (order confirmed, changes requested) are
also disabled until SMTP is configured.

### 6. Scheduled jobs — nothing to set up

Recurring work runs **in-process**. There is no external scheduler to configure,
no extra secret, and no separate resource that can silently drift out of sync
with the code that depends on it.

`src/server/scheduler/runtime.ts` is started once per server process from
`src/instrumentation.ts` (`register()`), and currently drives:

| Job | Every | What it does |
|---|---|---|
| `process-outbox` | 1 min | Delivers `domain_events` to their handlers (Google Ads conversion, staff notification emails) and drives the retry/backoff in [IMPROVEMENT_ROADMAP.md](./IMPROVEMENT_ROADMAP.md) 3.1 |
| `purge-rate-limits` | 6 hrs | Deletes expired `rate_limits` windows |

**Why in-process rather than an external scheduler.** The app is a long-lived
container (`Dockerfile`, `output: 'standalone'`), and it already needs a warm
instance for the real-time notification stream — so a ticker costs no additional
infrastructure. It also removes a whole class of failure: the outbox previously
never drained in production because the cron endpoint exported `POST` while
schedulers issue `GET`, a mismatch nothing surfaced. Code that ships with its own
schedule cannot drift from the thing it drives.

Safety properties, so you can run more than one container without thinking about it:

- Every job is **idempotent** and time-based — a missed tick self-heals on the next.
- `processOutbox` claims rows with `FOR UPDATE SKIP LOCKED`, so parallel runs
  never double-deliver. The periodic scans added later take a Postgres advisory lock.
- A job never overlaps itself (a slow run skips the next tick rather than stacking).
- A throwing job logs and keeps its schedule; it never takes the process down.
- First runs are jittered so a rolling deploy doesn't stampede the database.
- Timers are `unref`'d and cleared on `SIGTERM`/`SIGINT`.

The scheduler deliberately does **not** run during `next build`, in the edge
runtime, or under test.

**One caveat:** if the host scales to zero, in-process timers stop. If you deploy
somewhere that does that, either keep a minimum of one warm instance (needed for
real-time notifications anyway) or drive the endpoints externally as below.

<details>
<summary>Driving the jobs externally instead (optional)</summary>

Set `SCHEDULER_DISABLED=1` so the instance doesn't double-run, then call the
endpoints on a schedule. Both accept `GET` or `POST`, and authenticate with
either `Authorization: Bearer $CRON_SECRET` or `x-api-key: $INTERNAL_API_KEY`:

```bash
curl -X POST https://your-app.com/api/internal/process-outbox   -H "x-api-key: your-INTERNAL_API_KEY"
```

The same endpoints are useful for forcing a tick while debugging, whether or not
the in-process scheduler is enabled. [scripts/setup-outbox-cron.sql](./scripts/setup-outbox-cron.sql)
holds a Supabase `pg_cron` variant (superseded, kept because a DB-resident job
outlives a change of compute host).
</details>

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
npm run dev              # start dev server (localhost:3000)
npm run build            # production build
npm run typecheck        # tsc --noEmit
npm run lint              # eslint via next lint
npm run db:generate       # generate SQL migration from schema changes
npm run db:migrate        # apply pending migrations
npm run db:push           # push schema directly (dev only)
npm run db:studio         # Drizzle Studio UI
npm run db:seed           # create/update the first admin user
npm run db:seed-demo      # seed demo orders
npm run db:seed-demo-extra # seed additional demo data
npm test                  # run full test suite
npm run coverage          # test coverage report
```

---

## Conventions

- **Never write order rows outside `src/server/orders/service.ts`** — it's the seam the
  future platform integrates through (BRIEF §15).
- **State changes emit a `domain_events` row in-transaction** — the outbox processor
  delivers them asynchronously to handlers.
- **Migrations are additive** once the DB is shared with the platform (BRIEF §15).
- Treat all customer input as untrusted; keep the customer surface minimal.
- Role is `'sales' | 'admin'`, stored in `staff_users` and baked into the session. The
  middleware only checks that a session exists — role/permission checks must be added
  per route (see `src/server/users/service.ts` for role-gated operations).
