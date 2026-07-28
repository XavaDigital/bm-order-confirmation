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

Vitest suite covers orders service, customer confirmation flow, size charts, users, auth (login + 2FA/TOTP), tokens, rate limiting, outbox/event processor, and the `/api/orders` + admin order routes. Integration tests (`*.integration.test.ts`) mock `@/db` to run against an in-process PGlite Postgres (see `src/db/test-helpers.ts`; the table list is derived from the schema at runtime — new tables are truncated automatically). **Rows a MIGRATION seeds are snapshotted right after migrating and restored by every `resetTestDb`** — without that, `TRUNCATE` would delete seeded reference data (the `workflow_stages` from 0020), so the first test in a file would pass and every later one fail against empty config tables; restoring also undoes any mutation a test makes to that config — no real database or `.env.local` needed, `npm test` runs standalone. `.env.test` holds dummy schema-valid env vars only. CI (`.github/workflows/test.yml`) runs typecheck → lint → test:unit → test:integration on every push/PR. Playwright is installed but has no spec files yet (reserved for future e2e).

**`npm run build` is part of the verification loop, not an optional extra.** `npm run typecheck` does not typecheck `.next/types`, where Next generates a validator per route, and a dev server never compiles the edge instrumentation bundle — so two whole classes of breakage are invisible to typecheck + lint + vitest. Both have bitten already: a route handler whose context param is optional fails the generated validator (`Type 'undefined' is not assignable to type 'RouteContext'`, hence the deliberate overload order in `src/lib/route-handler.ts`), and an unconditional `await import()` in `src/instrumentation.ts` pulled nodemailer into the edge bundle where `crypto`/`fs` do not resolve (hence the `NEXT_RUNTIME === 'nodejs'` check *ahead of* the import). Also never pipe the build through `tail`/`grep` when you care about success — the pipeline reports the filter's exit code, not the build's.

Windows dev-box quirks: run jsdom tests serially (`npx vitest run --project jsdom --maxWorkers=1 --no-file-parallelism`); the **node** suite also has tests heavy enough to exceed the 15s timeout under parallel CPU load (PGlite migration replay, bcrypt, rate-limit windows, PDF render) — a full parallel run on a busy box reports a handful of `Test timed out` failures whose *set changes between runs*. A changing failure set that is all timeouts is contention; confirm with `--maxWorkers=1 --no-file-parallelism` on the named files before treating any of it as a regression, and never run the suite alongside a build. Note a timed-out test can also leave a `mockRejectedValueOnce` unconsumed, so a neighbouring test in the same file fails with a real-looking assertion — check whether an earlier test in that file timed out first. Separately, if a whole run collapses with "Vitest failed to find the current suite" (zero tests execute), those are not real failures — the cause is launching vitest from Git Bash, whose lowercase `c:/` cwd splits vitest's module identity. Run vitest from PowerShell (uppercase `C:/`) for reliable runs; a retry (optionally after `rm -rf node_modules/.vite`) usually recovers a Git Bash run. Component tests that fetch on mount should mock `@/lib/api-fetch` (or use `src/test/mockFetch.ts` URL-routing mock), never a `mockResolvedValueOnce` queue — mount fetches consume the queue.

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
- **`src/server/workflow/`** — a configurable STAGE layer over the fixed status enums, which remain the state machine. `workflow_stages` rows each declare the `statusKey` they sit under, so staff can add pre-production steps (artwork, digitising) without inventing statuses every outbox consumer would have to learn. `stages.ts` holds the pure resolution rules (`resolveStage` honours a recorded slug only if it is still valid *for the row's current status*, else falls back to the first active stage in that status group — which is why the entity columns needed no backfill); `board.ts` the column/card reads; `moves.ts` the writes. `PROTECTED_STAGE_SLUGS` (one per status) may be renamed but never deactivated, or the fallback has nothing to resolve to.
- **A stage move that crosses a status boundary writes stage AND status in ONE transaction** (`moves.ts` → `updatePurchaseOrderStatusTx` / the order update). Two transactions would let a mid-way failure leave the board and the status permanently disagreeing. Legality is two layers: the stage layer (exists, active, right board) plus the *existing* status guards — `canTransitionOrder` (`src/server/orders/status-machine.ts`) and `canTransition` (purchase-orders/contract). `isStaffMovable` is deliberately stricter than the lifecycle: `confirmed` and `viewed` are the customer's acts and can never be reached by dragging a card.
- **Statuses can change WITHOUT the board** (a customer confirms, a PO is sent), and those paths deliberately keep their own guards rather than being rewritten to stamp the stage. The row then carries a slug belonging to its previous status, so `resolveStage` re-homes the card and `clockForStage` (`board.ts`) reports the age as **unknown** rather than trusting a timestamp about a stage the card has left — an inflated age would make freshly-advanced work look stuck, which is how people learn to ignore the colours. The card gets a real clock again the next time it is moved. Do NOT "fix" this by having the PO service call into `src/server/workflow/` — `moves.ts` already imports the PO service, so that is a module cycle, and doing it via `await import()` inside a transaction hangs PGlite's single connection.
- **Tasks, owners and gates** — `task-rules.ts` is pure (any/all satisfaction, `canLeaveStage`, `nextStageInGroup`); `tasks.ts` does the DB work. Confirming runs in ONE transaction with the entity row locked, and advancing only ever moves WITHIN a status group — finishing a checklist must never trigger a status transition implicitly. A repeat confirmation by the same person is a no-op (checked *before* the stage guard, since confirming the last task advances the job and the second click would otherwise be told the task belongs to another stage). An `all` task with no active owners falls back to one-is-enough, because unsatisfiable-forever is a worse failure than lenient. `assignments` is polymorphic — a stage owner is a row with `entityType: 'workflow_stage'`.
- **A gate is not a table**: it is "every ACTIVE task carrying this key is satisfied", evaluated across ALL stages of the board (not just the current one, or a job could be dragged past a stage to escape its checks). `GATE_CATALOG` (`src/server/workflow/gates.ts`) is code because each key has a hard-wired call site — `po_send` is enforced in `sendPurchaseOrder` after the supplier-email check and before the PDF render. `WorkflowGateConflictError` extends the app's `ConflictError`, not plain `Error`: the PO send route rethrows `instanceof ConflictError`, so extending Error would silently downgrade a blocked send to a 500. Overrides are admin-only and require a reason, audited as `workflow.gate_overridden`.
- **Never query the global `db` inside a transaction** — PGlite has ONE connection, so an outer-connection query while a tx is open deadlocks and the suite *hangs* rather than failing. Service helpers that may be called from inside a tx take an optional executor (see `getStageOwnerIdsForMany`). For the same reason, two overlapping `FOR UPDATE` transactions cannot be tested with `Promise.all` against PGlite.
- **`src/server/notifications/`** — `catalog.ts` holds the code-defined defaults; DB config is OVERRIDE-ONLY (a missing settings row or rule set means "use the default"), so the feature ships working rather than silently notifying nobody. `dispatch.ts` resolves recipients from rules (`stage_owners`, `order_owner`, `entity_assignees`, `role`, `specific_users`, `po_creator`), drops the actor, and CLAIMS each (event, person, channel) in `notification_deliveries` before writing anything — the outbox re-runs every handler on retry, so without the claim one flaky send would re-notify on every backoff attempt. Trade-off is at-most-once.
- **Outbox handlers run INSIDE the processor's batch transaction** and are passed the `tx`; any handler touching the DB must use it (`EventHandler = (event, tx) => …`). `workflow.stage_entered` is therefore an OUTBOX event, not an audit row — `stage_exited` stays audit-only since nothing notifies on it, and `getOrderAuditLog` merges both sinks so the timeline still shows each once.
- **Real-time (SSE over Postgres LISTEN/NOTIFY) is designed but NOT built.** The inbox polls on an interval and on window focus. Adding it needs a dedicated long-lived pg client (LISTEN is connection-scoped and must not borrow from the request pool) and ≥1 always-on instance.
- **`src/server/roster/`** — team roster feature (see `TEAM_ROSTER_PLAN.md`), mirroring the `src/server/orders/` split: `service.ts` for staff-authenticated roster management, `customer-service.ts` for the token-gated shared roster link, `contract.ts` for Zod shapes, `import.ts` for CSV/XLSX parsing. Roster members are self-service size submissions against `garment_sizing` (tagged via nullable `roster_member_id`) and never touch the public `POST /api/orders` contract.
- **`src/server/garment-types/`** — admin-managed preset catalog (garment types with fabric options, configurable order options `[{label, type: 'select'|'text', …}]`, size ranges `[{sizeRange, sizes[]}]`, and linked reference size charts). Mirrors Sales Hub's `products` shapes for fleet parity. Types are **deactivate-never-delete**. Garments optionally reference a type (`garments.garment_type_id` + `selected_options` jsonb); on garment create the type's charts auto-link and option defaults apply (see `resolveGarmentTypePreset` in orders/service.ts).
- **`src/server/hub/client.ts`** — outbound client for the Sales Hub (bm-sales) Capability API, modeled on bm-designflow's HubService. Dormant unless `CAPABILITY_API_URL`+`CAPABILITY_API_SECRET` set; best-effort/non-throwing; browser goes through `/api/admin/hub/*` proxies. Orders store `hub_customer_id` (uuid hint, NOT a FK — re-stamp on merge tombstones) + denormalized `hub_customer_name`.
- **`src/app/api/capability/v1/`** — inbound fleet surface (Email Flow / hub relay): `POST /orders` (idempotent on `externalRef`, forces `source: 'platform'`, calls `createOrder()`) and `POST /orders/[id]/notes` (attributed staff-only `order_notes`). Guarded by per-app `INBOUND_CAPABILITY_SECRET` bearer (`checkCapabilityAuth`; unset → 503) + required `X-Acting-User`. Keep the three capability credentials distinct (shared outbound, per-app inbound, legacy `INTERNAL_API_KEY`).
- **`src/server/workflow/scans.ts`** runs hourly from the in-process scheduler: stuck stages and due reminders. It deliberately does NOT hold a transaction or an advisory lock — the plan called for `pg_try_advisory_xact_lock`, but that means holding a transaction open across the notification sends, which the notification design forbids and which deadlocks PGlite. The claim ledger already makes concurrent scans safe (at-most-once), so a second scanner wastes read work and notifies nobody twice. Stuck notifications use a DAY-bucketed dedupe key, which is what stops an hourly scan nagging hourly.
- Snoozes are **per user** (`workflow_reminders`, partial unique on live rows so re-snoozing extends in place): on a shared board a global snooze would let one person silence a job for the whole team. A reminder goes to whoever set it via `forceRecipientIds`, bypassing rule config entirely.
- **`src/server/identity/client.ts`** — dormant outbound client for bm-identity (fleet Google SSO + per-app grants), modelled on the hub client. Its four endpoints are the whole surface: `google-login`, `users/:id`, `users/by-email`, `POST /users`. There is deliberately NO list-users, so absorption is JIT-at-login plus a per-request role re-check, never a roster sync. This app is registered in the identity `apps` registry as **`bm-orders`** (`IDENTITY_APP_ID`) — that is the key every grant is filed under, permanently. `staff_users.identityUserId` is nullable+unique with **no FK** (different database; identity rows are disabled, never deleted). Reads are ASYMMETRIC on purpose: transport error / 5xx → `null` so the caller serves the cached role (an identity outage must not log everyone out), definitive 404 → `'gone'` so it fails closed. An unrecognised role returns null rather than defaulting — never demote on a value we do not understand. `loginWithIdentity` (`src/server/auth/service.ts`) is the single bridge point: by `identityUserId` first (survives an email change), then by a VERIFIED email (stamping the link), then create. Local `isActive` still wins — this app must be able to close its own door without waiting on another service — and an SSO-created row gets an unusable password hash so it can never be used through the password form. Password login stays as break-glass. Until `IDENTITY_API_URL` + `IDENTITY_API_SECRET` are set the seam makes no network call at all and the Google button does not render.

### Access control (fleet contract — read this before touching auth)

**No role means no access.** Not reduced access, not a default, not a read-only fallback. This app implements the fleet-wide access contract (2026-07-29): bm-identity is the ONLY source of truth for whether someone may use the app and in what role.

- Roles live in `src/lib/roles.ts` — the single place their ordering is defined: `none < viewer < sales < admin`. `none` is the fail-closed answer for an absent/foreign/unrecognised identity role; it is never assigned deliberately (`ASSIGNABLE_ROLES` excludes it). `roleFromIdentity()` is the one function that maps an identity role string in, and everything else calls `canRead`/`canWrite`/`isAdmin` rather than comparing role strings.
- **`defineRoute` auth levels**: `'viewer'` = read-only endpoints (viewer/sales/admin); `'staff'` = **every mutation** (sales/admin — deliberately EXCLUDES viewer, so a route nobody has explicitly marked readable fails closed); `'admin'` = admin only. Adding a GET? Mark it `'viewer'` or viewers cannot see it.
- **Every request re-checks the grant** via `checkAccess` (`src/server/auth/access.ts`), cached ≤60s, from both `defineRoute` and the admin layout. A revoked or LOWERED grant takes effect on a live session — there is deliberately no "never demote" rule. Identity answering no-access/disabled/gone destroys the session; identity being *unreachable* serves the last known good role (stale-while-error), because an outage must not log out the company.
- **No non-identity way in.** Password login and `npm run db:seed` both refuse when `IDENTITY_API_URL` + `IDENTITY_API_SECRET` are set; they work only where identity is switched off (local dev, standalone). Do not add an env-var admin, an email allowlist, or a first-user-becomes-admin path.
- A test session that sets `userId` without `role` now resolves to `none` and gets 403 — fixtures must set both.
- Registered role vocabulary must match the identity `apps` registry exactly (`['viewer','sales','admin']`). **Changing this app's roles requires telling the identity owner in the same change**, or grants 400.

### Auth flow

1. `POST /api/auth/login` calls `loginStaff()` in `src/server/auth/service.ts`, writes `{ userId, email, name, role }` into the encrypted iron-session cookie.
2. `src/middleware.ts` guards `/admin/**` and `/api/admin/**` — checks only that `session.userId` exists (authenticated), **not** the role. Role enforcement must be done per-route or per-layout.
3. `src/lib/session.ts` defines `SessionData` and `getSession()` for use in Route Handlers and Server Components.
4. Role is a `StaffRole` (`src/lib/roles.ts`), stored on `confirmation.staff_users` and cached in the session — but the session copy is NOT authoritative: `defineRoute` and the admin layout overwrite it from `checkAccess` on every request. Middleware still only checks *authentication*; role enforcement is per-route.

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

Every API route is defined with **`defineRoute`** (`src/lib/route-handler.ts`) — never hand-roll session checks, JSON parsing, or try/catch in a route file. `auth: 'public' | 'staff' | 'admin' | 'capability'`; pass `schema` for JSON bodies (invalid → 400 `{error: 'Invalid request', details}` via `src/lib/api-responses.ts`). Thrown errors whose class name ends in `NotFoundError`/`ConflictError`/`UnavailableError` map to 404/409/503 automatically (a `*ConflictError` may carry a `details` property, which is passed through on the 409 so the UI can list what blocked the action); other statuses need an explicit in-handler catch. `*UnavailableError` is for misconfigured server dependencies and its message IS surfaced to the client (e.g. `StorageUnavailableError` in `src/lib/storage.ts` turns a rejected AWS key into "check AWS_S3_ACCESS_KEY" instead of an opaque 500) — so keep those messages actionable but free of secrets. Middleware only checks *authentication* for `/admin/**` — role enforcement is per-route (`auth: 'admin'`); in admin UI components the convention is `canMutate = role === 'admin'`. Public routes that guard with an API key must check the key **before** parsing the body (see `/api/orders`).

### Events & audit

Two distinct sinks (do not mix): the **outbox** (`domain_events`, consumer-facing, written in-transaction via `emitOrderEvent` from `src/server/events/outbox.ts` — use `makeEmitter(aggregateType)` for new aggregates) and the **audit trail** (`audit_events`, staff/customer action history with real actor columns, written via `recordAuditEvent`, pass the tx when inside one). The order timeline (`getOrderAuditLog`) merges both. Every admin mutation service takes `meta?: { actorEmail }` and records an audit row — keep audit calls in services, not routes; email-sending flows live in `src/server/notifications/service.ts`.

### Server patterns

- Magic-link token lookup/mint/revoke: `src/server/access/tokens.ts` (`resolveActiveToken`/`mintToken`/`revokeActiveTokens`) — the three access tables share `accessTokenColumns()`.
- Confirmation snapshots (`orders.confirmedSnapshot`) are written **camelCase** (`buildConfirmationSnapshot`); readers must accept legacy snake_case rows via `snap()` (`src/server/orders/mappers.ts`).
- Garment DTO projection: `toGarmentDto` (`src/server/orders/mappers.ts`); signed URL mapping: `src/lib/signed-urls.ts`. Patch-style updates use `pickDefined` (`src/lib/patch.ts`).
- Drizzle caveat: drizzle-kit is scoped by `schemaFilter: ['confirmation']` — objects outside that schema are invisible to `db:generate`; hand-edit generated SQL for data backfills (see 0014, 0019).
- Order child rows (assets, notes) live in their own service beside `orders/service.ts` (`assets-service.ts`, `notes-service.ts`), sharing ownership checks from `src/server/orders/guards.ts` (`assertOrderExists`, `assertGarmentBelongsToOrder`). Mutations take the **orderId as well as** the child id and 404 on a mismatch, so a child id from another order is not reachable through this order's URL.
- **Rich-text note bodies are sanitised in the SERVICE, not the route** (`src/lib/rich-text.ts`, `isomorphic-dompurify`). `sanitizeNoteHtml` is the single allowlist and runs server-side on write *and* client-side on render — rows can predate it or come from another writer (the capability surface). `order_notes.body` stays plain text (`htmlToPlainText`) for emails/previews/search; `bodyHtml` holds the rich version. Check emptiness with `isNoteEmpty`, never `String.trim()` — an emptied contenteditable posts `<p><br></p>`.

### Frontend patterns

- Client data calls go through `src/lib/api-fetch.ts` (`getJson`/`postJson`/`patchJson`/`deleteJson`, `postForm` for multipart) — no raw `fetch` in components.
- Order-status presentation (label/Tag color/hex) comes from the `src/lib/status.ts` registry only.
- Customer-surface shared UI lives in `src/components/customer/` (page shell, section headings, size-chart tags/preview, roster size entry) with shared DTO types in `src/types/customer.ts`.
- The Kanban board (`src/components/admin/workflow/WorkflowBoard.tsx`) uses **dnd-kit** — already a dependency; do not add a second DnD library. Low-level `useDraggable`/`useDroppable` rather than `SortableContext`, since there is no intra-column order to persist. `PointerSensor` needs its 8px activation distance so clicking a card still opens it, and `KeyboardSensor` is there because a drag-only board is unusable without a pointer. jsdom has no layout, so a drag gesture cannot be simulated — test the exported pure `applyOptimisticMove` instead of faking one.
- Rich text uses `src/components/admin/RichTextEditor.tsx` — `contentEditable` + `document.execCommand`, ported from bm-designflow's `RichNoteEditor` for fleet parity (deliberately not TipTap/ProseMirror). Both command APIs are feature-detected because jsdom implements neither. `NotesThread.tsx` is the note chat, reused for the order thread and the per-garment thread (pass `garmentId`).
