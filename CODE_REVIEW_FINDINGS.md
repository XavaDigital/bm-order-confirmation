# Code Review Findings — Checklist

From a full-app code quality/security review (2026-07-02), not tied to a specific
diff. Check items off as they're addressed. Ranked most severe first.

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
      worth tightening for audit-log correctness.
- [ ] `src/app/api/admin/users/route.ts` — when SMTP isn't configured, the
      raw invite `setupUrl` (bearer token, 72h validity) is returned
      directly in the JSON response instead of only being emailed —
      increases exposure surface (logs, APM, proxies).
- [ ] `src/lib/storage.ts` / `src/server/size-charts/service.ts` — signed
      URLs have no enforced max TTL and no revocation path.
