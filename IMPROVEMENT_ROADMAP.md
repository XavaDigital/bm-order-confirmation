# Improvement Roadmap

> **Date:** 2026-07-15 (re-verify line references if picking this up much later)
> **Method:** PROJECT_BRIEF.md §3/§7/§11/§13/§15 checked item-by-item against the actual
> code (not just plan-doc checkmarks). TEAM_ROSTER_PLAN.md, FEATURE_PROPOSALS.md,
> TESTING_CHECKLIST.md, and CODE_REVIEW_FINDINGS.md cross-referenced.
> **Verdict:** The app is essentially feature-complete. All 11 build phases and the
> entire 9-phase Team Roster plan are shipped (109 test files / 898 tests passing at
> last full run). What remains is a short list of genuine gaps, hardening items, and
> optional feature candidates — organized below as phased checklists.
>
> **How to use this doc:** work a phase top-to-bottom, tick `[x]` as each item lands,
> and note any deviation from the suggested approach inline (same convention as
> TEAM_ROSTER_PLAN.md). Phases 1–4 are ordered by the intended work sequence
> (close out original scope first, then hardening, reliability, e2e); phases 5–7 are
> decision-gated or opportunistic.

---

## 0. Verified complete (reference — do not re-audit)

Confirmation that the big-ticket spec items exist in code, so future readers don't
re-derive this.

| Item | Where |
|---|---|
| Magic links: hashed tokens, expiry, revoke/regenerate | `src/lib/tokens.ts`, `order_access` table |
| Optional per-order access code (default off) | `src/lib/access-code.ts`, `/api/o/verify-code` |
| All 7 acknowledgments, individually versioned + stored | `acknowledgments` table, `ACK_TEXT_VERSION` in `src/server/orders/customer-service.ts:168` |
| Signature draw/upload, confirmed snapshot, IP/UA capture | `confirmations` table + `/api/o/confirm` |
| Changes-requested flow | `requestOrderChanges()`, `POST /api/o/request-changes` |
| Google Ads Enhanced Conversions — server-side + GTM client-side | `src/server/conversions/google-ads.ts`, `src/components/GoogleTagManager.tsx`, `src/lib/gtm.ts` |
| Outbox / domain events (webhook consumer still missing — see 6.1) | `src/server/events/outbox.ts` + `processor.ts` |
| Platform integration seam: `POST /api/orders` behind `x-api-key` | `src/app/api/orders/route.ts`, `src/lib/api-auth.ts` |
| All order writes through one service | `src/server/orders/service.ts` |
| Staff auth, 2FA/TOTP + backup codes, iron-session, invite onboarding | `src/server/auth/service.ts`, `/api/admin/auth/2fa/**`, `acceptInvite()` in `src/server/users/service.ts:119` |
| Audit log (staff actions + customer events) | `recordAuditEvent()` / `getOrderAuditLog()`, Audit Log tab |
| PDF export of confirmed order (staff-side) | `src/components/admin/orders/OrderPdf.tsx`, `GET /api/admin/orders/[id]/pdf` |
| noindex everywhere, Dockerfile, `output: 'standalone'` (host-agnostic) | `next.config.mjs:10,17-26`, `Dockerfile`, `app/robots.ts`, middleware header |
| Rate limiting on confirm/login/token lookups (in-memory — see 3.3) | `src/lib/rate-limit.ts` |
| Health check endpoint | `src/app/api/health/route.ts` |
| Orders list: pagination, search (incl. email), sortable columns, CSV export | `/api/admin/orders` (`limit`/`offset`/`sortBy`) |
| Team Roster v1 + v2 per-member links (all 9 phases) | `src/server/roster/**`, `/o/roster/**` |
| Currencies: any 3-letter code, default `NZD` | `src/server/orders/contract.ts:46` |
| Email: magic link, staff notify, customer receipt, roster links/reminders | `src/lib/email.ts` |

---

## Phase 1 — Close out original scope

The only unshipped spec items that are pure code (no business decision needed).

- [x] **1.1 "Request color book / sample" customer action** *(completed 2026-07-15)*
  - PROJECT_BRIEF §5 ack #2 and §11 checklist name this action/flag; it was never
    built. The `color_matching` acknowledgment checkbox exists, but a customer cannot
    actually *request* a sample. Only mention of "color book" in `src/` is demo seed
    data.
  - Steps:
    - [x] Additive migration: `color_sample_requested_at timestamptz` (nullable) on
      `orders` — a timestamp beats a boolean (audit-friendly, matches house style).
      (`drizzle/0008_tranquil_barracuda.sql`.)
    - [x] Customer page: optional checkbox adjacent to the acknowledgments panel —
      *"I'm concerned about exact colour matching and would like to request a colour
      book / physical sample before production begins."* Flag flows through the
      confirm payload (`src/app/api/o/confirm/route.ts` schema,
      `customer-service.ts` `confirmOrder()`) and into `confirmed_snapshot` as
      `color_sample_requested`.
    - [x] Emits `order.color_sample_requested` domain event (separate from
      `order.confirmed` so it's independently subscribable/auditable), plus
      `order.confirmed`'s payload also carries `colorSampleRequested`. Audit Log
      icon/label/color entries added.
    - [x] Staff notification: **deviation from the plan** — rather than a new
      outbox-registered email handler, the flag is threaded through the *existing*
      `notifyStaffOfConfirmation()` → `sendStaffConfirmationEmail()` call (one email,
      not two) with a highlighted "⚠ HOLD PRODUCTION" block and an amended subject
      line when set. Simpler than a second handler for what's actually one event.
    - [x] Admin `OrderDetailView`: orange "hold production" `Alert` with a
      `BgColorsOutlined` icon when `colorSampleRequestedAt` is set.
    - [x] Tests added: 2 service-integration (`customer-service.integration.test.ts`),
      2 route-integration (`route.integration.test.ts`), 2 email
      (`email.test.ts`), 1 notifications-integration
      (`notifications.integration.test.ts`), 2 OrderDetailView, 2 CustomerOrderView,
      1 AuditLogTab. Full suite: 113 files / 952 tests passing, typecheck + lint
      clean (only pre-existing warnings).
  - Effort: ~0.5 day (as estimated).

- [ ] **1.2 Staff forgot-password flow**
  - There is **no self-service password reset** — only invite-based onboarding
    (`acceptInvite()` in `src/server/users/service.ts:119`). A staff member who
    forgets their password is stuck until an admin intervenes, and there's no defined
    admin "reset" action either.
  - All the plumbing already exists: hashed one-time tokens (`src/lib/tokens.ts`
    pattern), SMTP sender (`src/lib/email.ts`), and the accept-invite page is
    literally a set-password-via-token flow.
  - Steps:
    - [ ] `POST /api/auth/forgot-password` — always 200 (don't reveal account
      existence), rate-limited by IP + email key; creates a short-lived (1h)
      single-use token; emails a reset link.
    - [ ] Reset page reusing the accept-invite set-password UI; invalidate all other
      outstanding reset tokens on success.
    - [ ] Decide: does a password reset clear 2FA? (Recommend **no** — 2FA survives;
      admins can disable 2FA via the existing password-gated disable route.)
    - [ ] Domain/audit event `staff.password_reset` (requested + completed).
    - [ ] Tests: happy path, expired token, reused token, unknown email (still 200),
      rate limit 429.
  - Effort: ~1 day.

---

## Phase 2 — Quick hardening wins (~1 day total) ✅ completed 2026-07-16

Small, independent, no product decisions needed.

- [x] **2.1 Stop tracking `coverage/` output in git** *(verified 2026-07-16 — already done)*
  - `coverage/` was already in `.gitignore` and nothing under it is tracked by git
    (`git ls-files | grep coverage` returns only the unrelated `TEST_COVERAGE_PLAN.md`).
    No action needed.

- [x] **2.2 Admin-role check on size-chart mutation routes** *(completed 2026-07-16)*
  - `requireAdmin()` added to `POST` in `src/app/api/admin/size-charts/route.ts` and to
    `PATCH`/`DELETE` in `src/app/api/admin/size-charts/[id]/route.ts`; `GET` stays open
    to any authenticated staff.
  - `SizeChartsView` now takes a `role` prop (passed from `page.tsx` via `getSession()`)
    and hides the "Upload chart" button plus the edit/delete row actions for `sales` —
    the "View" action stays visible (sales keep read access).
  - Integration tests added: sales → 403 on POST/PATCH/DELETE, admin → 200/201; unit
    test added for the hidden buttons. Existing size-chart integration tests updated to
    mock `@/lib/session` (same Proxy-based pattern as `users/route.integration.test.ts`)
    since the routes are no longer session-agnostic.

- [x] **2.3 Roster size cap** *(completed 2026-07-16)*
  - `MAX_ROSTER_MEMBERS = 100` + `RosterFullError` added to `src/server/roster/service.ts`,
    enforced in `addRosterMember()` and `importRosterMembers()` (import checks
    `existing.length + accepted.length` against the cap so a bulk import can't blow past
    it even when nothing is ambiguous). `customer-service.ts`'s `addSelf()` imports the
    same constant and throws a `roster_full` string error (matching that module's
    existing `invalid_token`/`roster_locked` convention) enforced at the same count-query
    call site as the sort-order lookup, no extra query.
  - Routes: admin `members` route and `import/commit` route catch `RosterFullError` → 409;
    customer `POST /api/o/roster/[rosterToken]/members` catches `roster_full` → 409 with
    `code: 'roster_full'`, mirroring the existing `roster_locked` handling.
  - Tests added at service, customer-service, and route level (bulk-insert to the cap,
    then assert the next add/import is rejected and nothing further was written).

- [x] **2.4 Origin-header CSRF check for admin mutations** *(completed 2026-07-16)*
  - `src/middleware.ts`: for non-`GET`/`HEAD`/`OPTIONS` requests to `/api/admin/**`,
    reject with 403 when `Origin` is present and its host doesn't match the request
    `Host` header. Runs before the session/auth check, so a cross-origin mutation gets
    403 even when unauthenticated (verified live: cross-origin POST → 403, same-origin
    POST → falls through to the normal 401, GET is untouched regardless of Origin).
  - Middleware tests added: same-origin POST ok, cross-origin POST 403, no-Origin POST ok
    (non-browser clients), GET untouched, cross-origin checked before auth.

- [x] **2.5 Security response headers** *(completed 2026-07-16)*
  - Added to `next.config.mjs`'s `headers()` block: `X-Frame-Options: DENY`,
    `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
    and `Strict-Transport-Security` (prod-only, guarded by `process.env.NODE_ENV` —
    read directly rather than via `src/lib/env.ts` since this file runs at Next
    config-load time). CSP deferred as the roadmap allowed (antd inline styles).
  - Verified `rel="noopener noreferrer"` is already present on every external
    `target="_blank"` link (`invoiceUrl` in the customer view, the size-chart-library
    link in `SizeChartLinker.tsx`) — no changes needed there.
  - Smoke-tested: `npm run build` succeeds, and a real `npm run start` + curl confirmed
    all four headers are present on a live response alongside the existing
    `X-Robots-Tag`.

- [x] **2.6 Dependency vulnerability gate in CI** *(completed 2026-07-16 — deviation)*
  - `npm audit --omit=dev --audit-level=high` currently reports one existing high-severity
    finding (drizzle-orm <0.45.2, SQL-identifier-escaping advisory
    GHSA-gpj5-g38j-94v9) whose fix is a breaking 0.38→0.45 upgrade, out of scope for this
    phase. **Deviation from the plan** (user-confirmed): added the step with
    `continue-on-error: true` and a comment explaining why, instead of blocking, so CI
    doesn't go red on unrelated pushes. Flip `continue-on-error` off once the drizzle-orm
    upgrade lands separately — tracked as a new follow-up, not in this doc's original
    scope.
  - `.github/dependabot.yml` added for `npm` + `github-actions` ecosystems, weekly.

---

## Phase 3 — Reliability & operability

The outbox retry is the highest-value fix in this whole document.

- [x] **3.1 Outbox retry / redrive for failed events** ⚠ highest value *(completed 2026-07-16)*
  - Problem: `markFailed()` set `status='failed'` and nothing ever picked failed
    events up again. A transient failure (Google Ads blip, SMTP timeout) permanently
    lost that conversion or notification. No attempt counter, no backoff, no admin
    redrive.
  - Steps:
    - [x] Additive migration (`drizzle/0010_lean_thunderbolts.sql`): `attempts int
      not null default 0`, `next_attempt_at timestamptz` on `domain_events`, plus
      `'dead'` added to the `event_status` enum.
    - [x] `processOutbox()` (`src/server/events/processor.ts`) now selects
      `status='pending' OR (status='failed' AND attempts < 5 AND (next_attempt_at IS
      NULL OR next_attempt_at <= now()))`; on failure increments `attempts` and sets
      `next_attempt_at` via exponential backoff (1m → 5m → 30m → 2h → 12h). The
      per-row optimistic-lock guard now checks against whichever status the row had
      *when selected* (`pending` or `failed`), not just `pending`.
    - [x] At `attempts >= 5` the event is marked `'dead'` instead of rescheduled.
    - [x] Per-handler idempotency documented in `processor.ts`'s header comment: a
      retry re-runs *every* handler for the event, not just the one that failed (no
      per-handler status) — Google Ads already guards on
      `conversion_events.status='sent'`; email handlers currently have no such guard,
      so a retry after a partial failure can resend an email that already went out.
      **Deviation from the plan**: left as documented behavior rather than adding
      per-handler status tracking, which is out of scope for this pass.
    - [x] Admin dashboard: admin-only "Failed Events" stat tile + list widget
      (`DashboardView.tsx`) sourced from `listFailedEvents()`/`countFailedEvents()`,
      with a per-event "Retry now" button calling `POST
      /api/admin/events/[id]/retry` (`requireAdmin()`-gated → `redriveEvent()`,
      resets to `pending` with `attempts=0`).
    - [x] Tests: `processor.integration.test.ts` (fresh failure → backoff window →
      not re-selected early → retried once due → re-runs all handlers → dead-letters
      at the 5th failure → stops being selected), `redriveEvent`/`listFailedEvents`/
      `countFailedEvents` coverage, plus route-level 401/403/404/200 tests for
      `/api/admin/events/[id]/retry` and dashboard widget tests (admin-only
      visibility, retry success/error).

- [x] **3.2 Schedule the outbox processor (ops prerequisite)** *(completed 2026-07-16 — decision + script only, not run)*
  - Decision: **Supabase pg_cron + pg_net**, documented as *the* mechanism (not one
    option among several) in README §6 — host-agnostic per PROJECT_BRIEF §2 (the app
    host is tentative; the Supabase DB is the fixed part of the stack). Vercel
    Cron/external cron kept in the README as documented fallbacks only.
  - [x] Runbook script added: `scripts/setup-outbox-cron.sql` (idempotent
    `cron.schedule()` call + verify/remove commands), parameterized on
    `APP_BASE_URL` / `INTERNAL_API_KEY`.
  - [x] README §6 rewritten to state the decision plainly and link the script.
  - [ ] **Not done in this pass**: actually running the script against the
    production Supabase project — that's a live, hard-to-reverse change against
    shared infrastructure this session has no standing to execute unattended.
    Whoever holds production Supabase credentials needs to run
    `scripts/setup-outbox-cron.sql` once (steps are inline in the file).
  - Effort: < 1 hour once hosting is settled. Blocks the value of 3.1 — do together.

- [x] **3.3 Postgres-backed rate limiting (pre-scale-out)** *(completed 2026-07-16)*
  - `src/lib/rate-limit.ts` was a per-process sliding window; N horizontally-scaled
    instances meant N× the intended limit, and every deploy reset all windows.
  - Fix: additive `rate_limits` table (`key text primary key, window_start
    timestamptz, count int`) with a single atomic `INSERT ... ON CONFLICT DO UPDATE`
    upsert (`checkRateLimitAsync()` in `rate-limit.ts`) — the `CASE` resets the
    window when expired, otherwise increments the existing count in one round trip.
    The original in-memory `checkRateLimit()` is kept as the automatic fallback when
    the DB call throws (wrapped in try/catch), which is also what plain unit tests
    exercise since `.env.test`'s `DATABASE_URL` points nowhere. All 12
    `rateLimitedResponse()` call sites updated to `await` it (now async).
  - Tests: `rate-limit.integration.test.ts` (Postgres-backed path against PGlite —
    boundary, independent keys, window reset/no-reset), `rate-limit.test.ts` (DB
    unreachable → in-memory fallback, verified via a `console.error` spy).
  - Timing note preserved: still fine with a single instance today; this just makes
    horizontal scaling safe whenever that happens.

- [x] **3.4 Structured logging + error monitoring** *(completed 2026-07-16)*
  - `src/lib/logger.ts`: `logger.info/warn/error(message, ...args)` — pretty console
    output in dev (same shape as the old `console.error('[ctx]', err)` calls, so
    existing `stringContaining`-style test assertions kept working unmodified), a
    single-line JSON object per entry in prod (parseable by any log aggregator
    tailing stdout, no vendor lock-in). Every in-scope `console.error`/`console.warn`
    call site swapped: all `src/app/api/**` route handlers, `src/server/**`,
    `src/lib/rate-limit.ts`, and the server component `src/app/o/[token]/page.tsx`.
    **Deviation from the plan** — left untouched, intentionally: `src/lib/env.ts`'s
    own bootstrap-time warning (can't depend on itself), `src/db/seed*.ts` CLI
    scripts (human-facing terminal output, not a production error path), and
    `src/app/o/[token]/view.tsx`'s two `console.error` calls (a `'use client'`
    component — `logger.ts` imports the Zod-validated `env`, which would crash on
    import in the browser bundle; browser-side error reporting is a separate,
    unscoped feature).
  - `SENTRY_DSN` (optional, `src/lib/env.ts`) — absent = no-op. When set,
    `logger.error()` fire-and-forgets a hand-rolled Sentry envelope POST via `fetch`
    (no SDK dependency, matching the raw-fetch style already used for the Google Ads
    API in `src/server/conversions/google-ads.ts`), 5s timeout, never throws even if
    delivery fails.
    **Deviation from the plan**: "Optional Sentry (or similar)" was read literally —
    installing `@sentry/nextjs` would have pulled in source-map upload tooling and an
    auth-token requirement well past "keep light"; the envelope API is stable and
    documented, so a ~40-line fetch-based reporter gets the same outcome (errors land
    in Sentry when configured) without the SDK footprint.
  - `src/instrumentation.ts`: `register()` logs a structured startup line;
    `onRequestError` (Next 15's instrumentation hook) forwards errors that never
    reach a route's own try/catch (e.g. a render-time throw) to `logger.error()` as a
    backstop — routes should still catch and log their own errors directly.
  - Alert-worthy signal #1: `processor.ts`'s `markFailedOrDead()` now reports whether
    an event went `'dead'`; `processOutbox()` calls `logger.error()` with
    `{ eventId, eventType, aggregateId, attempts }` on that transition, so a
    dead-lettered event reaches Sentry (when configured), not just the 3.1 dashboard
    tile.
  - Tests: `src/lib/logger.test.ts` (dev pretty-print, prod JSON shape, Error
    serialization, Sentry envelope POST built/skipped correctly, malformed-DSN
    no-op, delivery failure never throws/rejects). `page.test.tsx` updated to mock
    `@/lib/logger` instead of spying on `console.error` (the exact-string assertion
    there would otherwise break on the new `[time] LEVEL message` prefix). Full
    suite: 122 files / 1081 tests passing, typecheck + lint clean.

- [x] **3.5 Explicit session TTL** *(completed 2026-07-16)*
  - `sessionOptions` (`src/lib/session.ts`) now sets `ttl: 60 * 60 * 24 * 7` (7 days,
    as suggested) — an explicit decision instead of relying on iron-session's 14-day
    default. This also fixes the cookie's `max-age` (`ttl - 60s`, computed
    automatically by iron-session) and the seal's own expiry check on unseal.
  - Test added in `src/lib/session.test.ts`: seals a session at a fake system time,
    confirms it's still valid comfortably inside the ttl window, then advances past
    `ttl + 60s` (iron-session's clock-skew allowance) and confirms `getSession()`
    comes back empty (`userId` undefined) rather than throwing — matches
    `getIronSession()`'s actual behavior of swallowing an "Expired seal" error into
    an empty session.

- [x] **3.6 (Optional) Per-account login backoff** *(completed 2026-07-16)*
  - `src/app/api/auth/login/route.ts`: added a second `rateLimitedResponse()` check
    keyed by normalized email (`login-account:${email.toLowerCase()}`, 5 attempts /
    15 min), on top of the existing per-IP check (`login:${ip}`, 10 attempts / 15
    min) — stricter window, as suggested, so a distributed guesser rotating IPs
    against one account still gets capped. No schema change (reuses the existing
    Postgres-backed `rate_limits` table from 3.3).
    **Deviation from the plan**: used the `login-account:` prefix instead of the
    literal `login:${email}` suggested in the roadmap, so the email-keyed and
    IP-keyed rate limit rows can never collide in the `rate_limits` table.
  - Tests (`route.integration.test.ts`): the pre-existing per-IP test was reworked
    to use distinct unknown emails per attempt so it isolates the IP limit alone
    (the new stricter account limit would otherwise trip first); two new tests
    cover the account limit itself (5 attempts from 5 different IPs → 429 on the
    6th) and that two different accounts' limits don't cross-contaminate.
  - Full suite: 122 files / 1083 tests passing, typecheck + lint clean.

---

## Phase 4 — End-to-end test suite

- [ ] **4.1 Playwright golden-path specs**
  - Playwright is installed with zero spec files. `TESTING_CHECKLIST.md:74-77` already
    names the four flows; ad-hoc Playwright scripts were proven against a real dev
    server during the roster work — this formalizes them.
  - Specs:
    - [ ] Admin creates order → sends link → customer opens `/o/[token]` → ticks acks
      → signs → confirms → admin sees Confirmed + audit trail.
    - [ ] Customer request-changes → staff notified → admin edits → customer
      re-confirms.
    - [ ] Staff login → 2FA setup → logout → login with TOTP → backup-code fallback.
    - [ ] Role gate: sales user cannot reach admin-only pages/actions (Users nav,
      size-chart mutations once 2.2 lands).
  - Infra:
    - [ ] Decide the DB fixture: dedicated throwaway Postgres schema per run (simplest
      given Supabase) vs. dockerized Postgres in CI.
    - [ ] `e2e/` directory + `playwright.config.ts` (webServer block booting
      `npm run dev` or a prod build).
    - [ ] Separate CI job (slower than vitest; don't serialize behind unit tests).
  - Effort: 1–2 days.

---

## Phase 5 — Decision-gated items (need product/business input first)

Each item's first checkbox is the *decision*; code follows.

- [ ] **5.1 Roster: manager-triggered CSV/XLSX import** (TEAM_ROSTER_PLAN open Q #1)
  - [ ] Decide: may the team manager import a roster file themselves, or staff-only?
  - If yes: extend `import/preview` + `import/commit` to the customer surface, gated
    by the **order** confirmation token (manager-only), not the roster token. Parsing
    + validation (`src/server/roster/import.ts`) is fully reusable. Effort: medium.

- [ ] **5.2 Roster: open self-add toggle** (open Q #2)
  - [ ] Decide: can unknown team members add themselves via the shared link
    (current behavior), or manager-curated-only? Per-order toggle?
  - If toggle: nullable `orders.roster_self_add_enabled boolean` (or roster-level
    setting), enforced in `customer-service.ts` member-add path + hidden UI. Small.

- [ ] **5.3 Roster: access-code gate on the shared roster link** (open Q #4)
  - [ ] Decide whether the internal team-distribution link needs the optional
    access-code gate that order links support. Recommendation: **no** — document the
    decision in TEAM_ROSTER_PLAN.md and close the question. (Reuse
    `src/lib/access-code.ts` if yes. Small.)

- [ ] **5.4 Data retention / privacy policy** (PROJECT_BRIEF §13.6 — still open)
  - Nothing is ever purged: expired/revoked token rows, S3 signatures, stale drafts
    accumulate forever.
  - [ ] Propose + get sign-off on defaults, e.g.: token rows 90 days after
    expiry/revocation; signatures + confirmed snapshots kept 7 years
    (contract-dispute horizon); draft orders untouched 12 months → archive/delete.
  - [ ] Then build the purge job: internal API route + the 3.2 scheduler, same pattern
    as `process-outbox`. Log a `retention.purged` audit event with counts. Small once
    the policy exists.

- [ ] **5.5 Final acknowledgment wording sign-off** (§13.2 — business/legal task)
  - [ ] Business/legal review of the 7 ack texts.
  - [ ] On change: update copy and bump `ACK_TEXT_VERSION` to `'v2'`
    (`src/server/orders/customer-service.ts:168`) — never edit a version customers
    already agreed to.

- [ ] **5.6 Google Ads account setup** (§13.1 — ops, blocks conversions firing)
  - [ ] Create "Order Confirmed" conversion action; enable Enhanced Conversions for
    Leads.
  - [ ] Populate the six `GOOGLE_ADS_*` env vars (server-side) and
    `NEXT_PUBLIC_GTM_ID` + GTM tag config (client-side). Steps detailed in README /
    project memory.

- [ ] **5.7 Upload virus scanning** (§7 marked it optional)
  - [ ] Decide if needed (staff-only uploads today = low risk; roster CSV/XLSX is
    customer-adjacent but parsed, not re-served; mock-ups are staff uploads re-served
    to customers via signed URLs).
  - If yes: ClamAV sidecar or a scanning API on the upload path in
    `src/lib/uploads.ts`. Recommendation: defer — revisit if customers ever upload
    re-servable files.

---

## Phase 6 — Platform integration prep (PROJECT_BRIEF §15)

No platform exists yet to consume these — build when integration becomes concrete,
in this order.

- [ ] **6.1 Outbound webhook consumer for domain events** (§15.4's unfinished half)
  - The outbox is done; there is no way for an external system to subscribe short of
    polling the DB. `processor.ts`'s own doc comment says "future webhook".
  - Steps:
    - [ ] Env: `WEBHOOK_URL` (optional) + `WEBHOOK_SECRET`; absent = no-op, like every
      optional integration in `src/lib/env.ts`.
    - [ ] `handleWebhookDelivery(event)` registered in the `EVENT_HANDLERS` map
      (`processor.ts:68`) for `order.confirmed` (+ `order.changes_requested`,
      `order.viewed` as the platform wants them): POST payload with
      `X-BM-Signature: HMAC-SHA256(body, secret)` header, 5s timeout.
    - [ ] Do **after** 3.1 — deliveries then get retry/backoff semantics for free.
    - [ ] Document the payload shape + signature verification for the consumer.
  - Effort: ~0.5 day after 3.1.

- [ ] **6.2 Document the order API contract** (§15.7 "shared types / API-first")
  - `src/server/orders/contract.ts` (Zod) *is* the contract, but nothing consumable by
    another team exists.
  - [ ] Generate OpenAPI from the Zod schemas (e.g. `zod-openapi`) or hand-write
    `API.md` covering `POST /api/orders` (auth header, request/response shapes, error
    codes, idempotency via `external_ref`), the webhook payloads (6.1), and the domain
    event catalogue.
  - Effort: ~0.5 day. Cheap to do earlier if the platform team wants to start reading.

- [ ] **6.3 Staff SSO seam** (§15.6 "auth designed to federate")
  - No action now. When the platform brings SSO: `loginStaff()` in
    `src/server/auth/service.ts` is the single seam to swap — password logic is not
    scattered. Keep it that way; this checkbox is a tripwire for future reviewers.

---

## Phase 7 — Feature candidates (opportunistic, rough value order)

- [ ] **7.1 Reporting / analytics widgets**
  - Confirmation rate, average sent→confirmed time, conversion value by month,
    changes-requested rate.
  - Cheap because: `recharts` is already a dependency, the dashboard already has a
    widget grid, and `domain_events` has precise timestamps for every transition
    (`link.emailed`, `order.viewed`, `order.confirmed`) — simple aggregates, no schema
    change. Effort: 1–2 days for a first slice.

- [ ] **7.2 Customer-facing PDF of the confirmed order**
  - The staff PDF route exists (`GET /api/admin/orders/[id]/pdf`); customers get a
    receipt email but no document. Add a token-gated
    `GET /api/o/[token]/pdf` reusing `OrderPdf.tsx` (only when status=confirmed) and
    link it from the confirmation success panel + receipt email. Effort: ~0.5 day.
    Guard: rate-limit it (PDF rendering is comparatively expensive).

- [ ] **7.3 Mock-up image thumbnails on the customer page**
  - The gallery serves full-size originals via signed URLs; large mock-ups make the
    brand-critical page slow on mobile. Options: `sharp`-generated thumbnail
    variants at upload time (store alongside, additive), or Next `<Image>` with a
    custom loader over signed URLs. Effort: medium. Measure first — only worth it if
    real mock-up files are actually heavy.

- [ ] **7.4 Accessibility + mobile audit of the customer surface**
  - `/o/[token]` and `/o/roster/**` are the brand-facing surfaces (§9 priority).
    One pass: keyboard-only completion of the whole confirm flow, screen-reader labels
    on the 7 acks + signature canvas (canvas needs a text alternative / upload
    fallback prominent), contrast check of the BeastMode palette, 360px-width layout
    check. Fold fixes into the e2e specs (Phase 4) where possible. Effort: ~1 day.

- [ ] **7.5 DB index review for hot queries**
  - Verify (then add where missing, additive migrations): `domain_events (status,
    created_at)` — outbox polling; `orders (status)`, `orders (created_by)` — list
    filters; token-hash unique indexes on all three access tables (likely already
    present — confirm); `garment_sizing (roster_member_id)`. Effort: ~1 hour
    with `EXPLAIN` spot checks.

- [ ] **7.6 Stale-order reminder emails** (FEATURE_PROPOSALS #1, deferred variant)
  - Dashboard widget shipped; the proposal's own guidance: only build the cron/email
    nudge if the widget doesn't change follow-up behavior. **Wait-and-see** — revisit
    after real usage.

- [ ] **7.7 Admin Settings surface** (PROJECT_BRIEF §3 — deliberately deferred)
  - Ack copy is hardcoded-but-versioned (audit requirement satisfied); Google Ads
    config is env-only (operationally *better* than DB-stored credentials). Build only
    when the business wants to edit ack wording without a deploy: `settings` key/value
    table in the `confirmation` schema; editing ack text auto-bumps
    `ack_text_version`. Effort: 1–2 days. Low priority.

---

## Dependency map

```
Phase 1:  1.1, 1.2 independent of everything
Phase 2:  all independent, any order
Phase 3:  3.1 outbox retry ──> 3.2 scheduler (do together)
          3.1 ──────────────> 6.1 webhook (retries for free)
          3.3, 3.4, 3.5, 3.6 independent
Phase 4:  benefits from 2.2 (role-gate spec) — otherwise independent
Phase 5:  every item starts with a human decision; 5.4 purge job also wants 3.2's scheduler
Phase 6:  6.1 after 3.1; 6.2 anytime; 6.3 dormant
Phase 7:  all independent; 7.4 pairs well with Phase 4
```
