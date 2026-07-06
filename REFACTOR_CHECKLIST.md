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

## Notes

- Each phase should keep `npm run typecheck` and `npm run test` green before
  moving to the next.
- Not in scope for now (lower confidence / bigger shape mismatch): the
  shared "fetch list + loading + debounced search" pattern across
  `OrdersView.tsx`, `UsersView.tsx`, `SizeChartsView.tsx` — each has
  different filter/pagination shapes, so a shared hook is a bigger, less
  clearly-net-positive change than the four above.
