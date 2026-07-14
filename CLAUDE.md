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

Vitest suite covers orders service, customer confirmation flow, size charts, users, auth (login + 2FA/TOTP), tokens, rate limiting, outbox/event processor, and the `/api/orders` + admin order routes. Integration tests (`*.integration.test.ts`) mock `@/db` to run against an in-process PGlite Postgres (see `src/db/test-helpers.ts`) — no real database or `.env.local` needed, `npm test` runs standalone. `.env.test` holds dummy schema-valid env vars only. CI (`.github/workflows/test.yml`) runs typecheck → lint → test:unit → test:integration on every push/PR. Playwright is installed but has no spec files yet (reserved for future e2e).

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

- `src/components/admin/AppShell.tsx` — client component wrapping the antd `Layout` + collapsible `Sider`. Sidebar nav items are defined in the `NAV_ITEMS` array in that file — add new pages there.
- `src/app/admin/layout.tsx` — server component that reads the session and passes `{ name, email, role }` to `AppShell`.
- Theme (dark/light) is stored in `localStorage` under key `bm-admin-theme`. BeastMode antd tokens are in `src/lib/theme.ts`.

### Environment

All env access goes through `src/lib/env.ts` (Zod-validated). Required at runtime: `DATABASE_URL`, `TOKEN_PEPPER`, `INTERNAL_API_KEY`, `SESSION_SECRET`. Everything else is optional and degrades gracefully. Never read `process.env` directly.

### Storage

File uploads (mock-ups, size charts, signatures) use AWS S3-compatible storage via `src/lib/storage.ts`. Store `storageKey` in the DB, not public URLs. Serve via signed URLs.

## Conventions

- **Migrations are additive** — no destructive/renaming migrations; the DB will be shared with a future platform.
- **`src/server/orders/contract.ts`** defines the Zod create-order schema — the documented API contract. `src/server/orders/admin-contract.ts` covers admin update operations.
- Customer input is always untrusted. The customer surface (`/o/**`) must never expose other orders or any admin surface.
- `src/lib/api-auth.ts` — `isInternalAuthorized()` for the `x-api-key` service-to-service guard (stub; swap for OAuth later without touching route handlers).
