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

## Phase 2 — Quick hardening wins (~1 day total)

Small, independent, no product decisions needed.

- [ ] **2.1 Stop tracking `coverage/` output in git**
  - Generated coverage HTML/JSON reports are committed and show as modified on every
    test run — diff noise and repo bloat.
  - Fix: `git rm -r --cached coverage/`, add `coverage/` to `.gitignore` (an edit to
    `.gitignore` appears already started — finish it), commit.
  - Effort: minutes.

- [ ] **2.2 Admin-role check on size-chart mutation routes**
  - PROJECT_BRIEF §3 assigns size-chart *library management* to admin, but
    `src/app/api/admin/size-charts/route.ts` (and `[id]` route) have no role check —
    any `sales` user can create/replace/delete library charts. `requireAdmin()`
    (`src/lib/session.ts:35`) is currently used only by `/api/admin/users/**`.
  - Decision embedded here (confirm with the business): sales keep **read** access
    (they must link charts to garments); **mutations** become admin-only.
  - Steps:
    - [ ] Add `requireAdmin()` to `POST`/`PUT`/`PATCH`/`DELETE` in
      `src/app/api/admin/size-charts/**`. Leave `GET` open to any authenticated staff.
    - [ ] Hide mutate buttons in `SizeChartsView` for `role === 'sales'` (role is
      already available via the layout/shell — `AppShell.tsx` receives it).
    - [ ] Integration tests: sales → 403 on mutate, 200 on GET; admin → 200 on both.
  - Effort: 1–2 hours.

- [ ] **2.3 Roster size cap**
  - TEAM_ROSTER_PLAN open question #3. No explicit max on roster size — member-create
    and import paths are unbounded per order (import has a row cap per file, but
    repeated imports accumulate).
  - Fix: single constant (e.g. `MAX_ROSTER_MEMBERS = 100`) enforced in
    `src/server/roster/service.ts` (add + import paths) **and**
    `customer-service.ts` (self-add path), with a clear error message.
  - Effort: trivial. Recommended regardless of the other roster open questions.

- [ ] **2.4 Origin-header CSRF check for admin mutations**
  - Session cookie is `sameSite: 'lax'` (`src/lib/session.ts:22`) which blocks most
    cross-site POSTs, but PROJECT_BRIEF §7 asks for CSRF protection explicitly and an
    Origin check is cheap defense-in-depth.
  - Fix: in `src/middleware.ts`, for non-GET requests to `/api/admin/**`, reject with
    403 when the `Origin` header is present and doesn't match the request host.
    (Reject-if-mismatch, allow-if-absent — non-browser clients don't send Origin.)
  - Add middleware tests for: same-origin POST ok, cross-origin POST 403, GET untouched.
  - Effort: ~1 hour.

- [ ] **2.5 Security response headers**
  - `next.config.mjs:17-26` sets only `X-Robots-Tag`. Missing standard hardening
    headers for an app that renders signed customer data.
  - Add to the same `headers()` block:
    - `X-Frame-Options: DENY` (nothing here should ever be framed),
    - `X-Content-Type-Options: nosniff`,
    - `Referrer-Policy: strict-origin-when-cross-origin` (magic-link tokens are in the
      URL path — don't leak them via referrer to external invoice links),
    - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (prod only),
    - optionally a starter `Content-Security-Policy` (report-only first; antd inline
      styles make a strict CSP non-trivial — don't block the phase on it).
  - Note: `Referrer-Policy` matters extra here because the customer page links out to
    `invoice_url` — verify external links also carry `rel="noopener noreferrer"`.
  - Effort: ~1 hour + a smoke check that nothing breaks (PDF route, signed URL fetches).

- [ ] **2.6 Dependency vulnerability gate in CI**
  - `.github/workflows/test.yml` runs typecheck → lint → tests but no audit. The
    project already has a standing decision that dependencies must be
    vulnerability-checked (the `xlsx` → `exceljs` swap in the roster work).
  - Steps:
    - [ ] Add `npm audit --omit=dev --audit-level=high` as a CI step (non-dev deps,
      high+ severity fails the build).
    - [ ] Add a Dependabot config (`.github/dependabot.yml`) for npm + github-actions
      ecosystems, weekly.
  - Effort: ~30 min.

---

## Phase 3 — Reliability & operability

The outbox retry is the highest-value fix in this whole document.

- [ ] **3.1 Outbox retry / redrive for failed events** ⚠ highest value
  - Problem: `markFailed()` (`src/server/events/processor.ts:140-145`) sets
    `status='failed'` and nothing ever picks failed events up again. A transient
    failure (Google Ads blip, SMTP timeout) permanently loses that conversion or
    notification. No attempt counter, no backoff, no admin redrive.
  - Aggravating detail: `/api/o/confirm` fires handlers fire-and-forget at confirm
    time, so the outbox **is** the retry path — its no-retry behavior defeats its own
    purpose.
  - Steps:
    - [ ] Additive migration: `attempts int not null default 0`,
      `next_attempt_at timestamptz` on `domain_events`.
    - [ ] Processor selects `status='pending' OR (status='failed' AND attempts < 5 AND
      next_attempt_at <= now())`; on failure increment `attempts`, set
      `next_attempt_at` by exponential backoff (1m → 5m → 30m → 2h → 12h).
    - [ ] After max attempts → `status='dead'` (additive enum value / text status).
    - [ ] Keep per-handler idempotency guarantees documented (Google Ads path already
      skips when `conversion_events.status='sent'` — state the same expectation for
      email handlers).
    - [ ] Admin dashboard: "Failed events" widget (count of `failed`/`dead`) with a
      per-event "Retry now" (reset to `pending`, zero `attempts`).
    - [ ] Tests: transient-fail → retried → delivered; permanent-fail → dead; redrive.
  - Effort: 0.5–1 day.

- [ ] **3.2 Schedule the outbox processor (ops prerequisite)**
  - `POST /api/internal/process-outbox` exists and is guarded (`x-api-key` /
    `CRON_SECRET`), but nothing in-repo schedules it — delivery currently depends on
    the fire-and-forget calls at confirm time.
  - Pick one (options already documented in README ~L237-291): Supabase `pg_cron` +
    `http` extension, Vercel Cron, or the host's scheduler. Every 5 min is plenty.
  - [ ] Set up the schedule in the chosen environment.
  - [ ] Document the chosen mechanism + env vars in README as *the* decision.
  - Effort: < 1 hour once hosting is settled. Blocks the value of 3.1 — do together.

- [ ] **3.3 Postgres-backed rate limiting (pre-scale-out)**
  - `src/lib/rate-limit.ts` is a per-process sliding window. The intended hosting
    (App Runner, PROJECT_BRIEF §2) autoscales horizontally: N instances = N× the
    intended limit, and every deploy resets all windows.
  - Fix: `rate_limits` table (`key text, window_start timestamptz, count int`) with a
    single upsert-increment statement; keep the in-memory path as fallback when the DB
    is unavailable and for unit tests. Redis is overkill at this volume.
  - Timing: required before running more than one instance — fine to defer until the
    hosting decision executes, but record it in the deploy runbook now.
  - Effort: ~0.5 day.

- [ ] **3.4 Structured logging + error monitoring**
  - Today errors go to `console.error` with ad-hoc prefixes (`[outbox]`,
    `[size-charts GET]`, …). Fine for dev; opaque in production.
  - Steps (keep light — this is not an observability platform build-out):
    - [ ] Tiny `src/lib/logger.ts` wrapper (level + JSON output in prod, pretty in
      dev), swap `console.error` call sites.
    - [ ] Optional Sentry (or similar) behind an env var (`SENTRY_DSN` absent = no-op),
      wired into the logger's error path and Next's `instrumentation.ts` — degrade
      gracefully like every other optional env var in `src/lib/env.ts`.
    - [ ] Alert-worthy signal #1: outbox `failed`/`dead` count > 0 (pairs with 3.1's
      widget).
  - Effort: ~0.5 day.

- [ ] **3.5 Explicit session TTL**
  - `sessionOptions` (`src/lib/session.ts:16-24`) sets no `ttl` — iron-session's
    default applies (14 days) and the cookie has no `maxAge` (session cookie).
    Nothing was *decided* here; make it explicit.
  - [ ] Decide idle/absolute expiry (suggest: `ttl: 60 * 60 * 24 * 7` — 7 days — for
    an internal tool with 2FA available), set it, and add a test that an expired seal
    is rejected.
  - Effort: < 1 hour.

- [ ] **3.6 (Optional) Per-account login backoff**
  - Login rate limiting is per-IP only. A distributed guesser rotating IPs gets
    unlimited tries per account.
  - Cheap version: also rate-limit by normalized email key
    (`login:${email.toLowerCase()}`) with a stricter window; no schema change.
  - Effort: ~1 hour. Optional — bcrypt cost + 2FA already blunt this.

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
