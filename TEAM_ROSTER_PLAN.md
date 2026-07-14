# Team Roster — Implementation Plan

**Problem:** Today, `garment_sizing` rows (size / player name / player number) are entered entirely by staff when they build an order. For team orders — where sizing info arrives messy, in different formats, and covers many people — sales shouldn't have to manually transcribe a roster, and the customer contact ("team manager") shouldn't have to be the one typing in everyone's size either. This plan adds a self-service **Team Roster** flow: the team manager supplies the roster (CSV/XLSX import or manual add), and team members fill in their own sizes against the same size charts customers already see, via a link the manager distributes.

This is new territory — no existing schema, contract, or route touches this today (confirmed against `PROJECT_BRIEF.md` and `FEATURE_PROPOSALS.md`, neither of which mention multi-person orders).

---

## Design Summary

- **v1 ships with one shared roster link per order** (not one link per team member). Anyone with the link opens `/o/roster/[rosterToken]`, sees the order's garments + linked size charts, picks their name from the manager-supplied list (or adds themselves if the manager didn't pre-load one), and submits their own size per garment.
- **v2 (later, optional)** upgrades to individual per-member tokens for a stronger audit trail and targeted reminder emails. It reuses the same `roster_members` table — only the access layer changes. Not required to ship v1.
- **Why shared-link first:** it's the smaller build (no per-member token minting/distribution/email step) and matches the "even one link" case directly. The tradeoff: anyone holding the link can technically edit any member's row — the same trust model as a shared Google Form. Acceptable for a team-internal roster link; the existing manager/confirmation link is *not* affected and keeps its current single-purpose scope.
- **Reuses, unmodified:** `garment_sizing` as the row shape (size/name/number/notes), the size-chart library and its customer-facing rendering, the existing acknowledgment/signature/confirm flow (`POST /api/o/confirm`), `src/lib/storage.ts`, `src/lib/rate-limit.ts`, `src/lib/email.ts`, the outbox (`domain_events`).
- **New, additive only:** `roster_members` table, `roster_access` table (separate from `order_access` — see rationale in Phase 1), a nullable `roster_member_id` FK on `garment_sizing`, a nullable `roster_locked_at` on `orders`. No destructive/renaming migrations, per `CLAUDE.md` convention.
- **Non-goals for v1:** no changes to the public `POST /api/orders` integration contract; no new `orders.status` values (roster progress is tracked separately so it can't be confused with the statuses `domain_events` consumers already key off); no AI-assisted column mapping (a manual mapping step is enough and safer); no per-member tokens (that's v2).

---

## Phase 1 — Schema & Token Foundation

**Goal:** DB shape and token primitives exist; nothing user-facing yet.

### 1.1 Schema changes (`src/db/schema.ts`)

```ts
// --- team roster members ----------------------------------------------------
export const rosterMembers = confirmation.table(
  'roster_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    playerNumber: text('player_number'),
    email: text('email'),
    sortOrder: integer('sort_order').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }), // null = pending
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('roster_members_order_idx').on(t.orderId)],
);

// --- roster shared-link access (separate from order_access, see 1.2) -------
export const rosterAccess = confirmation.table(
  'roster_access',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('roster_access_order_idx').on(t.orderId)],
);
```

Additive alterations to existing tables:

- `garment_sizing`: add nullable `roster_member_id uuid references roster_members(id) on delete cascade`. Rows with it set were submitted by a team member; rows without it are staff-entered, exactly as today. The two coexist in the same table with no conflict — a garment can have some staff rows and some roster rows.
- `orders`: add nullable `roster_locked_at timestamptz`. When set, roster endpoints reject further writes (see Phase 6). Deliberately **not** a new `orders.status` value — outbox consumers (Google Ads conversion, future production hand-off) key off `status`, and roster progress is an orthogonal concern that shouldn't risk colliding with that.

### 1.2 Why a separate `roster_access` table instead of reusing `order_access`

`generateAccessToken()` (`src/server/orders/service.ts:658`) revokes **all** prior active tokens on an order before issuing a new one. If the roster link shared the `order_access` table, the manager regenerating their own confirmation link would silently kill the whole team's in-progress roster link. A separate table keeps the two link lifecycles independent: regenerating the manager's link never touches the roster link, and revoking the roster link never touches the manager's.

### 1.3 Token helpers (`src/lib/tokens.ts`)

Reuse `generateToken()`/`hashToken()`/`tokensMatch()` as-is — same entropy and pepper are fine for this purpose. Add:

```ts
export function buildRosterUrl(rawToken: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/o/roster/${rawToken}`;
}
```

### 1.4 Migration

```bash
npm run db:generate   # review the generated SQL — must be additive only
npm run db:migrate
```

### 1.5 Acceptance criteria

- [x] `roster_members`, `roster_access` tables exist; `garment_sizing.roster_member_id` and `orders.roster_locked_at` are nullable and default to null.
- [x] Generated migration contains no `DROP`/`RENAME` statements.
- [x] Existing staff-entered-sizing flow (`upsertSizingRows`) is unaffected — full existing test suite still passes.

---

## Phase 2 — Roster Admin Service Layer & API

**Goal:** Staff can manage a roster (add/edit/remove members, generate/revoke the link, lock/unlock) through authenticated admin routes. No customer-facing surface yet.

### 2.1 New module: `src/server/roster/`

Mirrors the existing `src/server/orders/` split (`service.ts` for staff-authenticated writes, `contract.ts` for the Zod shapes, `customer-service.ts` added in Phase 5 for token-gated writes):

| File | Purpose |
|---|---|
| `src/server/roster/contract.ts` | Zod schemas: `addRosterMemberSchema`, `updateRosterMemberSchema`, `submitMemberSizesSchema` |
| `src/server/roster/service.ts` | Staff-side functions (list below) |

### 2.2 `service.ts` functions

- `getRoster(orderId)` — members + per-garment submitted status + completion count (`N of M submitted`).
- `addRosterMember(orderId, { name, playerNumber?, email? })`
- `updateRosterMember(memberId, patch)`
- `removeRosterMember(memberId)` — cascades its `garment_sizing` rows via FK.
- `generateRosterToken(orderId)` — same pattern as `generateAccessToken()`, but only revokes prior `roster_access` rows for that order (never touches `order_access`).
- `revokeRosterToken(orderId)`
- `lockRoster(orderId)` / `unlockRoster(orderId)` — set/clear `orders.roster_locked_at`.

Each write emits a `domain_events` row (extend `DomainEventType` in `src/server/events/outbox.ts:22` with `roster.member_added`, `roster.member_removed`, `roster.token_generated`, `roster.token_revoked`, `roster.locked`, `roster.unlocked`), following the exact pattern `token.generated`/`token.revoked` already use.

### 2.3 Admin API routes (`src/app/api/admin/orders/[id]/roster/`)

| Route | Method | Purpose |
|---|---|---|
| `/roster` | GET | List members + completion stats |
| `/roster/members` | POST | Add one member manually |
| `/roster/members/[memberId]` | PATCH | Edit name/number/email |
| `/roster/members/[memberId]` | DELETE | Remove member |
| `/roster/token` | POST | Generate/regenerate roster link |
| `/roster/token` | DELETE | Revoke roster link |
| `/roster/lock` | POST | Lock roster (blocks further customer-side writes) |
| `/roster/lock` | DELETE | Unlock |

All under existing `/api/admin/**` middleware (session-gated).

### 2.4 Acceptance criteria

- [x] Staff can add/edit/remove roster members via API; unauthenticated requests 401 (enforced by existing `/api/admin/**` middleware).
- [x] Generating a roster token doesn't revoke the order's confirmation token, and vice versa.
- [x] Locking sets `roster_locked_at`; unlocking clears it.
- [x] Every mutation produces a `domain_events` row visible in the existing Audit Log tab query (with dedicated icon/label/color).

---

## Phase 3 — Admin UI: Team Roster Tab (manual management)

**Goal:** Sales can manage a roster by hand end-to-end (no bulk import yet) from the existing order detail view.

### 3.1 Files

| File | Purpose |
|---|---|
| `src/components/admin/orders/RosterPanel.tsx` | New tab in `OrderDetailView` (alongside Details / Audit Log) — antd `Table` of members with status badges, inline add-member form, edit/remove row actions |
| `src/components/admin/orders/RosterLinkPanel.tsx` | Mirrors `ShareLinkPanel` — generate/copy/revoke roster link, lock/unlock toggle, "N of M submitted" progress |

### 3.2 Wire into order detail

Add "Team Roster" tab to `OrderDetailView` next to the existing Details/Audit Log tabs. Progress badge (`3/12 submitted`) also shown on the orders list row if useful, reusing the existing admin list table's column-add pattern.

### 3.3 Acceptance criteria

- [x] Staff can add members one at a time, see their submitted/pending state, edit or remove them.
- [x] Staff can generate a roster link, copy it, and revoke it independently of the customer confirmation link.
- [x] Lock/unlock toggle is visible and functional.

---

## Phase 4 — CSV / XLSX Bulk Import

**Goal:** Staff (or later, the manager — see Phase 6 note) can upload a messy CSV/XLSX and turn it into roster members without hand-typing.

### 4.1 Dependency

```bash
npm install exceljs papaparse
npm install -D @types/papaparse
```

**Revised from the original plan.** `xlsx` (SheetJS) would have been the one-dependency option, but the version published to npm (0.18.5, the latest available there) has unpatched high-severity advisories — prototype pollution and a ReDoS, both triggerable by a crafted input file — and SheetJS only ships patched builds through their own CDN, not npm. That's an unacceptable risk on exactly this feature's attack surface (parsing files uploaded by unauthenticated-ish users). `exceljs` (.xlsx) + `papaparse` (.csv) are both actively maintained, npm-published, and clean of comparable advisories — two dependencies instead of one, but neither carries a known unpatched CVE on the untrusted-input path. Trade-off: legacy binary `.xls` is no longer supported (`exceljs` only reads `.xlsx`/`.xlsm`) — acceptable since modern Excel/Sheets exports default to `.xlsx`; the upload UI rejects `.xls` with a clear message.

### 4.2 Parse server-side, not client-side

Uploaded files are untrusted input. Parse in a Route Handler, not in the browser: cap file size (e.g. 2 MB) and row count (e.g. 500 rows) before doing anything with the contents.

### 4.3 Two-step import (preview → commit) — files/sizes are messy, don't assume a fixed schema

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/orders/[id]/roster/import/preview` | POST | Upload file → parse → return detected headers + first ~10 rows + best-guess column mapping (e.g. header containing "name"/"player" → name column) |
| `/api/admin/orders/[id]/roster/import/commit` | POST | Given the same file plus a user-confirmed column mapping (`{name: 'Column B', playerNumber: 'Column D', email: null}`) → bulk-insert `roster_members`, skipping blank rows |

UI (`RosterImportModal.tsx`): upload → table preview with column-mapping dropdowns pre-filled from the best guess, user confirms/corrects → commit → modal closes into the now-populated `RosterPanel` list.

### 4.4 Acceptance criteria

- [x] A CSV and an XLSX file with arbitrary column order/names both import correctly after manual mapping confirmation. Verified live with a scrambled-column-order CSV (`Jersey #, Player Name, Contact Email`) — guessed mapping was correct, import produced the right rows.
- [x] Oversized files and files exceeding the row cap are rejected with a clear error, not a hang or crash.
- [x] Blank/malformed rows are skipped, not inserted as empty members. (Fully-blank lines are dropped at parse time; rows with data but a blank mapped-name cell are counted as `skippedBlank` at import time.)
- [x] Re-running an import doesn't duplicate members already added (dedupe on name, case-insensitive, both against existing members and within the same file — verified live: a repeated "Alex Player" row was skipped and reported as `skippedDuplicate`).

---

## Phase 5 — Customer-Facing Roster Page (self-service size entry)

**Goal:** Team members can open the shared link and submit their own sizes, without touching any admin surface or seeing other orders — matching the existing customer-surface trust boundary in `CLAUDE.md`.

### 5.1 Routes

Kept under the existing customer prefix so `CLAUDE.md`'s route table stays accurate:

| Route | Purpose |
|---|---|
| `src/app/o/roster/[rosterToken]/page.tsx` | Roster landing: member list (submitted/pending), "that's me" / "add my name", then per-garment size form with size-chart links (reuses the existing chart-preview modal from `view.tsx`) |
| `src/app/api/o/roster/[rosterToken]/route.ts` | GET — order summary scoped to roster needs only (club name, garments, size charts, member list). Deliberately excludes order value, invoice URL, shipping, notes — those stay manager-only. |
| `src/app/api/o/roster/[rosterToken]/members/route.ts` | POST — add self (only if manager hasn't disabled open add — see open question in Phase 8) |
| `src/app/api/o/roster/[rosterToken]/members/[memberId]/sizes/route.ts` | POST — submit/update this member's sizes across all garments in one call |

### 5.2 New module: `src/server/roster/customer-service.ts`

Mirrors `src/server/orders/customer-service.ts`'s token-gate pattern: hash incoming token → look up `roster_access` (not revoked, not expired) → touch `last_viewed_at`. Functions:

- `getRosterForMember(rosterToken)` — hydration for the landing page.
- `addSelf(rosterToken, { name, playerNumber?, email? })`.
- `submitMemberSizes(rosterToken, memberId, sizesByGarmentId)` — for each `{garmentId, size}`: upsert (update if a `garment_sizing` row already exists for `(garmentId, rosterMemberId)`, else insert). Rejects with a clear error if `orders.roster_locked_at` is set. Sets `roster_members.submitted_at = now()` on success.

### 5.3 Rate limiting

Apply `checkRateLimit()` (`src/lib/rate-limit.ts`) to the member-add and sizes-submit routes, same shape as the existing `/api/o/confirm` limiter (per-IP sliding window).

### 5.4 Acceptance criteria

- [x] Opening a revoked or expired roster link shows the same not-found/expired treatment the order confirmation page already uses for its token.
- [x] A member can select sizes against the linked size charts and save; reopening the link and resubmitting updates their existing rows rather than creating duplicates. Verified live: submitted a size, reloaded, form showed "Update my sizes" with the persisted value.
- [x] The roster API response never includes order value, invoice URL, shipping address, or general/internal notes. Verified live: landing page body has no NZD/invoice/shipping text.
- [x] Submitting after the roster is locked returns a clear "ask your rep" error, not a silent no-op.

---

## Phase 6 — Roster Lock & Handoff into the Existing Confirmation Flow

**Goal:** Once the roster is complete, the manager reviews it and proceeds through the **unchanged** acknowledgment/signature/confirm flow — this phase is purely about wiring the two together, no changes to `POST /api/o/confirm` itself.

### 6.1 Manager-facing review

The manager's existing `/o/[token]` confirmation page already renders `garment.sizing` read-only (`view.tsx:473`). No change needed there — once roster members submit, their rows appear in that same list automatically, indistinguishable in the UI from staff-entered rows (both are just `garment_sizing` rows). Add a small "via team roster" tag on rows where `roster_member_id` is set, for clarity.

### 6.2 Optional gate before confirm

Add a lightweight check on `/o/[token]`: if a roster exists for the order and has pending (not-yet-`submitted_at`) members, show a non-blocking banner ("3 team members haven't submitted their size yet") above the confirm button — informational only, does not block confirming, since the manager may intentionally proceed without 100% of the team.

### 6.3 Acceptance criteria

- [x] Roster-submitted sizing rows render identically to staff-entered rows on the manager's confirmation page, tagged by source ("via team roster" tag). Verified live.
- [x] `confirmations.confirmed_snapshot` (the immutable audit record) captures roster-submitted rows exactly like staff-entered ones — covered by `customer-service.integration.test.ts` ("includes roster-submitted sizing rows in the immutable confirmation snapshot").
- [x] Pending-members banner shows accurate counts and never blocks confirmation. Verified live on the manager's `/o/[token]` page.

---

## Phase 7 — Notifications, Reminders & Audit Trail

**Goal:** Reduce manual chasing — reuse the existing email infrastructure rather than building new send logic.

### 7.1 Email functions (`src/lib/email.ts`)

Add, following the existing `SendXParams` interface + function pattern (e.g. `sendMagicLink`, `src/lib/email.ts:171`):

- `sendRosterLinkEmail(params)` — manager-facing, sends the roster link (parallel to `sendMagicLink`).
- `sendRosterReminderEmail(params)` — to a single member with an email on file, resend the same shared roster link with a short "you haven't submitted your size yet" nudge.
- Optionally: notify the order's creator (`orders.created_by`, same lookup `notifyStaffOfConfirmation()` already does in `src/server/orders/notifications.ts`) when the roster hits 100% submitted.

### 7.2 Admin UI

"Email roster link" button on `RosterLinkPanel` (parallel to the existing "Email to customer" button on `ShareLinkPanel`). "Remind" action per pending member row that has an email on file.

### 7.3 Acceptance criteria

- [x] Roster link email and per-member reminder email both send via the existing SMTP config with no new env vars. Verified live — both buttons trigger real sends via the existing SMTP transport.
- [x] Members without an email on file simply don't get a "Remind" action (no crash, no silent failure). The button only renders when `!submittedAt && email` is true; server route also 400s defensively if called for a member with no email.

**Deviation from the original plan:** "Remind" regenerates the shared roster link (same tradeoff as "Regenerate link"/"Email roster link" elsewhere on this tab) rather than resending the exact previously-issued URL. The raw token is deliberately never persisted after creation (hashed-only storage, per Phase 1), so there is no stored raw value to resend without either keeping a secret around longer than intended or requiring the admin's browser to still hold it from the same session. Given v1's shared-link trust model already accepts "regenerating invalidates the old link," extending that same tradeoff to reminders was simpler and more consistent than threading client-held URL state through the panel.

---

## Phase 8 — Hardening & Test Coverage

**Goal:** Bring the roster feature to the same bar as the rest of the app before calling it done.

### 8.1 Tests (Vitest, mirroring existing conventions)

- Unit: `src/server/roster/service.ts`, `contract.ts` validation edge cases (empty name, oversized import, malformed rows).
- Integration (`*.integration.test.ts`, PGlite): full roster lifecycle — create order → generate roster link → add members via import → submit sizes via token → lock → confirm order → snapshot correctness.
- Route tests for every new `/api/admin/orders/[id]/roster/**` and `/api/o/roster/[rosterToken]/**` endpoint, same shape as existing `/api/o/confirm` tests (auth/token gating, rate-limit behavior, validation errors).

**Status: done.** Unit coverage for `contract.ts`/`import.ts` edge cases (empty name, oversized import, malformed/blank/ragged rows, corrupt buffer) already existed in `import.test.ts` and route-level 400 tests. Added `src/server/roster/lifecycle.integration.test.ts` — a single PGlite integration test chaining create order → import members → generate roster link → self-add → submit sizes for all members → lock → reject post-lock write → confirm order → assert the immutable snapshot contains all roster-submitted rows. Every route listed above already had a dedicated `*.route.integration.test.ts` (auth/token gating + validation errors); rate-limit tests were the one gap, filled in 8.2.

### 8.2 Security pass

- [x] Confirm the roster GET response never leaks order value/invoice/shipping/notes (Phase 5.4 already lists this — re-verify with a dedicated test, not just manual check). Dedicated assertions in `customer-service.integration.test.ts` (`getRosterForMember`) and `route.integration.test.ts` (`GET /api/o/roster/[rosterToken]`) check `orderValueAmount`/`invoiceUrl`/`shippingAddress`/`generalNotes`/`internalNotes` are absent from the response.
- [x] Confirm a revoked/expired roster token cannot read or write anything. Read path already covered (`getRosterForMember` returns null for revoked/expired). Added dedicated write-path tests: `addSelf` and `submitMemberSizes` each reject a revoked token with `invalid_token` (`customer-service.integration.test.ts`).
- [x] Confirm rate limits are active on both new customer-facing POST routes. Added `returns 429 with a Retry-After header after 10 requests` tests to both `members/route.integration.test.ts` and `members/[memberId]/sizes/route.integration.test.ts`, mirroring the existing `/api/o/confirm` rate-limit test.
- [x] Run `npm run typecheck && npm run lint && npm test` clean. Verified: typecheck clean, lint has only pre-existing unrelated warnings (no errors), full suite 105 files / 870 tests passing (up from 104/865 after adding the lifecycle + security tests above).

### 8.3 Docs

- [x] Update `CLAUDE.md`'s route table to add `/o/roster/[token]`, `/api/o/roster/**` under the Customer confirmation surface row (same auth model: token-gated, no session).
- [x] Note the new `src/server/roster/` seam alongside the existing `src/server/orders/` seam.

---

## Phase 9 — v2 (Future, Optional): Per-Member Individual Links

Not required to ship v1. Upgrade path once the shared-link model is in production and the audit-trail gap is actually felt:

- Add `roster_member_access` table (same shape as `roster_access`, scoped to `roster_member_id` instead of `order_id`).
- `generateMemberToken(memberId)` — mint on member creation (manual add or import row).
- `/o/roster/member/[memberToken]` — single-member page (skip the "pick your name" step entirely).
- Bulk "email everyone their individual link" action, using each member's `email` if present.
- Reminder emails become genuinely targeted ("you specifically haven't submitted") instead of a generic nudge.
- `roster_access` (shared link) can remain as a fallback for members without an email on file, or be retired — decide based on real usage.

**Status: implemented.**

- [x] `roster_member_access` table added (`src/db/schema.ts`), additive migration `drizzle/0007_burly_fallen_one.sql` generated and applied — no drops/renames.
- [x] `generateMemberToken(memberId, meta?)` added to `src/server/roster/service.ts`. **Deviation from the original plan:** tokens are minted on-demand (when staff copy a member's link, or when the bulk/targeted-reminder actions run) rather than eagerly at member-creation time. A creation-time mint would write a token row whose one-time raw value is never captured or used by anything — same "never store a raw token that can't be retrieved" principle already established in Phase 7's reminder tradeoff. Regenerating revokes only that member's previous token (verified: another member's token and the shared `roster_access` link are untouched). Emits a dedicated `roster.member_link_generated` event (kept distinct from the shared-link's `roster.token_generated` so the audit log doesn't conflate the two).
- [x] `/o/roster/member/[memberToken]` ships as a real page (`src/app/o/roster/member/[memberToken]/{page,view,not-found}.tsx`) with matching API routes (`src/app/api/o/roster/member/[memberToken]/route.ts` GET, `.../sizes/route.ts` POST, rate-limited like the shared-link equivalent). No "pick your name" step — the token resolves directly to one `roster_member_id`. Verified live: the rendered page shows only the one member's name and the order's garments, no manager-only fields, no other members.
- [x] Bulk "email everyone their individual link" — `POST /api/admin/orders/[id]/roster/email-links` mints a fresh token per member with an email on file and sends `sendRosterMemberLinkEmail` (new function in `src/lib/email.ts`), returning `{sent, skippedNoEmail, total}`. "Email everyone their link" button added to `RosterPanel.tsx`'s header row. Verified live: emailed 1 member, skipped 0, audit log shows `roster.member_link_emailed` with the member's name.
- [x] Reminders are now genuinely targeted: `.../members/[memberId]/remind/route.ts` now calls `generateMemberToken(memberId)` instead of regenerating the shared roster link, resolving the tradeoff documented in Phase 7 (the old behavior invalidated the whole team's shared link just to nudge one person). Verified live: the reminder response URL is `/o/roster/member/...`, not `/o/roster/...`.
- [x] **Decision on the last bullet: `roster_access` (shared link) is kept, not retired.** It's still required for self-add (people not yet on the pre-loaded list have no member token to begin with) and as a fallback for members without an email on file. No existing shared-link code path was changed.
- [x] A "Copy this member's individual link" action was added to each `RosterPanel.tsx` row (not explicitly listed in the original bullets, but a natural companion to the bulk-email action for staff who want to hand a link to one person directly, e.g. via text message).
- [x] Tests: unit/integration coverage added mirroring existing conventions — `generateMemberToken` (service.integration.test.ts), `getRosterForMemberByMemberToken` / `submitMemberSizesByMemberToken` (customer-service.integration.test.ts), route tests for the new GET/POST customer routes (including the 429 rate-limit case) and the new admin `link`/`email-links` routes, plus `RosterPanel.test.tsx` coverage for the two new UI actions. Full suite: `npm run typecheck && npm run lint && npm test` all clean (109 files / 898 tests). Verified live end-to-end via a real dev server run against the actual Supabase DB (order → member → mint link → render page → submit/resubmit sizes → bulk email → audit log), then the test order was deleted.

---

## Open Questions / Decisions Needed

1. **Can the manager themselves trigger a CSV/XLSX import**, or is import staff-only in v1? Phase 4 builds it as an admin route; extending `import/preview` + `import/commit` to the customer roster surface (manager-only, gated by the *order* confirmation token, not the roster token) is a small follow-on if wanted.
2. **Open self-add vs. manager-curated-only**: should team members be able to add themselves if they're not on the pre-loaded list (`POST /api/o/roster/[rosterToken]/members`), or should the manager be the only one who can add names? Affects whether 5.1's member-add route ships enabled or admin-toggleable per order.
3. **Roster size cap** — worth an explicit max (e.g. 100 members) to bound abuse/cost, separate from the import row cap in 4.2.
4. **Does the roster link need the same optional access-code gate** (`order_access.access_code_hash` equivalent) that order links already support, or is the link-only bar acceptable given it's an internal team-distribution link?

---

## Dependency Map

```
Phase 1 (schema/tokens)
   └─> Phase 2 (admin service/API)
          └─> Phase 3 (admin UI, manual)
                 └─> Phase 4 (bulk import)
          └─> Phase 5 (customer roster page) ──> Phase 6 (lock + handoff)
                                                        └─> Phase 7 (notifications)
Phase 8 (hardening/tests) — threaded through, finalized after 1-7
Phase 9 (v2 per-member links) — independent, after v1 is live
```

## npm Packages to Add

| Package | Phase | Purpose |
|---|---|---|
| `xlsx` | 4 | Parse CSV + XLSX/XLS roster uploads server-side |
