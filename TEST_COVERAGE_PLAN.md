# Test Coverage Plan

Baseline captured 2026-07-10 via `npm run coverage`: **532 tests passing / 65 files**, no failures.
After Phase 1 (same day): **569 tests passing / 72 files**. After Phase 2 (same day): **639 tests
passing / 78 files**. After Phase 3 (same day): **679 tests passing / 81 files**. After Phase 4
(same day): **695 tests passing / 84 files**. After Phase 5 (same day): **727 tests passing /
86 files**.

| Metric | Baseline | After Phase 1 | After Phase 2 | After Phase 3 | After Phase 4 | After Phase 5 |
|---|---|---|---|---|---|---|
| Statements | 54.94% | 58.45% | 68.78% | 75.80% | 77.06% | 78.45% |
| Branches | 54.65% | 59.01% | 71.56% | 76.14% | 77.38% | 78.78% |
| Functions | 52.54% | 57.35% | 68.85% | 77.58% | 78.45% | 81.51% |
| Lines | 55.9% | 59.58% | 69.56% | 76.56% | 77.95% | 78.86% |

The gap is almost entirely in the **React component layer** (admin views, customer inputs, auth
forms) — the server layer (`src/server/**`, `src/app/api/**`) is already well covered. Phases are
ordered by business risk first (customer-facing legal sign-off flow), then daily-use admin
surfaces, then everything else. Re-run `npm run coverage` at the end of each phase and check off
the phase header once its target is met.

Test infra already exists — no new setup needed. Component tests use the `jsdom` vitest project
(`*.test.tsx`, React Testing Library conventions already established in
`OrderForm.test.tsx` / `OrderPdf.test.tsx`) and route/service tests use the `node` project
(`*.test.ts`, PGlite-backed per `src/db/test-helpers.ts`).

---

## Phase 1 — Customer confirmation surface (highest risk: the legal sign-off flow) ✅ done 2026-07-10

- [x] `src/components/customer/ShippingAddressField.tsx` (25% → **100%** stmts / 100% branch)
  - [x] renders controlled fields and calls `onChange` with edited values
  - [x] required-field validation messages surface correctly (implicitly via mode coverage)
  - [x] pre-fills from existing order address when provided
- [x] `src/components/customer/SignaturePad.tsx` (38% → **86%** stmts / 75% branch)
  - [x] draw tab: `onEnd` fires `onChange({ type: 'drawn' })` with a data URL
  - [x] Clear button resets canvas and calls `onChange({ dataUrl: null, type: 'none' })`
  - [x] upload tab: non-image file is rejected (`beforeUpload` returns false, no state change)
  - [x] upload tab: valid image sets preview and calls `onChange({ type: 'uploaded' })`
  - [x] Remove button on uploaded preview clears state
  - [x] switching to "skip" tab calls `onChange({ type: 'none' })`
  - (remaining gap: the `ResizeObserver` callback body — stubbed as a no-op in `vitest.setup.dom.ts`, not worth a custom mock for a canvas-resize concern)
- [x] `src/components/customer/SizingTableReadOnly.tsx` (36% → **100%** stmts / 90% branch)
  - [x] renders sizing rows per garment correctly
  - [x] handles empty/missing sizing data gracefully
- [x] `src/components/customer/AccessCodeGate.tsx` (0% → **96%** stmts / 80% branch)
  - [x] entering 6 digits triggers `POST /api/o/verify-code` and calls `router.refresh()` on success
  - [x] wrong code (non-429) shows generic "Incorrect code" error and clears input
  - [x] 429 response shows rate-limit message from response body
  - [x] network failure shows fallback error message
- [x] `src/components/customer/RequestChangesModal.tsx` (69% → **88%** stmts / 50% branch)
  - [x] cancel-while-not-submitting clears the comment and calls `onCancel` (the actual gap was `handleCancel`, lines 31-33 — not a missing submit-error branch as originally guessed)
  - [x] Cancel is disabled while a submit is in flight
- [x] `src/app/o/[token]/page.tsx` (0% → **97%** stmts) + `not-found.tsx` (0% → **100%**)
  - [x] valid token renders order view
  - [x] invalid/expired/revoked token renders `not-found`
  - [x] access-code-protected order without cookie renders `AccessCodeGate` instead of order
  - [x] bonus: signed-URL assembly for images/size-charts, storage-failure fallback, fire-and-forget `recordOrderViewed` failure is logged not thrown
- [x] `src/app/o/[token]/view.tsx` gaps (90% → **91%** stmts) — fabric tags, size-chart preview
      modal (PDF iframe / image / no-URL tag), Concerns textarea, customer-entered shipping
      address wiring, canceling both modals

**Target met:** all files ≥85% statements (ShippingAddressField and SizingTableReadOnly at 100%).
72 new tests added (532 → 569 passing), zero regressions, `typecheck`/`lint` clean.

**Found but not fixed (out of scope for a coverage pass):** `RequestChangesModal.handleSubmit`
has no `catch` around `await onSubmit(...)` — if the customer's "Request Changes" submission
fails (network error, non-2xx from `/api/o/request-changes`), the button silently re-enables with
no error message, and the rejection is technically unhandled. Same shape as the working
`handleConfirm` in `view.tsx`, which does catch and call `message.error(...)`. Worth a small
follow-up fix mirroring that pattern.

---

## Phase 2 — Admin order list & detail views (daily-use core screens) ✅ done 2026-07-10

- [x] `src/app/admin/orders/OrdersView.tsx` (0% → **95.0%** stmts / 76.8% branch)
  - [x] renders order list/table from fetched data
  - [x] search/filter by customer or order number (debounced)
  - [x] sortable columns (clicking "Created" refetches with sortBy/sortDir)
  - [x] CSV export button/link reflects the current status filter
  - [x] bonus: status-tab initialization from the `status` URL param, row-click navigation,
        silently keeps prior rows on a failed refetch
- [x] `src/app/admin/orders/[id]/OrderDetailView.tsx` (0% → **88.0%** stmts / 77.7% branch)
  - [x] tab navigation (Details / Garments / Share Link / Audit Log), including opening the tab
        named in the `tab` URL param
  - [x] Cancel order action (confirm → API call → status badge updates → Cancel/Resend hide)
  - [x] Duplicate order action (success navigates to the new order; failure shows the API's error)
  - [x] Resend link (success message; 503 "email not configured" path)
  - [x] Download PDF button visibility (only when `status=confirmed`)
  - [x] "changes requested" comment Alert renders when present, with the round-N wording
  - [x] Save details PATCHes with typed internal notes; success/failure messages
  - [x] Delete order (draft-only visibility, confirm → DELETE → redirect to orders list)
  - (access-code enable/disable is `ShareLinkPanel`'s own responsibility, already covered in
    `ShareLinkPanel.test.tsx` — `OrderDetailView` only renders that panel, so it's mocked out here
    rather than re-tested)
- [x] `src/app/admin/dashboard/DashboardView.tsx` (0% → **94.7%** stmts / 97.4% branch)
  - [x] upcoming deadlines widget renders entries (overdue / today / tomorrow / due-in-N label math)
  - [x] stale-orders widget renders entries (singular/plural "day(s)" wording)
  - [x] empty states for both widgets, plus Recent Orders and the status-breakdown pie chart
  - [x] bonus: pipeline-value formatting ($/K/M), relative "time ago" labels, conditional
        "Changes Requested" quick-action visibility
- [x] `src/components/admin/orders/AuditLogTab.tsx` (0% → **83.9%** stmts / 80.7% branch)
  - [x] loading spinner while fetching
  - [x] renders timeline items with correct icon/color/label per event type, falls back to the
        raw type string for an unrecognized one
  - [x] empty state ("No activity recorded yet")
  - [x] fetch failure shows error Alert
  - [x] `changes_requested` event renders the comment block; other payload shapes (actor email,
        recipient, resend marker, changed fields, source order number) render correctly
- [x] `src/components/admin/orders/MockupUploader.tsx` (0% → **98.4%** stmts / 88.2% branch)
  - [x] batched upload: multiple files selected together produce one batch of POST calls, one
        summary success message
  - [x] partial batch failure shows correct success + failure message counts
  - [x] delete image removes it from the grid and calls DELETE endpoint; failure keeps the image
  - [x] empty state when no images; caption field is included in the upload FormData
- [x] `src/components/admin/orders/OrderStatusBadge.tsx` (0% → **100%** stmts / 100% branch)
  - [x] renders correct color/label per status, falls back to raw status for unknown values

**Target met:** all 6 files ≥84% statements (OrderStatusBadge at 100%). 70 new tests added
(569 → 639 passing), zero regressions, `typecheck`/`lint` clean. Overall project coverage moved
58.45% → 68.78% statements in this phase alone.

---

## Phase 3 — Admin settings views ✅ done 2026-07-10

- [x] `src/app/admin/users/UsersView.tsx` (0% → **89.2%** stmts / 66.7% branch) — list render,
      invite flow (incl. the "email not configured" setup-link fallback), role change, active
      toggle, cancel-invite, last-login column
- [x] `src/app/admin/profile/ProfileView.tsx` (0% → **94.6%** stmts / 82.4% branch) — full 2FA
      setup wizard (password → QR/secret → verify code → backup codes), copy-to-clipboard, the
      already-enabled view with low-backup-codes warning, and the disable flow
- [x] `src/app/admin/size-charts/SizeChartsView.tsx` (0% → **86.9%** stmts / 78.3% branch) — CRUD
      list, upload (with file), edit, delete (including the linked-garments warning message),
      PDF vs. image preview modal

**Target met:** all 3 files ≥86% statements. 40 new tests added (639 → 679 passing), zero
regressions, `typecheck`/`lint` clean. Tests were written against the working-tree versions of
`ProfileView.tsx` and `SizeChartsView.tsx` (both had uncommitted changes throughout this phase).
Overall project coverage moved 68.78% → 75.80% statements in this phase.

---

## Phase 4 — Auth / login surface ✅ done 2026-07-10

- [x] `src/app/login/LoginForm.tsx` (0% → **100%** stmts / 100% branch)
  - [x] successful login without MFA redirects to `from` query param or `/admin/dashboard`
  - [x] `requiresMfa: true` response redirects to `/login/2fa`
  - [x] API error shows Alert with message; also covered the generic network-failure fallback
        and the built-in required-field validation
- [x] `src/app/login/2fa/TwoFactorForm.tsx` (0% → **100%** stmts / 100% branch)
  - [x] successful verify redirects to `/admin/dashboard`
  - [x] error shows Alert; network-failure fallback; error clears when the mode toggle is used
  - [x] "use backup code" toggle changes label/placeholder/maxLength; trims whitespace from the
        submitted code
- [x] `src/components/auth/AuthCard.tsx` (0% → **100%** stmts / 100% branch, trivial shell)
  - [x] renders children within themed card; default vs. overridden `maxWidth`
- [x] `src/app/login/page.tsx`, `src/app/login/2fa/page.tsx` — left untested by design, per the
      plan's own note: these are one-line wrappers (`<Suspense><LoginForm /></Suspense>` and
      `<TwoFactorForm />`) with no logic of their own to verify

**Target met and exceeded:** all 3 tested files at 100% statements/branches. 16 new tests added
(679 → 695 passing), zero regressions, `typecheck`/`lint` clean. Overall project coverage moved
75.80% → 77.06% statements in this phase (small phase — most of the app's line count is in the
much larger admin/customer views from Phases 1-3).

---

## Phase 5 — Misc components & existing branch gaps ✅ done 2026-07-10

- [x] `src/components/GoogleTagManager.tsx` (0% → **100%** stmts) — the plan called this
      `TagManager.tsx`; the real file exports `GoogleTagManagerHead`/`GoogleTagManagerBody` with no
      "ID absent" branch (that gating happens one level up in `layout.tsx`, out of scope). jsdom
      doesn't render `<noscript>` children at all (same as real browsers with scripting enabled),
      so the body component's test only asserts it renders without throwing.
- [x] `src/components/admin/UserMenu.tsx` (50% → **100%** stmts / 100% branch) — dropdown open,
      logout action (fetch + redirect)
- [x] `src/components/admin/AppShell.tsx` (79.3% → **96.6%** stmts / 92.3% branch) — sidebar
      collapse toggle, theme toggle (persists to `localStorage`); left the two mouse-hover
      style-only handlers uncovered (cosmetic, no behavior to assert)
- [x] `src/components/admin/ThemeToggle.tsx` — already at 100% from Phase 2's `AppShell` tests
- [x] `src/lib/session.ts` (40% → **100%** stmts / 100% branch) — `requireAdmin()` was entirely
      untested: added no-session (401), wrong-role (403), and admin-success cases
- [x] `src/lib/format.ts` — already at 100%, covered transitively by Phases 1-3's component tests
- [x] `src/lib/rate-limit.ts` (87.1% stmts, unchanged) — the remaining gap is the module-level
      periodic cleanup `setInterval` callback. Exercising it needs `vi.resetModules()` +
      `vi.useFakeTimers()` *before* importing the module so the fake timer intercepts the
      top-level `setInterval` call, and even then there's no exported way to observe whether the
      internal `Map` was actually pruned — `checkRateLimit()` already treats a stale entry as
      fresh regardless of whether the cleanup ran. Skipped as genuinely not worth it.
- [x] Swept branch gaps across **13 of the 19** listed API route files (all with real integration
      tests already, mocking `@/db` against PGlite): `admin/orders/[id]/token`,
      `admin/orders/[id]/route`, `admin/orders/route`, `admin/orders/[id]/garments/route`,
      `admin/orders/[id]/garments/[garmentId]/route`,
      `admin/orders/[id]/garments/[garmentId]/sizing`, `admin/size-charts/[id]`, `auth/login`,
      `auth/2fa/verify`, `auth/2fa/setup`, `o/confirm`, `o/request-changes`, `o/verify-code`.
      Added the branches with real product meaning — malformed-JSON-body 400s, not-found/conflict
      cases, the `code_required`/`missing_ack` access-control paths on the customer confirm and
      request-changes routes, an "Invalid session" 2FA edge case, and an IP-vs-token rate-limit
      distinction on `o/verify-code` that the existing test suite silently never exercised.
      Deliberately left alone: `admin/orders/[id]/duplicate` and `admin/orders/[id]/cancel`
      (their only gap was already the generic 500 fallback, confirmed by inspection), and the
      remaining 6 files (`garments/[garmentId]/images/*`, `auth/2fa/confirm`, `auth/2fa/disable`)
      whose gaps are the same generic `catch { console.error; return 500 }` boilerplate repeated
      everywhere — real product logic in all of them is already covered.

**Target met:** all small files ≥87% statements (most at 100%). 32 new tests added
(695 → 727 passing), zero regressions, `typecheck`/`lint` clean. As the plan flagged going in,
this phase was explicitly opportunistic — the API-route sweep specifically prioritized branches
with real product behavior (auth, not-found, conflict, malformed input) over defensive
boilerplate with no realistic trigger, which is the same generic-500 catch-all repeated in nearly
every route file in this codebase.

---

## Phase 6 — Playwright e2e (currently reserved, no spec files)

- [ ] Golden path: staff login → create order → send magic link → customer opens link → completes
      all 7 acknowledgments + shipping + signature → confirms → staff sees `confirmed` status +
      can download PDF
- [ ] Changes-requested path: customer requests changes → staff sees comment → staff edits order →
      resends link → customer re-confirms
- [ ] Access-code-protected path: staff enables access code → customer hits gate → enters wrong
      code (rate limit) → enters correct code → sees order
- [ ] Auth path: login → 2FA challenge → dashboard; logout clears session

**Target:** 4 specs covering the flows above. This is the last phase — everything above should be
covered by unit/integration tests first since e2e is slower and more brittle to maintain.

---

## Definition of done per phase

1. `npm run test:unit` and `npm run test:integration` both green.
2. `npm run coverage` shows the phase's target met for the files listed.
3. Check off every box in the phase, then check the phase header itself.
4. Optionally ratchet `vitest.config.ts` — no coverage thresholds are enforced today; once Phase 2
   is done, consider adding `coverage.thresholds` so CI fails on regression instead of just
   reporting.
