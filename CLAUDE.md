# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server (localhost:3000)
npm run build        # production build
npm run typecheck    # tsc --noEmit (run before committing)
npm run lint         # eslint via next lint

# Database (Drizzle + Supabase Postgres)
npm run db:generate  # generate SQL migration from schema changes
npm run db:migrate   # apply pending migrations
npm run db:push      # push schema directly (dev only, skips migration files)
npm run db:studio    # Drizzle Studio UI
npm run db:seed      # create/update the first admin user (reads SEED_ADMIN_* from .env.local)
npm run db:seed-demo # seed demo orders

# Tests (Vitest)
npm run test          # full suite (unit + integration)
npm run test:watch    # watch mode
npm run test:unit     # excludes *.integration.test.ts
npm run test:integration # only integration tests
```

Vitest suite covers orders service, customer confirmation flow, size charts, users, auth (login + 2FA/TOTP), tokens, rate limiting, outbox/event processor, and the `/api/orders` + admin order routes. Integration tests (`*.integration.test.ts`) mock `@/db` to run against an in-process PGlite Postgres (see `src/db/test-helpers.ts`; the table list is derived from the schema at runtime — new tables are truncated automatically) — no real database or `.env.local` needed, `npm test` runs standalone. `.env.test` holds dummy schema-valid env vars only. CI (`.github/workflows/test.yml`) runs typecheck → lint → test:unit → test:integration on every push/PR. Playwright is installed but has no spec files yet (reserved for future e2e).

Windows dev-box quirks: run jsdom tests serially (`npx vitest run --project jsdom --maxWorkers=1 --no-file-parallelism`); if a whole run collapses with "Vitest failed to find the current suite" (zero tests execute), those are not real failures — the cause is launching vitest from Git Bash, whose lowercase `c:/` cwd splits vitest's module identity. Run vitest from PowerShell (uppercase `C:/`) for reliable runs; a retry (optionally after `rm -rf node_modules/.vite`) usually recovers a Git Bash run. Component tests that fetch on mount should mock `@/lib/api-fetch` (or use `src/test/mockFetch.ts` URL-routing mock), never a `mockResolvedValueOnce` queue — mount fetches consume the queue.

## Architecture

**Single Next.js App Router app.** Backend logic lives in Route Handlers (`app/api/**`), not a separate Express service. All routes are under the `confirmation` Postgres schema.

### Two surfaces

| Surface | Route prefix | Auth |
|---|---|---|
| Admin / Sales portal | `/admin/**`, `/api/admin/**` | iron-session cookie (`bm-session`) |
| Customer confirmation | `/o/[token]`, `/api/o/**`, `/o/roster/[rosterToken]`, `/o/roster/member/[memberToken]`, `/api/o/roster/**` | magic-link token in URL (shared roster link uses `roster_access`; v2 per-member links use `roster_member_access` — same no-session model) |

### Key architectural seams

- **`src/server/orders/service.ts`** — the ONLY place orders are created or mutated. Both the admin UI and the future external platform call this. Never write order rows elsewhere.
- **`src/app/api/orders/route.ts`** — the public integration endpoint (`POST /api/orders`) protected by `x-api-key`. This is the future platform's hook-in point (see PROJECT_BRIEF.md §15).
- **`src/server/events/outbox.ts`** — every order state change must emit a `domain_events` row in the same transaction. Google Ads conversion is a consumer of `order.confirmed`.
- **`src/server/roster/`** — team roster feature (see `TEAM_ROSTER_PLAN.md`), mirroring the `src/server/orders/` split: `service.ts` for staff-authenticated roster management, `customer-service.ts` for the token-gated shared roster link, `contract.ts` for Zod shapes, `import.ts` for CSV/XLSX parsing. Roster members are self-service size submissions against `garment_sizing` (tagged via nullable `roster_member_id`) and never touch the public `POST /api/orders` contract.
- **`src/server/garment-types/`** — admin-managed preset catalog (garment types with fabric options, configurable order options `[{label, type: 'select'|'text', …}]`, size ranges `[{sizeRange, sizes[]}]`, and linked reference size charts). Mirrors Sales Hub's `products` shapes for fleet parity. Types are **deactivate-never-delete**. Garments optionally reference a type (`garments.garment_type_id` + `selected_options` jsonb); on garment create the type's charts auto-link and option defaults apply (see `resolveGarmentTypePreset` in orders/service.ts).
- **`src/server/hub/client.ts`** — outbound client for the Sales Hub (bm-sales) Capability API, modeled on bm-designflow's HubService. Dormant unless `CAPABILITY_API_URL`+`CAPABILITY_API_SECRET` set; best-effort/non-throwing; browser goes through `/api/admin/hub/*` proxies. Orders store `hub_customer_id` (uuid hint, NOT a FK — re-stamp on merge tombstones) + denormalized `hub_customer_name`.
- **`src/app/api/capability/v1/`** — inbound fleet surface (Email Flow / hub relay): `POST /orders` (idempotent on `externalRef`, forces `source: 'platform'`, calls `createOrder()`) and `POST /orders/[id]/notes` (attributed staff-only `order_notes`). Guarded by per-app `INBOUND_CAPABILITY_SECRET` bearer (`checkCapabilityAuth`; unset → 503) + required `X-Acting-User`. Keep the three capability credentials distinct (shared outbound, per-app inbound, legacy `INTERNAL_API_KEY`).

### Auth flow

1. `POST /api/auth/login` calls `loginStaff()` in `src/server/auth/service.ts`, writes `{ userId, email, name, role }` into the encrypted iron-session cookie.
2. `src/middleware.ts` guards `/admin/**` and `/api/admin/**` — checks only that `session.userId` exists (authenticated), **not** the role. Role enforcement must be done per-route or per-layout.
3. `src/lib/session.ts` defines `SessionData` and `getSession()` for use in Route Handlers and Server Components.
4. Role is `'sales' | 'admin'` — stored in DB (`confirmation.staff_users`) and baked into the session. Currently **unenforced** at the middleware level — role checks must be added manually per route.

### Database

- Drizzle ORM. Schema in `src/db/schema.ts`. All tables in the `confirmation` Postgres schema.
- `src/db/index.ts` exports `db` (Drizzle client) and `Transaction` type.
- Magic-link tokens are stored **hashed** (SHA-256 + pepper). Raw token is returned once at creation and never stored. See `src/lib/tokens.ts`.

### Admin UI shell

- `src/components/admin/AppShell.tsx` — client component with the SalesFlow shell convention: fixed top `Header` (brand + theme toggle + user menu) + collapsible `Sider` (w250). Nav items are defined in `buildNavItems()` in that file — add new pages there.
- `src/app/admin/layout.tsx` — server component that reads the session and passes `{ name, email, role }` to `AppShell`.
- Theme (dark/light) is stored in `localStorage` under key `bm-admin-theme`. The app uses the fleet "MailFlow aesthetic" (indigo accent, Inter, MailFlow dark ramp: page `#191919`, panels `#212121`, chrome `#141414`) — tokens in `src/lib/theme.ts` (`BRAND`, `lightTheme`, `darkTheme`), sourced from bm-sales `ThemeContext.tsx` + bm-email `App.tsx`. Both the admin and customer surfaces (and the PDF/emails) use this palette; do not re-hardcode colors in components.

### Environment

All env access goes through `src/lib/env.ts` (Zod-validated). Required at runtime: `DATABASE_URL`, `TOKEN_PEPPER`, `INTERNAL_API_KEY`, `SESSION_SECRET`. Everything else is optional and degrades gracefully. Never read `process.env` directly.

### Storage

File uploads (mock-ups, size charts, signatures) use S3-compatible storage via `src/lib/storage.ts`. Store `storageKey` in the DB, not public URLs. Serve via signed URLs. Supabase Storage works via `AWS_S3_ENDPOINT` (+ `forcePathStyle`); swapping to the fleet's shared AWS S3 later is an env-only change (see `.env.example`). Upload routes return 503 with a clear message when storage is unconfigured (`isStorageConfigured()`).

## Conventions

- **Migrations are additive** — no destructive/renaming migrations once the DB is shared with the future platform. (While the app was still single-app/dev, 0015 dropped the dead legacy `garment_types.fabric_options`/`sizes` columns — treat the rule as strict from launch onward.) Index naming: `<table>_<cols>_idx`; partial one-active-token uniques are `<table>_one_active_uq`. Prefer plain `text` + a `$type<...>()` union in `src/db/schema.ts` for evolving value sets; reserve real pg enums for closed, stable state machines. All jsonb columns carry a `$type` in the schema — never `any`.
- **`src/server/orders/contract.ts`** defines the Zod create-order schema — the documented API contract. `src/server/orders/admin-contract.ts` covers admin update operations and derives its sizing-row schema from the public one. Shared Zod helpers: `selectedValuesSchema` (orders/contract), `uniqueBy` (`src/lib/validation.ts`).
- Customer input is always untrusted. The customer surface (`/o/**`) must never expose other orders or any admin surface.
- `src/lib/api-auth.ts` — `isInternalAuthorized()` for the `x-api-key` service-to-service guard (stub; swap for OAuth later without touching route handlers); `checkCapabilityAuth()` for the inbound fleet bearer; all secret compares go through its constant-time helper.

### Route handlers

Every API route is defined with **`defineRoute`** (`src/lib/route-handler.ts`) — never hand-roll session checks, JSON parsing, or try/catch in a route file. `auth: 'public' | 'staff' | 'admin' | 'capability'`; pass `schema` for JSON bodies (invalid → 400 `{error: 'Invalid request', details}` via `src/lib/api-responses.ts`). Thrown errors whose class name ends in `NotFoundError`/`ConflictError`/`UnavailableError` map to 404/409/503 automatically; other statuses need an explicit in-handler catch. `*UnavailableError` is for misconfigured server dependencies and its message IS surfaced to the client (e.g. `StorageUnavailableError` in `src/lib/storage.ts` turns a rejected AWS key into "check AWS_S3_ACCESS_KEY" instead of an opaque 500) — so keep those messages actionable but free of secrets. Middleware only checks *authentication* for `/admin/**` — role enforcement is per-route (`auth: 'admin'`); in admin UI components the convention is `canMutate = role === 'admin'`. Public routes that guard with an API key must check the key **before** parsing the body (see `/api/orders`).

### Events & audit

Two distinct sinks (do not mix): the **outbox** (`domain_events`, consumer-facing, written in-transaction via `emitOrderEvent` from `src/server/events/outbox.ts` — use `makeEmitter(aggregateType)` for new aggregates) and the **audit trail** (`audit_events`, staff/customer action history with real actor columns, written via `recordAuditEvent`, pass the tx when inside one). The order timeline (`getOrderAuditLog`) merges both. Every admin mutation service takes `meta?: { actorEmail }` and records an audit row — keep audit calls in services, not routes; email-sending flows live in `src/server/notifications/service.ts`.

### Server patterns

- Magic-link token lookup/mint/revoke: `src/server/access/tokens.ts` (`resolveActiveToken`/`mintToken`/`revokeActiveTokens`) — the three access tables share `accessTokenColumns()`.
- Confirmation snapshots (`orders.confirmedSnapshot`) are written **camelCase** (`buildConfirmationSnapshot`); readers must accept legacy snake_case rows via `snap()` (`src/server/orders/mappers.ts`).
- Garment DTO projection: `toGarmentDto` (`src/server/orders/mappers.ts`); signed URL mapping: `src/lib/signed-urls.ts`. Patch-style updates use `pickDefined` (`src/lib/patch.ts`).
- Drizzle caveat: drizzle-kit is scoped by `schemaFilter: ['confirmation']` — objects outside that schema are invisible to `db:generate`; hand-edit generated SQL for data backfills (see 0014).

### Frontend patterns

- Client data calls go through `src/lib/api-fetch.ts` (`getJson`/`postJson`/`patchJson`/`deleteJson`, `postForm` for multipart) — no raw `fetch` in components.
- Order-status presentation (label/Tag color/hex) comes from the `src/lib/status.ts` registry only.
- Customer-surface shared UI lives in `src/components/customer/` (page shell, section headings, size-chart tags/preview, roster size entry) with shared DTO types in `src/types/customer.ts`.
