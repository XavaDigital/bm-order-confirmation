# DRY Refactor Checklist

Found while reviewing the codebase for duplicated components/patterns. Grouped
into phases, roughly lowest-risk first. Check items off as each phase lands.

---

## Phase 1 — Status-message panels (customer-facing)

**Problem:** `AlreadyConfirmedPanel`, `SuccessPanel`, `ChangesRequestedPanel`
(`src/app/o/[token]/view.tsx`) and `TokenNotFound`
(`src/app/o/[token]/not-found.tsx`) all wrap their content in the exact same
`minHeight:100vh, background:BEASTMODE.navy, flex-centered, padding:24` div —
differing only in icon, title, and body copy.

- [x] Extract a shared `StatusPage` component (e.g.
      `src/components/customer/StatusPage.tsx`) taking `icon`, `title`,
      `children` (or similar props) and rendering the common full-page shell.
- [x] Rewire `AlreadyConfirmedPanel`, `SuccessPanel`, `ChangesRequestedPanel`
      in `view.tsx` to use it.
- [x] Rewire `TokenNotFound` in `not-found.tsx` to use it.
- [x] Confirm visuals are pixel-identical (typecheck + visual check of each
      of the 4 states).

---

## Phase 2 — Auth card shell

**Problem:** `LoginForm.tsx`, `TwoFactorForm.tsx`, and `AcceptInviteView.tsx`
each repeat the same "centered dark card, max-width 400, wordmark on top"
wrapper. This has already caused drift: `AcceptInviteView.tsx` hardcodes
`#0d1117`/`#161b22` instead of `BEASTMODE.navy`/`BEASTMODE.charcoal`
(`#0B1622`/`#161E2B`) — a slightly different shade of navy purely from
copy-paste.

- [x] Extract a shared `AuthCard` component (e.g.
      `src/components/auth/AuthCard.tsx`) taking `children` (form content)
      and rendering the shared page/card shell using `BEASTMODE` tokens.
- [x] Rewire `LoginForm.tsx` to use it.
- [x] Rewire `TwoFactorForm.tsx` to use it.
- [x] Rewire `AcceptInviteView.tsx` to use it — this also fixes the color
      drift bug as a side effect.
- [x] Confirm all three pages render identically (typecheck + visual check).

---

## Phase 3 — Dashboard status colors + list duplication

**Problem A:** `DashboardView.tsx` re-implements its own `STATUS_COLORS` /
`STATUS_LABELS` / `statusTag()` instead of reusing the existing
`OrderStatusBadge` component (already used correctly in `OrdersView.tsx`).
Note: the hex color map can't fully disappear — it's also used for the pie
chart fill and avatar background, which need raw hex, not antd's semantic
tag colors — so only the *tag-rendering* part (`statusTag()`) collapses into
`OrderStatusBadge`.

**Problem B:** The "Recent Orders" and "Needs Follow-up" lists in
`DashboardView.tsx` are near-duplicate `List` / `List.Item.Meta` blocks —
same avatar/title/description/action shape, different fields.

- [x] Replace `statusTag()` calls in `DashboardView.tsx` with
      `<OrderStatusBadge status={...} />`; keep `STATUS_COLORS` only for the
      chart/avatar hex needs, rename it to make that scope clear (e.g.
      `STATUS_HEX`).
- [x] Extract a shared list-item renderer (e.g. an `OrderListItem` component
      or a small render-prop helper) used by both the "Recent Orders" and
      "Needs Follow-up" cards.
- [x] Confirm dashboard renders identically (typecheck + visual check) — as
      a bonus, this also fixed a pre-existing inconsistency where the
      dashboard's Sent/Viewed tag colors didn't match the Orders table's.

---

## Phase 4 — Email template layout

**Problem:** `src/lib/email.ts` repeats the same header-table / button-table
/ footer-hr HTML markup across `buildHtml`, `buildRevisionHtml`,
`buildInviteHtml`, and the inline HTML in `sendStaffChangeRequestEmail`.

**Higher risk than the others** — hand-rolled HTML for email clients, easy to
break rendering in a way that only shows up when actually opened in an email
client (not just in tests, since tests only assert on substrings).

- [x] Extract a shared `wrapEmailLayout({ headerLabel, bodyHtml })` (or
      similar) helper in `email.ts` producing the common
      DOCTYPE/table/header/footer shell. Also extracted `emailButton()` and
      `emailCopyLinkLine()` for the button-table and "copy this link" line,
      each repeated 3-4 times identically.
- [x] Rewire `buildHtml`, `buildRevisionHtml`, `buildInviteHtml`, and
      `sendStaffChangeRequestEmail`'s inline HTML to use it.
- [x] Re-run `email.test.ts` (string-assertion tests) — passed unchanged
      since visible text doesn't change (16/16).
- [x] Visually spot-check at least one rendered email (e.g. render the HTML
      string to a file and open in a browser, since a real mail client isn't
      available here) to confirm layout didn't break — checked all 4
      templates (initial, revision w/ comment, invite, staff change-request).

---

## Phase 5 — API route boilerplate (auth / rate-limit / validation)

**Problem A:** `requireAdmin()` is byte-for-byte duplicated in
`src/app/api/admin/users/route.ts` and
`src/app/api/admin/users/[id]/route.ts`.

**Problem B:** The rate-limit-check → 429 response is the same shape in
`src/app/api/auth/login/route.ts`, `src/app/api/auth/2fa/verify/route.ts`,
`src/app/api/o/confirm/route.ts`, and
`src/app/api/o/request-changes/route.ts` — only the key prefix, limits, and
message string vary:
```ts
const rl = checkRateLimit(`<prefix>:${ip}`, N, windowMs);
if (!rl.allowed) {
  return NextResponse.json(
    { error: '...' },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1_000)) } },
  );
}
```

**Problem C:** The Zod validation-failure → 400 response (`parsed.success ===
false` → `{ error: 'Invalid request', details: parsed.error.flatten() }`) is
repeated near-identically across ~10 route handlers, including
`admin/orders/[id]/route.ts`, `admin/orders/route.ts`,
`admin/size-charts/[id]/route.ts`, `admin/orders/[id]/garments/route.ts`,
`admin/orders/[id]/garments/[garmentId]/route.ts`,
`admin/orders/[id]/garments/[garmentId]/sizing/route.ts`,
`o/confirm/route.ts`, `auth/accept-invite/route.ts`, and
`admin/users/[id]/route.ts`.

- [x] Move `requireAdmin()` into `src/lib/session.ts` (or
      `src/lib/api-auth.ts`) and import it from both admin/users route files.
- [x] Add a `rateLimitedResponse(key, max, windowMs, message)` helper (e.g. in
      `src/lib/rate-limit.ts`) returning `NextResponse | null`; rewire the
      four call sites.
- [x] Add a `badRequest(zodError)` helper (e.g. a new
      `src/lib/api-responses.ts`) for the validation-failure shape; rewire
      the ~10 call sites.
- [x] Confirm `npm run typecheck` and the affected route tests still pass.

Not included in this phase (separate, higher-risk follow-up if ever done):
the `NotFoundError`/`ConflictError`/`UserConflictError`/`LastAdminError`/
`SizeChartNotFoundError` → HTTP-status catch-block mapping repeated across
~5 files, and the `console.error(tag, err); return 500` tail repeated in
~15 files. The specific error classes differ per domain, so a generic
mapper adds indirection for modest savings — only worth it if already
touching these routes for the items above.

---

## Phase 6 — Upload validation helper

**Problem:** `src/app/api/admin/size-charts/route.ts` and
`src/app/api/admin/orders/[id]/garments/[garmentId]/images/route.ts` both
parse `formData` (catch → 400 "Expected multipart/form-data"), pull the
`file` field and check `instanceof File` (400 "Missing 'file' field"), check
`file.type` against an allow-list (400), check `file.size` against a max
(400), then `Buffer.from(await file.arrayBuffer())`. Only the allow-list
contents/max bytes/messages differ (20MB PDF/image vs 10MB image-only).

- [x] Extract a `parseUploadedFile(formData, { allowedTypes, maxBytes })`
      helper returning either `{ file, buffer }` or a `NextResponse` error —
      landed as `src/lib/uploads.ts`, alongside a `parseMultipartFormData()`
      helper for the also-duplicated formData-parse → 400 catch.
- [x] Rewire both route handlers to use it.
- [x] Re-run both routes' tests — this touches file-upload code paths, so
      verify behavior (accepted/rejected types, size limits, error
      messages) is unchanged — full suite green (437/437), including both
      routes' integration tests asserting on the exact 400 messages.

---

## Phase 7 — Date/currency formatting utility

**Problem:** The same `Intl`/`toLocaleDateString` options object
(`{ day: 'numeric', month: 'short', year: 'numeric' }`, locale `'en-NZ'`) is
duplicated across `src/app/admin/orders/OrdersView.tsx`,
`src/app/admin/size-charts/SizeChartsView.tsx`, and
`src/app/admin/users/UsersView.tsx`. Currency formatting
(`Number(amount).toLocaleString('en-NZ', { minimumFractionDigits: 2 })`) is
duplicated verbatim in `OrdersView.tsx` and `src/app/o/[token]/view.tsx`.

- [ ] Add `src/lib/format.ts` with `formatDate()` / `formatDateLong()` /
      `formatCurrency()`, centralizing the `en-NZ` locale choice.
- [ ] Rewire the table columns / display code in `OrdersView.tsx`,
      `SizeChartsView.tsx`, `UsersView.tsx`, and `view.tsx` to use it.
- [ ] Confirm rendered values are unchanged (typecheck + visual check of
      each table/page touched).

---

## Phase 8 — Client-side fetch/parse/throw helper

**Problem:** The pattern `const data = await res.json(); if (!res.ok) throw
new Error(data.error ?? '<fallback>')` is repeated 10+ times across
`ProfileView.tsx`, `UsersView.tsx`, `GarmentAccordion.tsx`,
`AcceptInviteView.tsx`, `LoginForm.tsx`, `TwoFactorForm.tsx`,
`SizeChartLinker.tsx`, and `SizingTable.tsx`, each wrapped in its own
try/catch/finally with different success-side effects.

- [ ] Add a narrow `apiFetch<T>()` / `postJson()` / `patchJson()` utility
      that does only the request + JSON-parse + throw-on-error mechanics —
      deliberately *not* folding in loading/state management (that's the
      same bigger-shape-mismatch territory as the deferred list-view hook
      below).
- [ ] Rewire the call sites above to use it, keeping each site's own
      try/catch/finally and success-side effects intact.
- [ ] Confirm typecheck passes and spot-check each rewired form/flow still
      handles both success and error responses correctly.

---

## Notes

- Each phase should keep `npm run typecheck` and `npm run test` green before
  moving to the next.
- Not in scope for now (lower confidence / bigger shape mismatch): the
  shared "fetch list + loading + debounced search" pattern across
  `OrdersView.tsx`, `UsersView.tsx`, `SizeChartsView.tsx` — each has
  different filter/pagination shapes, so a shared hook is a bigger, less
  clearly-net-positive change than the four above.
- Considered and rejected as too marginal: the inline input/button style
  objects duplicated between `LoginForm.tsx` and `TwoFactorForm.tsx` (only 2
  occurrences, below the 3+ bar used elsewhere in this list), and the
  `sizingRowSchema`-shaped fragments in `src/server/orders/contract.ts` vs
  `admin-contract.ts` (differ in nullability/optionality by design — create
  vs. patch shapes — so a shared fragment would force a coincidental
  resemblance into a real coupling).
