# Test Suite Checklist — Trustworthy Coverage

Tracks what's needed to go from "the critical paths are tested" to "the whole app is
tested." Check items off as they're addressed. Snapshot when this was written:
238 tests passing, ~48% statement / ~62% branch coverage project-wide (see `npm run
test -- --coverage`, config in `vitest.config.ts`).

Conventions to follow (match existing tests):
- Route/service tests that touch the DB are `*.integration.test.ts` and mock `@/db`
  with the PGlite-backed test db (`src/db/test-helpers.ts`).
- Session-gated routes mock `@/lib/session` with the in-memory Proxy pattern (see
  any existing `route.integration.test.ts` under `src/app/api/admin/**`).
- Pure-logic files (no DB, no session) are plain `*.test.ts`.

---

## 1. Admin order sub-resource routes (CRUD, all untested — high priority)

- [x] `src/app/api/admin/orders/route.ts` — list + create
- [x] `src/app/api/admin/orders/[id]/garments/route.ts` — add garment
- [x] `src/app/api/admin/orders/[id]/garments/[garmentId]/route.ts` — update/delete garment
- [x] `src/app/api/admin/orders/[id]/garments/[garmentId]/sizing/route.ts` — sizing rows
- [x] `src/app/api/admin/orders/[id]/garments/[garmentId]/images/route.ts` — upload mock-up image
- [x] `src/app/api/admin/orders/[id]/garments/[garmentId]/images/[imgId]/route.ts` — delete image
- [x] `src/app/api/admin/orders/[id]/audit/route.ts` — audit log read
- [x] `src/app/api/admin/orders/[id]/send-link/route.ts` — triggers `sendMagicLink`, role/state checks
- [x] `src/app/api/admin/orders/[id]/token/route.ts` — token regeneration
- [x] `src/app/api/admin/orders/[id]/pdf/route.tsx` — PDF export (renders `OrderPdf.tsx` via `@react-pdf/renderer`; verifies 200, `application/pdf` content-type, and `%PDF` magic bytes rather than snapshotting the full buffer). Getting this to import at all required registering `@vitejs/plugin-react` in `vitest.config.ts` — Vite's Rolldown-based SSR transform couldn't parse plain JSX in `.tsx` files without it (see item 9's note on Rolldown parse errors — this fixes that class of failure project-wide, not just this route).

## 2. Admin size-charts & users routes (untested — high priority)

- [x] `src/app/api/admin/size-charts/route.ts` — list + create
- [x] `src/app/api/admin/size-charts/[id]/route.ts` — update/delete
- [x] `src/app/api/admin/users/route.ts` — list + invite staff (role-gated: admin only per CLAUDE.md role notes)
- [x] `src/app/api/admin/users/[id]/route.ts` — update/deactivate staff

## 3. Auth routes not yet covered

- [x] `src/app/api/auth/logout/route.ts` — clears session
- [x] `src/app/api/auth/me/route.ts` — returns current session user
- [x] `src/app/api/auth/accept-invite/route.ts` — invite-token redemption, expiry handling

## 4. Customer-facing (`/api/o/**`, `/api/orders/**`) — must never leak cross-order data

- [x] `src/app/api/o/request-changes/route.ts` — customer change-request flow, triggers staff notification email
- [x] `src/app/api/orders/[id]/route.ts` — the external-platform-facing single-order read (`x-api-key` guarded)
- [x] Explicit negative test: confirm `/o/**` and `/api/o/**` routes cannot access another order's data via a wrong/guessed token (security-relevant, called out in CLAUDE.md) — see `src/server/orders/cross-order-access.integration.test.ts`

## 5. Internal/ops routes

- [x] `src/app/api/internal/process-outbox/route.ts` — outbox processor trigger endpoint
- [x] `src/app/api/health/route.ts` — trivial, but cheap to add

## 6. Untested lib/server units

- [x] `src/lib/storage.ts` — S3 signed URL generation; mock `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
- [x] `src/lib/password.ts` — thin bcrypt wrapper, quick unit test for hash/verify round-trip
- [x] `src/lib/session.ts` — `getSession()` itself isn't directly tested anywhere (only mocked away); consider one test that exercises the real iron-session path if feasible outside a request scope. Confirmed calling `cookies()` outside a Next.js request scope throws unconditionally, so that boundary is mocked, but `getIronSession` and the real `SESSION_SECRET`-based encrypt/decrypt round-trip run for real — see `src/lib/session.test.ts`.
- [x] `src/server/orders/notifications.ts` — order-event → email notification wiring (who gets notified for confirm vs. changes-requested, CC handling)

## 7. Component / UI tests (currently zero — no jsdom environment configured)

- [x] Add jsdom test environment + React Testing Library setup — added `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, and `jsdom` as devDependencies. `vitest.config.ts` now defines two `test.projects`: `node` (existing API/service tests, `*.test.ts`) and `jsdom` (component tests, `*.test.tsx`), sharing plugins/coverage config via `extends: true`. `vitest.setup.dom.ts` adds jest-dom matchers, RTL `cleanup()` after each test, and `matchMedia`/`ResizeObserver` polyfills antd needs under jsdom. Runs inside the same `npm test` / CI pass already (see item 9 below) — no separate command needed.
- [x] `OrderForm` (`src/components/admin/orders/OrderForm.tsx`) — validation, payload shape via `toApiPayload`
- [x] `GarmentAccordion` — add/remove garment rows
- [x] `ShareLinkPanel` — copy-link / resend interactions
- [x] `SizingTable` — inline edit/save
- [x] `SizeChartLinker` — linking a size chart to a garment
- [x] Customer confirmation view (`src/app/o/[token]/view.tsx`) — accept/request-changes UI states. `next/image` and `react-signature-canvas` are mocked (real `<canvas>` 2D context isn't available in jsdom); antd's static `message` API is spied on directly rather than asserted on rendered DOM, since its toast holder isn't reliably visible to RTL without an `<App>` wrapper.
- [x] `AppShell` nav — role-gated nav items (Users link admin-only, per CLAUDE.md)

## 8. End-to-end (Playwright is installed, zero spec files — decide priority)

- [ ] Golden path: admin creates order → sends link → customer opens `/o/[token]` → confirms
- [ ] Customer request-changes → staff notified → admin edits → customer re-confirms
- [ ] Staff login → 2FA setup → logout → login with 2FA → backup code fallback
- [ ] Role gate: sales user cannot reach admin-only pages/actions (e.g. Users nav)

## 9. Tooling / CI hardening

- [x] Add `coverage` script (`vitest run --coverage`) to `package.json` and wire into CI as a non-blocking report initially, then add `coverage.thresholds` once the gaps above are closed — CI step added with `continue-on-error: true`. Section 7 is now done and project-wide coverage moved from ~40% to ~52% statements as a result; thresholds are still deliberately not enabled yet — `MockupUploader.tsx`, `AuditLogTab.tsx`, `SizeChartStatusBadge.tsx`, and the customer-facing detail components below `CustomerOrderView` (`MockupGallery`, `SignaturePad`, `ShippingAddressField`, `SizingTableReadOnly`) still have low/no direct coverage since they weren't in this pass's explicit list — worth a follow-up before turning thresholds on.
- [x] Investigate/fix the Rolldown parse errors that currently exclude several `.tsx` files from the coverage report entirely (`OrderPdf.tsx`, `SizingTable.tsx`, `ShareLinkPanel.tsx`, `OrderDetailView.tsx`, admin order pages, the PDF route) — fixed by registering `@vitejs/plugin-react` in `vitest.config.ts` (it was already a project dependency but never wired in); confirmed `OrderPdf.tsx` and the PDF route now parse and report coverage correctly
- [x] Once section 7 exists, make sure the jsdom-environment tests run in the same `npm test` / CI pass without slowing down or destabilizing the node-environment integration tests (separate Vitest "project" is the standard way) — done via `test.projects` (`node` + `jsdom`) in `vitest.config.ts`; `npm test`, `npm run test:unit`, `npm run test:integration`, and `npm run coverage` all correctly include both projects with no separate command needed. Full suite (both projects) is now 419 tests across 58 files.

## 10. Minor cleanup found along the way (not a test gap, but noted)

- [x] `isPublicPath()` in `src/middleware.ts` is dead code — defined but never called (the real "is this public" check is `!needsAuth && !isLoginPage && !isTwoFactorPage`). Either wire it in or remove it so the code doesn't imply an allowlist that isn't enforced. — Removed rather than wired in: the real policy is deny-by-default (only admin paths need auth), not an allowlist, and `isPublicPath()`'s list didn't even fully match that policy, so wiring it in would have been the riskier change.
