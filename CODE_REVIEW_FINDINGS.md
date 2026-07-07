# Code Review Findings — Checklist

Round 1: full-app code quality/security review (2026-07-02) — all core items fixed.
Round 2: follow-up full-app review (2026-07-07) — see the second half of this file,
organized into implementation batches. Check items off as they're addressed.

---

## 1. Cron endpoint will never authenticate as documented

- [x] Fix `src/app/api/internal/process-outbox/route.ts`

**File:** `src/app/api/internal/process-outbox/route.ts:8`

The route's doc comment tells you to wire it up via Vercel Cron
(`vercel.json` → `crons`) and claims "Vercel injects a valid Authorization
header automatically." But the actual auth check (`isInternalAuthorized` in
`src/lib/api-auth.ts`) only looks at the `x-api-key` header — it never checks
`Authorization`. Vercel Cron does not send `x-api-key`.

**Failure scenario:** Follow the file's own setup instructions and add this
path to `vercel.json`'s `crons` list. Every scheduled invocation gets a 401
from `isInternalAuthorized()`, `processOutbox()` never runs, and
`domain_events` rows (order-confirmed emails, Google Ads conversions,
change-request notifications) silently pile up as `'pending'` forever in
production — with no error surfaced anywhere.

**Suggested fix:** Either check `Authorization: Bearer $CRON_SECRET` (Vercel's
actual cron auth mechanism) in addition to `x-api-key`, or fix the comment and
document that the endpoint must be triggered by an external cron sending
`x-api-key` instead of via `vercel.json` crons.

---

## 2. Double-confirmation race in `confirmOrder`

- [x] Fix `src/server/orders/customer-service.ts`

**File:** `src/server/orders/customer-service.ts:188` (check) and
`:237-309` (transaction)

`confirmOrder()` checks `order.status !== 'confirmed'` *before* opening the
transaction, but the transaction itself never re-checks or CAS-guards that
status. The final `UPDATE orders SET status='confirmed'...` has no
`WHERE status != 'confirmed'` clause, and the `confirmations` insert is a
plain `insert` (not an upsert like `acknowledgments`, which uses
`onConflictDoUpdate`).

**Failure scenario:** Two concurrent requests with the same valid magic-link
token (double-click submit, or a client retry after a slow/timed-out
response) both pass the pre-transaction check, then both run the transaction:
two rows in `confirmations`, two `conversionEvents` rows (double-firing the
Google Ads conversion for one sale), and two `order.confirmed` domain events
for a single order.

**Suggested fix:** Add a conditional update (`WHERE status != 'confirmed'`)
inside the transaction and check the affected row count before proceeding
with the rest of the writes, or take a row lock (`SELECT ... FOR UPDATE`) on
the order at the start of the transaction.

---

## 3. `env.ts` silently skips validation in production

- [x] Fix `src/lib/env.ts`

**File:** `src/lib/env.ts:58-70`

The file's own doc comment says "missing config fails fast and loudly," but
a failed Zod parse only logs a `console.warn` when `NODE_ENV !== 'production'`.
In production, if validation fails, the code falls back to the raw,
unvalidated `process.env` cast to the expected type — no warning, no crash.

**Failure scenario:** Deploy with `TOKEN_PEPPER` (or `SESSION_SECRET`,
`INTERNAL_API_KEY`) unset. `parsed.success` is `false`, the warn branch is
skipped because `NODE_ENV === 'production'`, and `env.TOKEN_PEPPER` ends up
`undefined` at runtime with zero signal. Magic-link token hashing
(`src/lib/tokens.ts`) proceeds with a missing pepper, silently weakening
every customer confirmation link issued.

**Suggested fix:** Throw (crash the process) on a failed parse regardless of
`NODE_ENV`, or at minimum always throw in production — "fails fast and
loudly" should not have a production exception.

---

## 4. Rate limiter trusts client-controlled IP

- [x] Fix `src/lib/rate-limit.ts`

**File:** `src/lib/rate-limit.ts:58-64` (`getClientIp`)

`getClientIp()` takes the first (leftmost) entry of `X-Forwarded-For`, which
is the value the client itself supplies, not the value appended by a trusted
reverse proxy.

**Failure scenario:** An attacker brute-forcing `/api/auth/login` or
`/api/auth/2fa/verify` sends a different fabricated
`X-Forwarded-For: 1.2.3.4` (or `X-Real-IP`) header on every request.
`checkRateLimit()` keys on that spoofed value, so each request lands in a
fresh bucket and the brute-force protection never actually triggers.

**Suggested fix:** Take the IP appended by your own trusted proxy (typically
the last entry, or a platform-specific header like Vercel's
`x-vercel-forwarded-for` / `x-real-ip` set only by the edge), not the
client-supplied leftmost entry.

---

## 5. `session.ts` bypasses centralized env validation

- [x] Fix `src/lib/session.ts`

**File:** `src/lib/session.ts:15`

`sessionOptions.password` reads `process.env.SESSION_SECRET` directly
(defaulting to `''` if unset) instead of importing the Zod-validated `env`
from `src/lib/env.ts`. This bypasses the centralized 32-character minimum
check and violates the CLAUDE.md convention that all env access must go
through `src/lib/env.ts`.

**Failure scenario:** If `SESSION_SECRET` is unset or too short in a given
deploy, `env.ts` would normally reject it with a clear, named error. Instead
`session.ts` silently uses `''` (or the short value) as the iron-session
encryption password — the failure mode is an opaque iron-session crash on
first cookie read/write, with no error message pointing back to the actual
missing env var.

**Suggested fix:** Import `env` from `src/lib/env.ts` and use
`env.SESSION_SECRET` / `env.NODE_ENV` here instead of `process.env` directly.

---

## 6. 2FA re-enrollment requires no password re-verification

- [x] Fix `src/app/api/admin/auth/2fa/setup/route.ts` and `.../confirm/route.ts`

**File:** `src/app/api/admin/auth/2fa/setup/route.ts:14`

`POST /2fa/setup` (and the follow-up `/2fa/confirm`) require only an
authenticated session — no password re-verification, and no check that TOTP
is already enabled. This is inconsistent with `DELETE /2fa/disable`, which
requires the user's current password specifically "to prevent CSRF abuse."

**Failure scenario:** An attacker who hijacks a staff session (stolen
cookie, XSS) calls `POST /setup` then `POST /confirm` with a code from their
own authenticator app. This silently overwrites the victim's `totpSecret`
and `totpBackupCodes` with the attacker's own, re-enabling 2FA under the
attacker's control — persistent account takeover that survives the
legitimate user changing their password, since disabling 2FA (which would
kick the attacker out) requires a password the attacker doesn't need in
order to re-enroll in the first place.

**Suggested fix:** Require password re-verification on `/setup` (matching
`/disable`), and/or reject `/setup` if `totpEnabled` is already `true`
without first going through `/disable`.

---

## 7. Same TOCTOU pattern in `requestOrderChanges`

- [x] Fix `src/server/orders/customer-service.ts`

**File:** `src/server/orders/customer-service.ts:129`

`requestOrderChanges()` has the same pre-transaction status check / no
in-transaction guard pattern as `confirmOrder()` (see finding #2), so it can
race against a concurrent `confirmOrder()` call on the same token.

**Failure scenario:** A customer's two tabs (or a retried request) call
`/api/o/confirm` and the change-request endpoint back-to-back on the same
token. Both read `order.status` as not-yet-confirmed before either
transaction commits, so one sets `orders.status` to `'confirmed'` (with a
confirmations row, conversion event, etc.) while the other sets it to
`'changes_requested'` immediately after — leaving the order's status
inconsistent with its own confirmation/audit records.

**Suggested fix:** Same as #2 — a conditional update guarded on current
status, or a row lock, applied consistently to both `confirmOrder` and
`requestOrderChanges`.

---

## 8. Last-admin guard has a TOCTOU race

- [x] Fix `src/server/users/service.ts`

**File:** `src/server/users/service.ts:153-165`

`updateUser()`'s "last admin" guard counts active admins, then writes the
demotion/deactivation in a separate step with no transaction or row lock
tying the count to the write.

**Failure scenario:** Two admins concurrently demote/deactivate the last two
remaining admin accounts (e.g. two browser tabs, or two staff acting at the
same time). Both read `count=2` (≥1, so the check passes) before either
write commits, both pass the `LastAdminError` check, and both updates
succeed — leaving zero active admins and no in-app way to restore admin
access.

**Suggested fix:** Wrap the count-check and the update in a single
transaction with a row lock (`SELECT ... FOR UPDATE`) on the admin rows, or
re-check the count inside the same transaction immediately before the write.

---

## Lower-confidence / follow-up items (not fully verified, worth a look)

- [x] `src/server/auth/totp.ts:43` — `consumeBackupCode` uses
      `Array.prototype.indexOf` (not constant-time) to compare backup code
      hashes, inconsistent with `timingSafeEqual` used elsewhere
      (`tokensMatch`, `isInternalAuthorized`). Fixed: now compares each
      stored hash with `crypto.timingSafeEqual`, matching `tokensMatch`.
- [ ] Admin garment sub-routes (e.g.
      `src/app/api/admin/orders/[id]/garments/[garmentId]/route.ts`) never
      verify that `garmentId` actually belongs to the `id` (order) in the
      URL — low severity since all staff can already access all orders, but
      worth tightening for audit-log correctness. **→ folded into Round 2,
      Batch 2 item 2.7.**
- [ ] `src/app/api/admin/users/route.ts` — when SMTP isn't configured, the
      raw invite `setupUrl` (bearer token, 72h validity) is returned
      directly in the JSON response instead of only being emailed —
      increases exposure surface (logs, APM, proxies). **→ accepted
      trade-off for now (it's the only delivery path without SMTP); revisit
      alongside Round 2, Batch 1 item 1.6 (invite resend).**
- [ ] `src/lib/storage.ts` / `src/server/size-charts/service.ts` — signed
      URLs have no enforced max TTL and no revocation path.

---
---

# Round 2 — Full-App Review (2026-07-07)

Scope: every lib, service, API route, middleware, schema, and the main UI
views. Baseline at review time: typecheck clean, 437/437 tests passing, lint
3 pre-existing warnings.

Organized into batches, lowest-risk-first inside each batch. Rules of
engagement (same as REFACTOR_CHECKLIST.md):

- Keep `npm run typecheck` and `npm run test` green after each batch.
- Add/extend tests when a fix changes observable behavior (error codes,
  email content, retry semantics).
- Batches 1–2 are bugs/hardening (do these), Batch 3–4 are optimizations and
  consistency (cheap, low risk), Batch 5 is optional light features.

---

## Batch 1 — Correctness & security bugs (highest priority)

### 1.1 HTML injection into emails
- [ ] Add an `escapeHtml()` helper in `src/lib/email.ts` and apply it to
      every dynamic string interpolated into email HTML.
- [ ] Escape in: `buildHtml` / `buildText` (`toName`, `orderNumber`),
      `buildRevisionHtml` (`toName`, `orderNumber`, **`priorComment`** —
      customer-typed), `buildInviteHtml` (`toName`, `inviterName`),
      `sendStaffChangeRequestEmail` (**`comment`** — customer-typed,
      `customerName`, `toName`, `orderNumber`),
      `sendStaffConfirmationEmail` (`customerName`, `toName`).
- [ ] Extend `email.test.ts` with an assertion that `<script>`/`<img>` in a
      customer comment arrives entity-encoded.

**Files:** `src/lib/email.ts:131` (`priorComment` in revision email),
`src/lib/email.ts:300` (`comment` in staff change-request email), plus all
other interpolations in that file.

**Problem:** Customer-typed text (the change-request `comment`, which becomes
`priorComment` in the next revision email) is interpolated into email HTML
with zero escaping. A customer can inject arbitrary markup — fake
"re-confirm here" links, external images, spoofed content — into an email
staff inherently trust, and into the customer-facing revision email.
Admin-entered names have the same gap at lower risk.

**Fix shape:** 5-line `escapeHtml()` (`& < > " '`), applied at each
interpolation site (not on storage — DB keeps raw text).

### 1.2 Failed outbox events are never retried
- [ ] Add an `attempts` integer column (default 0) to `domain_events`
      (additive migration).
- [ ] In `processOutbox()`: on handler failure, increment `attempts` and
      keep status `'pending'` while `attempts < MAX_ATTEMPTS` (suggest 5);
      only mark `'failed'` at the cap.
- [ ] Update `processor.test.ts` for the retry semantics.

**File:** `src/server/events/processor.ts:127-132`

**Problem:** `markFailed()` sets status `'failed'` and the picker only
selects `'pending'` — one transient SMTP timeout or Google Ads outage
permanently drops that notification/conversion with no retry and no
visibility. (Batch 5.4 adds the admin-facing surface for events that exhaust
retries.)

### 1.3 Concurrent outbox runs double-fire handlers
- [ ] Claim events before handling: single
      `UPDATE domain_events SET status='processing' WHERE id IN (SELECT id
      ... WHERE status='pending' ORDER BY created_at LIMIT n FOR UPDATE SKIP
      LOCKED) RETURNING *` (or equivalent two-step claim in one
      transaction), then run handlers on the claimed rows only.
- [ ] Add `'processing'` to the `event_status` enum (additive migration);
      treat stuck `'processing'` rows older than a threshold (suggest
      15 min) as re-claimable.
- [ ] Test: two concurrent `processOutbox()` calls deliver each event's
      handlers exactly once.

**File:** `src/server/events/processor.ts:70-113`

**Problem:** The SELECT→handle→UPDATE sequence means two overlapping runs
(cron tick + manual POST, or two cron ticks) both read the same `'pending'`
rows and both execute handlers before either marks delivered. The
`WHERE status='pending'` guard dedupes only the status write, not the side
effects. Google Ads dedups by `orderId`; **staff emails go out twice**.

### 1.4 Vercel Cron gets a 405
- [ ] Export a `GET` handler from
      `src/app/api/internal/process-outbox/route.ts` guarded by
      `isCronAuthorized()` only (keep `POST` for x-api-key/external cron).
- [ ] Update the route doc comment to say Vercel Cron invokes with GET.
- [ ] Route test: GET + valid `Authorization: Bearer $CRON_SECRET` → 200;
      GET without → 401.

**File:** `src/app/api/internal/process-outbox/route.ts` (only exports POST)

**Problem:** Vercel Cron makes **GET** requests. The route's own doc comment
tells you to wire it via `vercel.json` crons — doing so today yields 405 on
every tick and the outbox silently never drains. (Latent: no `vercel.json`
exists yet. Round 1 item #1 fixed the auth header for this same endpoint;
the method was the remaining gap.)

### 1.5 Platform-created orders never notify staff
- [ ] In `src/server/orders/notifications.ts`, when `order.createdBy` is
      null, fall back to sending the notification to
      `STAFF_NOTIFICATIONS_CC` (as `to`) instead of returning early; still
      no-op when neither a creator nor a CC exists.
- [ ] Unit test both notification functions for the createdBy-null + CC-set
      path.

**File:** `src/server/orders/notifications.ts:23-24` (and the same early
return in `notifyStaffOfConfirmation`)

**Problem:** Every order created through `POST /api/orders` (the platform
integration seam) has `createdBy = null`, so confirmation and change-request
notifications are silently skipped — even when `STAFF_NOTIFICATIONS_CC` is
configured, because the early return happens before the CC is ever read.

### 1.6 Invite email failure loses the setup URL
- [ ] In `src/app/api/admin/users/route.ts` POST: wrap `sendInviteEmail` in
      try/catch; on failure return 201 with `{ ok: true, emailFailed: true,
      setupUrl }` so the admin can deliver the link manually.
- [ ] In `UsersView.handleInvite`, surface the "email failed — share this
      link manually" path (reuse the existing no-SMTP `setupUrl` modal).
- [ ] Route test: SMTP configured + send throws → 201 with `setupUrl`.

**File:** `src/app/api/admin/users/route.ts:44-54`

**Problem:** The user row is inserted, then `sendInviteEmail` throws → the
whole request 500s, the one-time `setupUrl` is discarded, and a retry hits
409 `UserConflictError`. With no resend-invite endpoint (see Batch 5.2), the
invite is bricked until someone cancels and re-invites.

### 1.7 Deactivated/demoted staff keep access until cookie expiry
- [ ] Decide the mechanism: (a) `requireAdmin()` + a new `requireStaff()`
      verify `isActive` (and role for admin routes) against the DB per
      request — one indexed PK lookup (recommended); or (b) short session
      TTL + accept the window; or (c) a `sessionVersion` bumped on
      deactivate/demote.
- [ ] Implement for `/api/admin/**` route handlers at minimum (middleware
      stays cookie-only — it runs on Edge without DB access).
- [ ] Test: deactivated user with a live session cookie → 401/403 on admin
      APIs; demoted admin → 403 on admin-only routes.

**Files:** `src/lib/session.ts:35-40` (`requireAdmin` trusts cookie role),
`src/middleware.ts` (auth = cookie only)

**Problem:** Sessions bake `role` at login and nothing ever re-checks the
DB. Deactivating a user (`isActive=false`) or demoting an admin leaves their
existing session fully powered for the iron-session default TTL (~14 days).
The Users page offers "Deactivate" as the security action for departing
staff — it currently doesn't do what it implies.

---

## Batch 2 — Input hardening & small correctness

### 2.1 Dead duplicate state call in customer view
- [ ] Remove the first of the two back-to-back `setChangesRequested(...)`
      calls in `handleRequestChanges`.

**File:** `src/app/o/[token]/view.tsx:295-296` — leftover from an edit;
the first call's value is immediately overwritten.

### 2.2 Unbounded customer-supplied payloads on /api/o/confirm
- [ ] Cap `signatureBase64` (`z.string().max(700_000)` ≈ 500 KB decoded —
      generous for a signature PNG).
- [ ] Constrain `shippingAddress` to a flat record of bounded strings
      (`z.record(z.string().max(500))`, max ~20 keys) instead of
      `z.record(z.unknown())`.
- [ ] Route test: oversized signature → 400.

**File:** `src/app/api/o/confirm/route.ts:16-17`

**Problem:** A valid-token holder can POST arbitrarily large bodies —
`request.json()` buffers it all, the signature is decoded and uploaded to
S3, and the address JSON lands in `orders.shipping_address` and inside the
immutable confirmation snapshot.

### 2.3 `z.string().url()` accepts `javascript:` URLs
- [ ] Add a shared `httpUrl` Zod refinement (must start `http://`/`https://`)
      and use it for `invoiceUrl` in both `contract.ts` and
      `admin-contract.ts`.

**Files:** `src/server/orders/contract.ts:50`,
`src/server/orders/admin-contract.ts:10`; rendered as `<a href>` at
`src/app/o/[token]/view.tsx:405`.

**Problem:** `new URL('javascript:alert(1)')` is valid, so `.url()` passes
it. Admin-entered (low risk), but the sink is the customer page.

### 2.4 Business-rule error returned as 500 with raw message
- [ ] Add a `PendingUserOnlyError` (or reuse a typed conflict error) in
      `src/server/users/service.ts` `deleteUser`; map it to **409** in the
      route.
- [ ] Stop echoing `err.message` in the 500 fallback of
      `src/app/api/admin/users/[id]/route.ts:60` (return generic message,
      keep the `console.error`).
- [ ] Same leak in `src/app/api/admin/orders/[id]/send-link/route.ts:66-67`
      — return a generic 500 body (SMTP internals shouldn't reach the
      client); the admin-facing "email failed" message can stay generic.

### 2.5 Unclamped list pagination + ILIKE wildcards
- [ ] In `src/app/api/admin/orders/route.ts` GET: clamp `limit` to 1–100,
      `offset` to ≥ 0, defaulting NaN to the defaults.
- [ ] In `listOrders` (`src/server/orders/service.ts:156-165`): escape `%`,
      `_`, and `\` in the search term before building the ILIKE patterns.

### 2.6 Missing rate limits on 2FA management endpoints
- [ ] `POST /api/admin/auth/2fa/confirm` — limit code attempts (e.g. 10 /
      5 min per user); a 6-digit space is brute-forceable with a hijacked
      session mid-enrollment.
- [ ] `POST /api/admin/auth/2fa/setup` and `DELETE /2fa/disable` — limit
      password attempts (e.g. 5 / 5 min per user), matching the login and
      verify endpoints' posture.

**Files:** `src/app/api/admin/auth/2fa/confirm/route.ts`,
`.../setup/route.ts`, `.../disable/route.ts`

### 2.7 Garment sub-routes don't verify ownership (Round 1 leftover)
- [ ] In the garment/sizing/images handlers, verify the garment's `orderId`
      matches the `id` URL segment before mutating (single indexed lookup);
      404 on mismatch.
- [ ] While there: `updateGarment` + `updateGarmentSizeChartLinks` in the
      PATCH handler run as two separate operations — wrap in one
      transaction (e.g. a combined service function).

**Files:** `src/app/api/admin/orders/[id]/garments/[garmentId]/route.ts`,
`.../sizing/route.ts`, `.../images/route.ts`, `.../images/[imgId]/route.ts`

### 2.8 TOTP codes are replayable within their window
- [ ] Track the last-accepted TOTP counter/step per user (new nullable
      column, additive) and reject a code whose step is ≤ the stored one.
      Enforce on both `/api/auth/2fa/verify` and the `/2fa/confirm`
      enrollment check.

**Files:** `src/server/auth/totp.ts`, `src/app/api/auth/2fa/verify/route.ts`,
`src/app/api/admin/auth/2fa/confirm/route.ts`

**Problem:** Standard hardening — a shoulder-surfed/phished code stays valid
for the remaining ~30–60 s window even after legitimate use.

---

## Batch 3 — Optimizations (all minor at current scale)

### 3.1 Per-call client construction
- [ ] Memoize the `S3Client` at module level in `src/lib/storage.ts:10`
      (lazy singleton).
- [ ] Memoize the nodemailer transport in `src/lib/email.ts:11` (lazy
      singleton — env-derived config doesn't change at runtime).

### 3.2 OrdersView fetch races
- [ ] Add an `AbortController` (or stale-response guard) to `fetchOrders`
      in `src/app/admin/orders/OrdersView.tsx:58-78` so a slow older
      response can't overwrite a newer one.
- [ ] Fold the "reset to page 1 on filter change" effect into the fetch
      flow to avoid the double fetch when filters change while `page > 1`.

### 3.3 `getStaleOrders` does app-side aggregation
- [ ] (Defer until order volume warrants) Replace the
      load-all-candidates-and-events approach in
      `src/server/orders/service.ts:222-282` with a single SQL query
      (lateral join / `DISTINCT ON` for latest event per order).

### 3.4 Doc drift in rate limiter
- [ ] `src/lib/rate-limit.ts:2` says "sliding-window"; the implementation
      is a fixed window (and the body text below it says so). Fix the
      header line.

### 3.5 Google Ads OAuth token refreshed per conversion
- [ ] (Optional) Cache the access token until expiry in
      `src/server/conversions/google-ads.ts:141-158`. Conversions are rare;
      lowest priority in this batch.

---

## Batch 4 — Quality / consistency

### 4.1 Staff confirmation email bypasses the shared layout
- [ ] Route `sendStaffConfirmationEmail`'s HTML
      (`src/lib/email.ts:350-352`) through `wrapEmailLayout` +
      `emailButton` like the other four templates (Phase 4 of
      REFACTOR_CHECKLIST missed it).

### 4.2 PDF route hand-rolls session reading
- [ ] Replace the manual `getIronSession(await cookies(), sessionOptions)`
      in `src/app/api/admin/orders/[id]/pdf/route.tsx:13` with
      `getSession()` (or whatever guard Batch 1.7 introduces).

### 4.3 Upload extension handling inconsistent
- [ ] Mockup uploads (`.../garments/[garmentId]/images/route.ts:35`) derive
      the file extension from the user-supplied filename; size-charts derive
      it from a MIME→ext map. Use the MIME map in both.

### 4.4 `requireAccessCode` is a documented no-op
- [ ] The create-order contract (`src/server/orders/contract.ts:65`)
      accepts `requireAccessCode` but nothing ever sets
      `order_access.access_code_hash`. Either remove the field from the
      contract (additive-safe: it was never honored) or implement it.
      Decide and do one.

### 4.5 S3 orphans on delete
- [ ] `deleteOrder` (draft-only) and `deleteGarment` cascade DB rows but
      never delete mockup/signature objects from S3. Collect `storageKey`s
      before delete and fire best-effort `deleteFile()`s (pattern already
      exists in `deleteSizeChart`).

**File:** `src/server/orders/service.ts:351-358`, `:397-401`

### 4.6 Bookkeeping
- [ ] Check off REFACTOR_CHECKLIST.md Phase 5 items (implemented in the
      working tree: `requireAdmin` moved to `session.ts`,
      `rateLimitedResponse`, `badRequest`) once committed.
- [ ] `listOrders` currently also powers `GET /api/orders` (integration
      surface) with default limit 100 and no documented pagination contract
      — document the pagination params in the endpoint docs when touching
      it (and consider wiring `limit`/`offset` query params through with
      the same clamping as 2.5).

---

## Batch 5 — Lightweight feature ideas (optional, pick per need)

### 5.1 Magic-link expiry
- [ ] `order_access.expires_at` exists in the schema and is enforced in all
      four read paths — but production code never sets it (only demo seeds
      do). Set it in `generateAccessToken()` from a new
      `LINK_EXPIRY_DAYS` constant in `src/lib/config.ts` (suggest 30–60
      days; `null` = no expiry stays supported).

### 5.2 Resend invite
- [ ] `POST /api/admin/users/[id]/resend-invite` (admin-only): regenerate
      invite token + expiry for a pending user, email it (or return
      `setupUrl` when SMTP is absent/fails — consistent with 1.6). Add a
      "Resend" button next to "Cancel invite" in `UsersView`.

### 5.3 Confirmation details on the admin order page
- [ ] The confirmation record (ack list, IP, user-agent, signature image,
      immutable snapshot) is stored but never shown anywhere — and the PDF
      omits the signature. Add a "Confirmation" tab to `OrderDetailView`
      rendering the acks, metadata, and a signed-URL signature image for
      confirmed orders.

### 5.4 Failed-events visibility
- [ ] Dashboard stat (or Users-page-style list) of `domain_events` /
      `conversion_events` in `'failed'` status, with a "retry" action that
      re-marks them `'pending'` (pairs with 1.2/1.3).

### 5.5 CSV export of orders
- [ ] `GET /api/admin/orders/export` reusing `listOrders` filters →
      `text/csv` attachment; "Export CSV" button on the Orders page next to
      the search box.
