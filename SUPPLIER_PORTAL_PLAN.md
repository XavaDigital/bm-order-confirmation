# Supplier Portal — Implementation Plan

**Status: v1 implemented (2026-07-29).** Phases 1–6 below are done — schema, service layer, `/s/[token]` portal + `/api/s/**` routes, notifications, admin link management on `PoDetailView`, and test coverage (`src/server/supplier-portal/service.integration.test.ts`, plus assertions added to the existing PO send test). Full suite green (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`). Deviations from the original plan are called out inline below where they happened; the Open Questions at the bottom are still open and were deliberately left for a product decision, not a build gap.

**Origin:** feature request "Order Status Monitoring" (2026-07-29, transcribed from a voice memo — see conversation history, not yet in `PROJECT_BRIEF.md`). It asks for five things. A codebase check before this plan was written found that **three of the five already exist**; this doc scopes only the missing two, and calls out reuse points for everything already built so the new work stays additive and doesn't duplicate what's there.

---

## 0. What was requested, and what's already true today

| # | Ask | Status | Where |
|---|---|---|---|
| 1 | Order goes through production stages (prep → sent to factory → in production → shipped back), visible to the whole team, not opaque | ✅ **Already built** | The `purchase_order` workflow board is exactly this chain: `draft → sent → confirmed → pre_production → in_production → in_transit → received → completed` (`src/server/purchase-orders/contract.ts:13-24`, `canTransition` at line 52). Kanban UI at `/admin/workflow` (`src/components/admin/workflow/WorkflowBoard.tsx`), visible to every staff role — only "Users" is admin-gated in the nav (`src/components/admin/AppShell.tsx:38-96`). |
| 2 | Expose status + expected shipping/completion dates | ✅ **Already built** | `purchaseOrders.deadlineDate` / `expectedShipDate` / `actualShipDate` / `sentAt` / `receivedAt` (`src/db/schema.ts:848-852`); `shipments.etaDate` / `shippedAt` / `deliveredAt` (`src/db/schema.ts:912-914`). Dashboard "Upcoming Deadlines" widget already surfaces these. |
| 3 | Supplier-side view where a supplier can see an order sent to them, update its progress status, and add a comment | ❌ **Not built** | No supplier auth/token surface anywhere. **This plan builds it — Phases 1–5.** |
| 4 | Internal team gets notified when a supplier updates status, and can view that update | ❌ **Not built** — blocked on #3 | No supplier-originated event exists in the notification catalog. **This plan builds it — Phase 4.** |
| 5 | Move the shipment tracker from "another part of this platform" into this app | ⚠️ **Already exists natively here — premise is wrong** | `src/server/shipments/service.ts` + `contract.ts` is a complete shipment model already: carrier, tracking number/URL, box/piece counts, shipping cost, ETA, shipped/delivered timestamps, linked to one-or-more POs via `shipment_purchase_orders` (`src/db/schema.ts:897-944`). Full admin UI at `/admin/shipments`. **Action: confirm before porting anything — there is a real risk of building a second, competing shipment table.** If what they actually mean is a *live carrier-API tracking pull* (UPS/FedEx auto-refresh) rather than this manually-entered model, that's a distinct, smaller feature — see the Open Questions section at the bottom. |

So the real scope of this plan is: **a token-gated supplier portal** (mirroring the existing customer `/o/[token]` pattern) that lets a supplier view the purchase order sent to them, push it forward through a constrained subset of PO statuses, and leave a comment — plus the notification wiring so staff hear about it. Everything else that was requested is either done or needs a five-minute conversation, not a build.

---

## Design Summary

- **New surface, third alongside admin and customer**: `/s/[token]` (page) + `/api/s/**` (routes), no session — same "magic-link, no account" model as `/o/[token]` and `/o/roster/[rosterToken]`. Update the surfaces table in `CLAUDE.md` once this ships.
- **Token is scoped to one purchase order**, not to a supplier account. A supplier with three POs open gets three separate links (one per PO, e.g. included in the "send PO" email each time). This matches the existing `sendPurchaseOrder()` email step exactly — no new supplier login/identity concept, no password, no supplier user table. Simpler, and avoids ever needing to build supplier authentication.
- **Reuses the PO snapshot as the supplier's read model.** `PoSnapshot` (`src/db/schema.ts:822-830`) is already "the immutable content of what the supplier was sent" — garments, sizing lines, assets, notes, all with the supplier-safe factory deadline (never the customer-facing one — see the comment on `createPurchaseOrderSchema.deadlineDate`, `contract.ts:76-81`). The supplier page renders the **latest revision's** snapshot. No new DTO/mapper needed for the order content itself.
- **Reuses `order_notes` for the supplier's comment**, not a new table. `authorKind` is a plain `text` column with a TS union type (`'staff' | 'email_flow' | 'system'`, `src/db/schema.ts:261`) — **not** a Postgres enum — so adding `'supplier'` to the union is a one-line TS change, zero migration. `authorStaffUserId` stays null (already nullable) and `authorLabel` carries the supplier/PO identity (e.g. `"Acme Textiles (PO-2607-AC01)"`).
- **Status updates go through the existing `updatePurchaseOrderStatusTx`**, restricted to a supplier-safe subset of targets. Suppliers do not get the full `canTransition` matrix — they can move a PO **forward** through `confirmed → pre_production → in_production → in_transit`, but never into `sent` (that's staff re-sending), `received`/`completed` (staff must confirm physical receipt — that's the QC gate), or `cancelled`/`remake` (business decisions, not shop-floor updates). See Phase 2.2 for the exact list and rationale.
- **New, additive only**: `poSupplierAccess` table (same `accessTokenColumns()` shape as `order_access`/`roster_access`, scoped to `purchaseOrderId`); one new `authorKind` variant on the existing `order_notes` type; one new outbox event type `po.supplier_updated`; one new notification catalog entry. No destructive/renaming migrations, per `CLAUDE.md` convention.
- **Non-goals for v1**: no supplier login/password/account of any kind; no supplier visibility into other POs, the customer's identity/pricing, or any other order; no supplier-editable garment/sizing data (view-only there); no live carrier-API shipment tracking (separate ask, see Open Questions); no per-supplier notification preferences (suppliers don't receive in-app notifications — only staff do, via the existing notification system).

---

## Phase 1 — Schema & Token Foundation

**Goal:** DB shape and token primitives exist; nothing user-facing yet.

### 1.1 Schema changes (`src/db/schema.ts`)

Add alongside the other two access tables (after `rosterMemberAccess`, ~line 419), reusing the shared `accessTokenColumns()`:

```ts
// --- supplier portal access (magic link, scoped to ONE purchase order) -----
// Mirrors order_access/roster_access exactly. Scoped to purchaseOrderId (not
// supplierId) so a supplier with several open POs gets a separate link per PO
// — matches how sendPurchaseOrder() already emails one PDF per PO.
export const poSupplierAccess = confirmation.table(
  'po_supplier_access',
  {
    ...accessTokenColumns(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('po_supplier_access_po_idx').on(t.purchaseOrderId),
    uniqueIndex('po_supplier_access_one_active_uq')
      .on(t.purchaseOrderId)
      .where(sql`${t.revokedAt} is null`),
  ],
);
```

Register it in the `AccessTable` union in `src/server/access/tokens.ts:18` (`orderAccess | rosterAccess | rosterMemberAccess | poSupplierAccess`) so `resolveActiveToken`/`mintToken`/`revokeActiveTokens` work unmodified — this is the entire reason that module was written generically.

### 1.2 Widen `order_notes.authorKind` (no migration)

`src/db/schema.ts:261`:

```ts
authorKind: text('author_kind').notNull().$type<'staff' | 'email_flow' | 'system' | 'supplier'>(),
```

Plain TS union widen on a `text` column — confirmed not a pg enum, so this needs **no** `db:generate`/`db:migrate` step. Existing rows are unaffected.

### 1.3 New outbox event type (`src/server/events/outbox.ts:22`)

Add `'po.supplier_updated'` to `DomainEventType`, alongside the existing `po.*` block (~line 81-86).

### 1.4 Token helper (`src/lib/tokens.ts`)

```ts
export function buildSupplierPortalUrl(rawToken: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/s/${rawToken}`;
}
```

### 1.5 Migration

```bash
npm run db:generate   # review — additive only (new table, no ALTER on existing columns)
npm run db:migrate
```

### 1.6 Acceptance criteria

- [x] `po_supplier_access` table exists, one-active-per-PO unique index in place (`drizzle/0025_adorable_the_anarchist.sql`).
- [x] Generated migration contains no `DROP`/`RENAME`/`ALTER COLUMN` statements.
- [x] `order_notes` insert with `authorKind: 'supplier'` round-trips through existing `listOrderNotes`/`toNoteDto` with no changes needed there (verifies the union-widen assumption). One extra additive column landed in this phase too: `order_notes.visibility` (`drizzle/0026_glamorous_firebird.sql`), needed to resolve the Phase 2.4 open question below — see that section.

---

## Phase 2 — Supplier Service Layer

**Goal:** Token-gated read/write logic exists, callable from routes. No routes yet.

### 2.1 New module: `src/server/supplier-portal/` (mirrors `src/server/roster/customer-service.ts` — token-gated, no session)

| File | Purpose |
|---|---|
| `contract.ts` | Zod schemas: `updateSupplierPoStatusSchema`, `addSupplierCommentSchema` |
| `service.ts` | Token resolution + the two mutations below |

### 2.2 `service.ts` functions

- **`resolveSupplierPortalView(rawToken)`** — resolves the token via `resolveActiveToken(poSupplierAccess, rawToken)`, 404s (as `invalid_token`, matching the existing `/o/**` error-message convention) if missing/expired/revoked. Loads the PO + latest revision snapshot + supplier's own comments (see 2.4). Stamps `lastViewedAt` on the access row (same pattern `order_access` already uses for "viewed" tracking). Returns a `SupplierPortalViewDto`: PO number, status, factory deadline, expected ship date, the `PoSnapshot` content (garments/sizing/assets — **never** customer name, price, or the customer-facing deadline, none of which exist on `PoSnapshot` today anyway), supplier's own directory info, and the comment thread (supplier + staff replies, see 2.4).

- **`updateSupplierPoStatus(rawToken, nextStatus)`**:
  ```ts
  const SUPPLIER_ALLOWED_STATUSES: readonly PoStatus[] = [
    'confirmed', 'pre_production', 'in_production', 'in_transit',
  ];
  ```
  Rejects (`ConflictError`) any target outside that list — **before** even checking `canTransition`, so the error the supplier sees is "you can't set that status" rather than a generic transition failure. For an allowed target, delegates to the existing `updatePurchaseOrderStatusTx` inside a transaction (same function staff mutations already use — one status machine, one set of side effects like `sentAt`/`receivedAt` stamping), then emits `po.supplier_updated` (see 2.3) instead of relying solely on the `po.status_changed` event `updatePurchaseOrderStatusTx` already emits, so notification routing (Phase 4) can target "a supplier did this" distinctly from "staff did this."
  - Why not `received`/`completed`: those are the physical-QC checkpoint — a supplier claiming "received" is not the same fact as staff confirming stock arrived and matches the PO. Keep that a staff action.
  - Why not `sent`: that's staff re-sending after a revision, not a supplier-side act.
  - Why not `cancelled`/`remake`: business decisions with cost implications — a supplier should request these via comment, not self-serve them.

- **`addSupplierComment(rawToken, body)`** — thin wrapper over `addOrderNote(po.orderId, { body, authorKind: 'supplier', authorLabel: supplier.name, garmentId: null })` from the existing `notes-service.ts` (Phase 1.2 makes this legal). Reuses all existing sanitisation/audit/outbox behavior for free — `order.note_added` already fires and is already wired into the Audit Log and the notification catalog's `order.note_added` entry (`order_owner` + `entity_assignees`), so a supplier's comment is visible to staff **immediately**, even before Phase 4's dedicated event exists. Phase 4 only adds a *second*, PO-status-specific notification on top.

### 2.3 `po.supplier_updated` event payload

```ts
{
  poId: string;
  poNumber: string;
  orderId: string;
  from: PoStatus;
  to: PoStatus;
  supplierId: string;
  supplierName: string;
}
```

Emitted from `updateSupplierPoStatus` in the same transaction as the status write (same "stage + status in one transaction" discipline `CLAUDE.md` already mandates for staff-driven moves — no reason a supplier-driven move should be weaker).

### 2.4 Comment thread visibility

The supplier portal view reads the SAME `order_notes` thread the admin `NotesThread.tsx` component already renders (scoped `{ garmentId: null }`, i.e. the order-level thread), filtered to non-deleted rows. This means:
- A staff reply typed into the existing order notes box in `OrderDetailView` is automatically visible to the supplier next time they open their link — no separate "staff reply to supplier" feature needed.
- **Caution flagged for Phase 3**: because it's the same thread, any INTERNAL staff note (pricing negotiation, customer complaints, etc.) posted to the order-level thread would also become supplier-visible. Two options, pick one before shipping Phase 3:
  1. Add a `visibility: 'internal' | 'shared'` column to `order_notes` (additive, defaults to `'internal'` so nothing currently in the DB becomes supplier-visible retroactively) and have the supplier view filter to `visibility = 'shared'` only, with a UI toggle for staff when replying from the PO detail view.
  2. Give the supplier portal its **own** garment-scoped-style thread via `scopeFilter`-style isolation (e.g. a synthetic `garmentId`-like discriminator, or reuse the `NoteScope` mechanism with a new `'supplier'` scope value that's a genuinely separate row set).
  Option 1 is recommended — smaller, reuses the exact same thread UI component (`NotesThread.tsx` already takes props; add a `visibility` filter prop), and staff opt IN per note rather than a whole new isolated thread to keep in sync. **This is a decision needed before Phase 3 UI work starts** — flagged again there.

  **Decision made: Option 1.** `order_notes.visibility: 'internal' | 'shared'` (default `'internal'`), a supplier-authored note is always inserted `'shared'`, and `listOrderNotes()` gained an `opts?: { visibility: 'shared' }` filter the supplier-portal service passes. `NotesThread.tsx` got a "Visible to supplier on their portal link" checkbox in the composer (order-level thread only) and a "Shared with supplier" tag on notes staff opted in.

### 2.5 Acceptance criteria

- [x] `resolveSupplierPortalView` throws `Error('invalid_token')` on invalid/expired/revoked token — same message convention `/o/**` services use (routes map it to 404).
- [x] `updateSupplierPoStatus` rejects `received`, `completed`, `sent`, `cancelled`, `remake` with `status_not_allowed`; accepts the four allowed forward moves and respects `canTransition` ordering (`illegal_transition` on a backward/illegal move).
- [x] `addSupplierComment` produces a note visible in the admin Notes tab with `authorKind: 'supplier'` rendering distinctly (see 3.2) and `visibility: 'shared'` always.
- [x] Both mutations reject cleanly on a revoked/expired token (`resolveActiveToken` null → thrown `Error('invalid_token')`, mapped to 404 by the route). Covered end-to-end in `src/server/supplier-portal/service.integration.test.ts`.

---

## Phase 3 — Supplier Portal Routes & Page

**Goal:** The supplier can actually open a link and use it.

### 3.1 Routes (`src/app/api/s/`), all `auth: 'public'` via `defineRoute`, token in body (mirrors `/api/o/request-changes/route.ts` exactly)

| Route | Method | Purpose |
|---|---|---|
| `/api/s/status` | POST `{ token, status }` | Calls `updateSupplierPoStatus` |
| `/api/s/comment` | POST `{ token, body }` | Calls `addSupplierComment` |

**Deviation: no `/api/s/view` route.** `/o/[token]/page.tsx` doesn't have a matching `/api/o/view` route either — the customer page server component calls `getOrderForCustomer(token)` directly. `/s/[token]/page.tsx` follows the exact same pattern (`resolveSupplierPortalView(token)` called server-side), so a GET-equivalent API route would have been a pure duplicate. After a status update or comment, the client calls `router.refresh()` (Next.js App Router) to re-run the server component rather than re-fetching from a client-side GET.

Rate-limited with the existing `RATE_LIMITS.customerWrite` bucket (10/15min per IP) rather than a new `supplierWrite` preset — identical shape, and CLAUDE.md's own conventions favor not adding a preset that would be byte-for-byte the same as one that already exists.

### 3.2 Page: `src/app/s/[token]/page.tsx`

Server component, same shape as `src/app/o/[token]/page.tsx`: resolves the view server-side, 404s cleanly on an invalid token (never leak "token exists but revoked" vs "never existed" — same information-hiding the customer surface already does). Client view component (`SupplierPortalView.tsx`) shows:
- PO number, current status (reuse `PoStatusBadge.tsx` — already exists, already themed), factory deadline, expected ship date.
- Garments + sizing (read-only render of the `PoSnapshot`, reusing whatever garment-card rendering the PDF/admin PO view already factors out — check `PoDetailView.tsx` and `PoPdf.tsx` for a shared presentational piece before writing a new one).
- A status-update control offering only the `SUPPLIER_ALLOWED_STATUSES` as options, current status highlighted, forward-only (disable/hide any option `canTransition(current, target)` rejects).
- A comment box + thread (reuse `NotesThread.tsx` in read+shared-only mode — depends on the Phase 2.4 visibility decision).
- Uses BeastMode/MailFlow theme tokens (`src/lib/theme.ts`) — same visual system as customer + admin, per `CLAUDE.md`'s "do not re-hardcode colors" rule.

### 3.3 Acceptance criteria

- [x] Opening a valid link renders the PO with correct status options for its current state (`view.allowedNextStatuses` computed via `canTransition`).
- [x] Opening an invalid/revoked/expired link shows the customer-surface-style "Link Not Found" page (`src/app/s/[token]/not-found.tsx`) via `notFound()`, not a stack trace or a state leak.
- [x] Submitting a status update or comment calls `router.refresh()`, re-running the server component with fresh data.
- [x] No customer PII renders on this surface — `PoSnapshot` (the only order-content source this page reads) has never carried customer name/email/price/the customer-facing deadline; regression-tested for POs generally in `src/server/purchase-orders/service.integration.test.ts`'s "factory-facing data boundary" describe block, which this surface inherits by construction (same snapshot, same guarantee).

---

## Phase 4 — Notifications: staff hears about supplier activity

**Goal:** Piece #4 from the original ask — staff get notified, and can see the update in the existing systems (Audit Log, notification inbox).

### 4.1 Catalog entry (`src/server/notifications/catalog.ts`)

```ts
{
  key: 'po.supplier_updated',
  label: 'A supplier updates a purchase order',
  description:
    'Sent when a supplier moves a PO forward or leaves a comment through their portal link.',
  eventType: 'po.supplier_updated',
  defaultEnabled: true,
  defaultEmailEnabled: true,
  defaultRules: [{ kind: 'order_owner' }, { kind: 'po_creator' }],
},
```

`stage_owners` deliberately **not** included, despite that reasoning working for `workflow.stage_entered`: a supplier pushing a status forward is not necessarily a stage move (CLAUDE.md documents that a PO's status can change without the board updating), so the PO's recorded `workflowStageSlug` can be stale relative to a status the supplier just changed directly — resolving it correctly would need the same `resolveStage()` re-homing logic `board.ts` uses, which is more complexity than this notification needs. Same recipient set as `po.sent`.

### 4.2 Comment notifications piggyback on the existing `order.note_added` event

As noted in 2.2, `addSupplierComment` reuses `addOrderNote`, so the existing `order.note_added` notification already fires (`order_owner` + `entity_assignees` — `src/server/notifications/catalog.ts:62-69`). No new work needed here beyond making sure the in-app notification/email rendering distinguishes a supplier-authored note from a staff one (check `authorKind` in whatever template renders `order.note_added` — likely a small text-diff, e.g. "New comment from Acme Textiles" vs "New note from Jane").

### 4.3 Audit trail

`updatePurchaseOrderStatusTx` already writes a `po.status_changed` audit row (`src/server/purchase-orders/service.ts:443-451`) regardless of who called it — this needs **zero changes** to show up correctly in `getOrderAuditLog()`. Confirm the audit row payload or a companion event makes clear the actor was the supplier, not staff, so the Audit Log tab reads "Acme Textiles moved PO-2607-AC01 to In Production" rather than attributing it to nobody. Likely needs `actorEmail` on that audit call changed to a supplier-representing value, or a new `actorKind` field threaded through `recordAuditEvent` — smallest fix: pass `actorEmail: null` (as today) but rely on the paired `po.supplier_updated` event (which does carry `supplierName`) for the attribution the timeline shows, since `getOrderAuditLog` already merges outbox + audit sinks.

### 4.4 Acceptance criteria

- [x] A supplier status update produces exactly one `po.supplier_updated` outbox event (`src/server/events/processor.ts`'s `handlePoSupplierUpdatedNotification` dispatches it), separate from the `po.status_changed` event the underlying `updatePurchaseOrderStatusTx` still emits.
- [x] A supplier comment produces the existing `order.note_added` notification (unchanged path), and renders with a gold "Supplier" tag in `NotesThread.tsx` (`AUTHOR_KIND_TAG.supplier`).
- [x] The Audit Log tab shows the supplier's status change with correct attribution — `actorEmail` is set to `"{supplierName} (supplier portal)"` on the `po.supplier_updated` audit row (deliberately `aggregateType: 'order'`, matching every other PO audit call, since `getOrderAuditLog` filters strictly on that); `AuditLogTab.tsx` renders a `from → to` line and a dedicated gold tag for the event type.

---

## Phase 5 — Admin UI: generate/manage the supplier link

**Goal:** Staff can mint and revoke a supplier's portal link from the PO they already manage.

### 5.1 `PoDetailView.tsx` additions

- A "Supplier Portal Link" panel (mirrors `ShareLinkPanel`/`RosterLinkPanel` conventions already in the codebase) with generate / copy / revoke / regenerate actions, calling new admin routes:
  | Route | Method | Purpose |
  |---|---|---|
  | `/api/admin/purchase-orders/[id]/supplier-link` | POST | Generate/regenerate — mint via `mintToken(tx, poSupplierAccess, rawToken, eq(purchaseOrderId, id), { purchaseOrderId: id })` |
  | `/api/admin/purchase-orders/[id]/supplier-link` | DELETE | Revoke |
- **Auto-mint on send**: extend `sendPurchaseOrder()` (`src/server/purchase-orders/service.ts:510`) to mint a supplier link the first time a PO is sent (status `draft → sent`), and include `buildSupplierPortalUrl(rawToken)` in the supplier email body alongside the PDF — so the supplier gets their portal link the moment they get the PO, no separate staff step required for the common case. Manual regenerate/revoke stays available for edge cases (compromised link, supplier contact change).
- Comment thread visibility toggle per Phase 2.4's decision, if Option 1 (the `visibility` column) is chosen.

### 5.2 New `domain_events` types for the admin-side actions

`supplier_link.generated` / `supplier_link.revoked`, following the exact pattern `token.generated`/`token.revoked` already established — same Audit Log icon/label/color wiring.

### 5.3 Acceptance criteria

- [x] Sending a PO (first send OR resend) auto-generates a fresh portal link and includes it in the supplier email (`emailButton`/`emailCopyLinkLine` in `src/lib/email.ts`'s `sendSupplierPoEmail`). **Deviation from "first time only":** every send re-mints, matching TEAM_ROSTER_PLAN.md's already-accepted "regenerating invalidates the old link" tradeoff on its "Remind" action — simpler than tracking "has this PO ever had a link" separately, and a resend already means new content (a revision) is going out.
- [x] Staff can view/copy/revoke/regenerate the link from the PO detail view at any time (new "Supplier Portal" card in `PoDetailView.tsx`, `ShareLinkPanel`-style show-once copy UX).
- [x] Regenerating revokes the prior link (one-active-per-PO, enforced at the DB level by `po_supplier_access_one_active_uq`).

---

## Phase 6 — Hardening & Test Coverage

- [x] Rate limiting on both `/api/s/**` routes (`RATE_LIMITS.customerWrite`, see Phase 3.1 deviation note).
- [x] Integration tests in `src/server/supplier-portal/service.integration.test.ts` (11 tests): view happy path + comment visibility filtering (proves an internal staff note never reaches the supplier), `lastViewedAt` stamping, invalid/revoked token on all three service functions, allowed-vs-disallowed status transitions (including the runtime guard bypassing the Zod layer), illegal backward transition, token mint/rotate/revoke. Plus a `portalUrl` assertion added to the existing `send/route.integration.test.ts`.
- [x] `src/db/test-helpers.ts`'s auto-derived table list picked up `po_supplier_access` and the `order_notes.visibility` column with zero manual wiring — confirmed by the full integration suite passing.
- [x] Full suite: 1538 node-project tests + 549 jsdom-project tests passing (one pre-existing, unrelated flake in `dispatch.integration.test.ts`'s inbox-ordering test, not touched by this work). `npm run typecheck` and `npm run lint` clean (lint: only the two pre-existing warnings). **`npm run build`** succeeds — all new routes (`/s/[token]`, `/api/s/status`, `/api/s/comment`, `/api/admin/purchase-orders/[id]/supplier-link`) compile through the `.next/types` route validator.
- [x] `CLAUDE.md`'s "Two surfaces" table → "Three surfaces", with a `/s/[token]` / `/api/s/**` row.

---

## Open Questions (need a decision before/at the relevant phase)

1. **Comment visibility (Phase 2.4)**: internal-vs-shared note flag, or fully separate thread? Recommended: internal-vs-shared flag, defaulting to internal.
2. **Is "move the shipment tracker in" actually about live carrier-API tracking** (auto-refreshing status from UPS/FedEx/etc.), rather than the manually-entered shipment model that already exists in this app? If yes, that's new scope (a carrier API integration) worth its own plan — not covered here.
3. **Does the supplier need to see/set `shipments` data too** (e.g. confirm they've dispatched, provide a tracking number themselves) once a PO reaches `in_transit`? Not in this plan's v1 — flagged as a natural v2 extension once the portal exists, symmetrical to how Team Roster shipped a shared-link v1 before per-member tokens in v2.
4. **Link expiry for supplier links** — same `LINK_EXPIRY_DAYS` env var the other access tables already use, or should supplier links live for the life of the PO (which can span months of production)? Recommend: no expiry by default (`LINK_EXPIRY_DAYS` unset → `computeAccessExpiry()` already returns `null`), since a PO can be open far longer than a customer confirmation link's expected window.
