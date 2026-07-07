# Feature Proposals — Light Additions

Not part of any committed roadmap phase — these are optional, low-effort additions
that reuse existing plumbing rather than introducing new architecture. Scoped
deliberately small to stay in keeping with this being a "light" internal tool,
not a full CRM.

---

## 1. Stale-order reminders

**Status: recommended variant done.** The "cheapest version" below shipped —
`getStaleOrders()` exists in `src/server/orders/service.ts:222` (using
`domain_events` as the staleness clock, per the gotcha below, not
`orders.updatedAt`) and the dashboard renders it
(`dashboard/page.tsx:42`). The cron/email variants remain unbuilt and
optional — only revisit them if the widget alone doesn't change follow-up
behavior.

**Problem:** Once an order is emailed to a customer (`status = 'sent'`), nothing
prompts staff to follow up if the customer never opens it, or opens it
(`status = 'viewed'`) and then goes quiet. Today the only way to notice is a
staff member manually scrolling the orders list.

**Why it fits:** The app already has every piece this needs — an outbox/cron
skeleton (Phase 7), an email sender, and a domain-events log. This is
almost entirely wiring, not new infrastructure.

### What exists today (reuse, don't rebuild)

- `src/db/schema.ts` — `orders.status` enum includes `'sent'` and `'viewed'`
  (`src/db/schema.ts:31-37`), and `orders.updatedAt` is bumped on both
  transitions (`src/server/orders/service.ts:411` for send,
  `src/server/orders/customer-service.ts:71` for first view). **Caveat:**
  `updatedAt` is also bumped by unrelated admin edits (see Gotchas below).
- `src/server/events/outbox.ts` — `domain_events` table already records
  `link.emailed` (written by `send-link/route.ts:48-57` via
  `recordAuditEvent`) and `order.viewed` (written by
  `customer-service.ts:71-80` via `emitDomainEvent`), both with `createdAt`
  timestamps. These are a more precise "clock start" than `updatedAt`.
- `src/server/events/processor.ts` — the existing outbox processor pattern
  (`EVENT_HANDLERS` registry, `processOutbox()`) is the batch-job shape to
  copy, but this feature is a **query over orders**, not an event handler, so
  it doesn't belong in this file — see "Where it lives" below.
- `src/app/api/internal/process-outbox/route.ts` — the cron-callable route
  pattern to copy: `isCronAuthorized()` / `isInternalAuthorized()` guard,
  called on a schedule.
- `src/lib/email.ts` — has `sendMagicLink`, `sendInviteEmail`,
  `sendStaffChangeRequestEmail`, `sendStaffConfirmationEmail` as templates to
  copy; needs one more: a reminder-to-customer or nudge-to-staff email.
- **Not yet wired:** there is no `vercel.json` in the repo, so
  `process-outbox` isn't actually on a schedule in production yet — it only
  runs if something (external cron, or a manual `curl`) calls it. Any
  reminder job has the same "needs an actual scheduler" dependency.

### Proposed implementation

1. **New query, not a new event type.** Add
   `getStaleOrders(thresholdDays: number)` to
   `src/server/orders/service.ts`, alongside `listOrders()`:
   ```sql
   -- conceptually
   SELECT * FROM orders
   WHERE status IN ('sent', 'viewed')
     AND updated_at < now() - interval '{thresholdDays} days'
   ```
   Threshold suggestion: 3 days for `sent` (never opened), 5 days for
   `viewed` (opened but didn't act) — configurable via a `REMINDER_THRESHOLD_DAYS`
   env var (single value) to keep it simple, rather than building a
   per-status config UI.

2. **New route:** `src/app/api/internal/send-reminders/route.ts`, mirroring
   `process-outbox/route.ts` exactly (same auth guard, same
   `POST`-only, same JSON result shape `{ checked, reminded }`). Keeping it
   as its own route (rather than folding into `process-outbox`) matches the
   existing separation of concerns: `domain_events` are point-in-time state
   changes, but "N days have elapsed" isn't an event, it's a scheduled scan.

3. **Idempotency guard — this is the part most likely to cause a bug if
   skipped:** without a "last reminded at" marker, the job would re-email
   the customer every time it runs (e.g. every day) for as long as the order
   stays stale. Two options, in order of preference for a light app:
   - Reuse the existing `domain_events` table: emit a new event type
     `'reminder.sent'` via `recordAuditEvent()` when a reminder fires, and
     have the query skip any order with a `reminder.sent` event newer than
     the threshold. Zero schema migration needed, and it shows up for free
     in the existing Audit Log tab (`AuditLogTab.tsx`) — just add an icon/label
     case there (`AuditLogTab.tsx:35,48,60` show the pattern for adding a new
     event type's icon/color/label).
   - Alternative: add a `lastReminderSentAt` column to `orders`. More
     explicit, but per CLAUDE.md's "migrations are additive" rule this is
     fine — just more moving parts than reusing `domain_events`.
   Recommend the `domain_events` approach: no migration, and it's exactly
   what the outbox already exists for.

4. **Recipient — decide staff nudge vs. customer nudge (or both):**
   - *Staff-facing* ("needs follow-up" list) is simpler and lower-risk: no
     new customer-facing email copy to get right, no risk of pestering a
     customer. Could ship as a dashboard widget alone, no cron required at
     all — see option below.
   - *Customer-facing* reminder email reuses `sendMagicLink`'s "isRevision"
     branch shape (`email.ts:178`) as a base — needs a fresh regenerated
     token (`generateAccessToken`, same as `send-link/route.ts:28`) if the
     original token may have expired.
   - Recommend starting staff-only; it's the smaller surface and the actual
     stated goal ("surfaces a needs-follow-up list") — add customer nudges
     later only if staff still aren't following up.

5. **Cheapest version — no cron at all:** if wiring a scheduler feels like
   too much for a light app, just add a **"Needs Follow-up" widget** to
   `src/app/admin/dashboard/DashboardView.tsx` that calls
   `getStaleOrders()` synchronously on page load (same pattern as the
   existing status-count query at `dashboard/page.tsx:12`, which already does
   `db.select({ status, count }).from(orders).groupBy(orders.status)`).
   This gets 80% of the value (visibility) with none of the scheduling
   complexity, no new email template, and no idempotency problem to solve.
   **This is the recommended starting point.**

### Gotchas to watch for

- `orders.updatedAt` is a poor staleness clock on its own — any admin edit
  (changing notes, garments, sizing) bumps it even though the customer's
  copy of the link is just as stale as before. If using `updatedAt`,
  staleness will under-count orders that were quietly edited by staff after
  being sent. Prefer deriving "last customer-facing action" from
  `domain_events` (`link.emailed` / `order.viewed`) instead of `orders.updatedAt`.
- If a customer-facing reminder email is added later, it must regenerate the
  token via `generateAccessToken` rather than reusing a stored one — tokens
  are stored hashed only (`src/lib/tokens.ts`), there is no way to recover
  the raw token to resend an old link.
- Rate limiting: a batch reminder job sending many emails at once could hit
  SMTP provider rate limits — worth a small delay/batch size cap if the
  order volume ever grows past a handful per run (`BATCH_SIZE = 20` in
  `processor.ts:20` is the existing precedent for batching).

---

## 2. One-click resend of the magic link

**Status: done.** A "Resend link" button was added to the order detail
header (`OrderDetailView.tsx`), next to "Download PDF", gated to
`currentStatus` being `sent`, `viewed`, or `changes_requested`. It calls the
existing `send-link` endpoint directly and carries a tooltip warning that
resending invalidates the previous link, matching the "Regenerate link"
button's treatment in `ShareLinkPanel.tsx`.

The functional piece already existed —
`ShareLinkPanel.tsx` (`src/components/admin/orders/ShareLinkPanel.tsx`) has an
**"Email to customer"** button (`ShareLinkPanel.tsx:179-188`) that calls
`POST /api/admin/orders/[id]/send-link` (`src/app/api/admin/orders/[id]/send-link/route.ts`),
which:
- Generates a brand-new token (`generateAccessToken`, revoking/replacing the
  old one implicitly),
- Emails it via `sendMagicLink()`, with revision-aware copy if the order is
  in `changes_requested` (`send-link/route.ts:30-46`),
- Records a `link.emailed` audit event (`send-link/route.ts:48-57`).

So "customer says they never got it" is already a real one-click action
today. What's missing is **discoverability**, not functionality:

### The actual gap

The button lives inside the **"Share Link" tab** of `OrderDetailView.tsx`
(`OrderDetailView.tsx:235-246`) — one of four tabs (Details, Garments, Share
Link, Audit Log). A staff member handling a "didn't get the email" support
request has to know to click into that specific tab first. There's no
affordance on:
- The main **Details** tab of the order (where staff land by default), or
- The **orders list** (`OrdersView.tsx`) — bulk resend isn't possible without
  opening each order individually.

### Proposed change (small, UI-only)

1. **Surface a "Resend link" button on the order detail header**, next to
   the existing "Download PDF" button (`OrderDetailView.tsx:286-297`, which
   already conditionally renders based on `currentStatus`). Same pattern:
   render a `Button` that calls the same `send-link` endpoint, gated to
   `currentStatus` being `sent`, `viewed`, or `changes_requested` (i.e. not
   `draft` — no link exists yet — and not `confirmed` — no need to resend
   after the customer already acted).
   - This can literally call the same `emailLink()` fetch logic already in
     `ShareLinkPanel.tsx:62-82` — either lift it to a small shared hook, or
     just duplicate the ~15 lines; for a light app duplication here is
     probably fine and avoids a premature abstraction for two call sites.
2. **Optional, if support requests are frequent enough to justify it:** add a
   row-level "Resend" action to `OrdersView.tsx`'s table (an extra column
   action button), so staff can resend without opening the order at all.
   This is more valuable than #1 if the common case is "customer emails
   support," staff searches the order by name in the list, and wants to act
   immediately — skip #1 and go straight here if that's the real workflow.
3. **No backend changes needed either way** — `send-link/route.ts` already
   does the right thing. This is purely "add a button that calls an
   endpoint that already exists," which is why it's the cheapest of the
   three proposals here.

### Gotchas to watch for

- Resending **always generates a new token and invalidates the old one**
  (per `ShareLinkPanel.tsx:120`'s existing warning copy: "this invalidates
  the current link the customer may already have"). If a customer has the
  page open in a tab when staff hit resend, their session token still works
  for viewing (nothing revokes access mid-session) — but if the customer
  hasn't confirmed and later tries the *original* emailed link again after
  staff resent, that old link now 404s. Worth a small confirm-tooltip on the
  new button (the "Regenerate link" button already has this via `Tooltip`,
  `ShareLinkPanel.tsx:168` — copy the same treatment).
- `send-link` 503s if SMTP isn't configured (`send-link/route.ts:16-21`) —
  make sure the new button surfaces that error the same way
  `ShareLinkPanel.tsx:67-70` already does, rather than a generic failure
  toast.

---

## 3. CSV export of the orders list

**Status: done.** `GET /api/admin/orders/export` (session-guarded, added since
the plain list `GET` had none) accepts the same `status`/`search` params as
the list endpoint, calls the new unpaginated `listOrdersForExport()`
(`service.ts`), and streams a hand-rolled CSV (`src/lib/csv.ts`) — RFC 4180
quoting plus formula-injection neutralization for customer-supplied cells.
"Export CSV" button added to `OrdersView.tsx`'s header, next to "New Order",
using the view's current status/search state as a plain `<a>` download.

**Problem:** Sales reporting currently means manually reading the orders
table in the UI. There's a per-order PDF export (`OrderPdf.tsx` +
`/api/admin/orders/[id]/pdf/route.tsx`) but nothing for the list as a whole.

**Why it fits:** `listOrders()` already has all the filtering/search logic a
report would want; this is a thin second consumer of that same function.

### What exists today (reuse, don't rebuild)

- `src/server/orders/service.ts:145-198` — `listOrders({ status, search,
  limit, offset })` already supports status filtering and free-text search
  across `customerName`, `orderNumber`, `clubName` (`ilike`, `service.ts:154-163`),
  and already returns exactly the columns a report needs: `orderNumber`,
  `customerName`, `customerEmail`, `clubName`, `status`, `orderValueAmount`,
  `orderValueCurrency`, `createdAt`, `confirmedAt`, plus a derived
  `hasActiveToken` (`service.ts:194-197`).
- `src/app/api/admin/orders/route.ts:6-20` — the existing `GET` handler is
  the direct precedent: read `status`/`search`/`limit`/`offset` from
  `searchParams`, call `listOrders()`, done.
- `src/app/api/admin/orders/[id]/pdf/route.tsx:9-59` — the exact response
  pattern to copy for file-download semantics: auth-check via
  `getIronSession`/`sessionOptions` (or the simpler `getSession()` used
  elsewhere), build the file body, return
  `new NextResponse(body, { headers: { 'Content-Type': ..., 'Content-Disposition':
  'attachment; filename="..."' } })`.
- `OrdersView.tsx:40-78` — the admin UI already has status tabs
  (`STATUS_TABS`) and a debounced search box; an export button can just
  reuse whatever `status`/`search` state is currently active in the view, so
  "export what I'm looking at" behaves intuitively.

### Proposed implementation

1. **New route:** `GET /api/admin/orders/export` (or `/csv`), same auth
   guard as `GET /api/admin/orders` (session check — note the existing `GET`
   handler at `orders/route.ts:6` currently has **no session/role check at
   all**, unlike `POST` which reads `session.userId` — worth adding one here
   regardless of this feature, since it's the same underlying data).
2. Accept the same `status`/`search` query params as the list endpoint, call
   `listOrders({ status, search, limit: <no cap or a high cap>, offset: 0 })`
   — the UI's `PAGE_SIZE = 20` (`OrdersView.tsx:50`) is a pagination
   convenience, not a real cap; the export should not be limited to one page.
3. Serialize rows to CSV. For a one-off like this, hand-rolling the
   serialization (join columns with commas, quote/escape fields containing
   commas or quotes) is reasonable and avoids a new dependency — but if
   correctness matters (customer/club names can contain commas, quotes, or
   newlines), a tiny well-tested library (`papaparse`'s `unparse`, or
   `csv-stringify`) removes a whole class of "report looks broken in Excel"
   bugs for minimal weight. Given this is a finance-adjacent export (order
   values), lean toward the library.
4. Return with:
   ```
   Content-Type: text/csv; charset=utf-8
   Content-Disposition: attachment; filename="orders-<date>.csv"
   ```
   (mirrors `pdf/route.tsx:51-58`'s header shape).
5. **UI:** an "Export CSV" button in `OrdersView.tsx`'s header (next to the
   existing "New order" button, `OrdersView.tsx` uses `FileAddOutlined`
   already — reuse the icon-button pattern) that builds the same
   `URLSearchParams` the view already constructs for fetching
   (`OrdersView.tsx:61-66`) and does a plain navigation/`<a href>` download
   rather than a `fetch` + blob dance — simplest possible approach, and
   avoids needing to handle the download client-side at all.

### Gotchas to watch for

- **Currency formatting:** `orderValueAmount` is a Postgres `numeric`
  (`schema.ts:93`), which Drizzle returns as a **string**, not a number —
  don't accidentally coerce it through `Number()` in a way that loses
  precision or mangles trailing zeros; pass the string straight through to
  the CSV cell.
  Confirm this against current Drizzle behavior for `numeric` columns before
  shipping — don't assume it's unchanged from when this was last checked.
- **CSV injection:** if any customer-supplied field (`customerName`,
  `clubName`) starts with `=`, `+`, `-`, or `@`, Excel/Sheets may interpret it
  as a formula when the CSV is opened. Since `customerName`/`clubName` are
  untrusted customer input per CLAUDE.md's "customer input is always
  untrusted" convention, prefix such cells with a `'` or a space, or reject
  formula-leading characters at serialization time. This is a real,
  well-known CSV export vulnerability class, not a hypothetical.
- **No pagination cap in the export path:** intentionally different from
  the list view's `PAGE_SIZE = 20` — make sure the export route doesn't
  accidentally inherit a default `limit` of 100 from `listOrders()`
  (`service.ts:151`, `opts?.limit ?? 100`) and silently truncate large
  exports. Pass an explicit high limit or add a `listOrders` variant that
  skips the limit entirely when exporting.
- **Auth:** as noted above, `GET /api/admin/orders` currently has no
  explicit auth check in the route handler itself (relies entirely on
  `middleware.ts` gating `/api/admin/**`, per CLAUDE.md's documented auth
  flow — authenticated-only, not role-checked). Confirm the export route
  is comfortable with "any authenticated staff member" per CLAUDE.md's
  documented current behavior (role enforcement is opt-in per-route), or add
  a role check if order-value data should be admin-only.

---

## 4. Fix: orders search doesn't actually cover email (despite promising to)

**Status: done.** `orders.customerEmail` added to the `or(...)` search clause
in `src/server/orders/service.ts`, with a regression assertion added to the
existing `listOrders` search test in `service.integration.test.ts`.

**This is really a bug wearing a feature's clothes** — flagging it here
rather than in `CODE_REVIEW_FINDINGS.md` because the fix is additive (widen a
search), not a hardening/correctness fix to existing guaranteed behavior.

**The mismatch:** `OrdersView.tsx:174` sets the search box placeholder to
`"Search by name, email or order number…"` — but the backend query it calls
doesn't match email at all. `listOrders()`'s search clause
(`src/server/orders/service.ts:156-162`) is:

```ts
opts?.search
  ? or(
      ilike(orders.customerName, `%${opts.search}%`),
      ilike(orders.orderNumber, `%${opts.search}%`),
      ilike(orders.clubName, `%${opts.search}%`),
    )
  : undefined,
```

`orders.customerEmail` is never referenced. Today, a staff member typing a
customer's email into the search box (because the placeholder told them to)
gets zero results for an order that definitely exists — a confusing, silent
failure with no error, just an empty table.

### Proposed fix

Add one line to the `or(...)`:

```ts
ilike(orders.customerEmail, `%${opts.search}%`),
```

That's the entire change. No migration, no new route, no UI change — the
placeholder text is already correct, only the query needs to catch up to it.

### Gotchas to watch for

- `customerEmail` has no index today (`schema.ts:89` — only `orders_status_idx`
  and the `orders_external_ref_uq` unique index exist, per `schema.ts:111-116`).
  An `ilike '%...%'` (leading wildcard) can't use a plain btree index anyway,
  so this doesn't change the app's indexing needs — just noting that email
  search will have the same "sequential scan" cost profile as the existing
  name/club search, which is already fine at this app's scale (a "light" app,
  per the brief) but worth knowing if the orders table ever grows to the
  tens of thousands of rows.

---

## 5. Dashboard: upcoming deadlines / ship dates widget

**Status: done.** `getDashboardData()` (`dashboard/page.tsx`) queries orders
with a non-null `deadlineDate` within a 14-day lookahead and status in
`sent`/`viewed`/`changes_requested` (drafts excluded, confirmed excluded),
ordered soonest-first. Rendered as an "Upcoming Deadlines" card in
`DashboardView.tsx` next to "Recent Orders", each row labelled "due in N
days" / "due today" / "overdue by N days" via local-midnight date-only
comparison (no timezone math on the underlying `date` columns).

**Problem:** `orders.expectedShipDate` and `orders.deadlineDate`
(`schema.ts:97-98`) are captured on every order but never surfaced anywhere
in the admin UI as a "what's coming up" view — they only appear buried in
each order's Details tab and the PDF export. Staff have no at-a-glance way
to see what's due soon across all orders.

**Why it fits:** Same shape as the existing dashboard queries — a read-only
aggregate query alongside the ones already in
`src/app/admin/dashboard/page.tsx:11-40` (status counts, total value, recent
orders, 7-day trend). No cron, no email, no new table.

### Proposed implementation

1. Add a `upcomingDeadlines` query to `getDashboardData()`
   (`dashboard/page.tsx:6`), following the exact pattern of the existing
   `recentRows` query (`page.tsx:19-30`):
   ```ts
   db.select({
     id: orders.id,
     orderNumber: orders.orderNumber,
     customerName: orders.customerName,
     clubName: orders.clubName,
     status: orders.status,
     deadlineDate: orders.deadlineDate,
     expectedShipDate: orders.expectedShipDate,
   })
     .from(orders)
     .where(and(
       lte(orders.deadlineDate, twoWeeksFromNow),
       ne(orders.status, 'confirmed'), // no need to chase a done deal
     ))
     .orderBy(asc(orders.deadlineDate))
     .limit(10)
   ```
   (`lte`/`asc`/`ne` all already imported elsewhere in the codebase from
   `drizzle-orm`, e.g. `customer-service.ts` for `ne`.)
2. Render as a new card in `DashboardView.tsx`, styled the same as the
   existing "Recent Orders" list — this is presentational-only, reusing
   whatever list/table component that view already uses for `recentOrders`.
3. Each row should link straight to `/admin/orders/[id]` (same as the recent
   orders list presumably already does) so a staff member can act on it in
   one click.

### Gotchas to watch for

- `expectedShipDate` / `deadlineDate` are Postgres `date` columns
  (`schema.ts:97-98`, no time-of-day, no timezone) — compare them against a
  date-only cutoff (e.g. `new Date().toISOString().slice(0, 10)` plus N days),
  not a full `Date` with a time component, or the boundary condition can be
  off by one depending on server-vs-browser timezone. This app already has
  date-only handling precedent in the customer confirmation snapshot
  (`customer-service.ts` passes `expected_ship_date`/`deadline_date` through
  unmodified) — don't introduce new timezone math here.
- Both date fields are **nullable** — many orders may have neither set
  (they're optional inputs on the create form). The query should tolerate
  nulls gracefully (Postgres `lte` against a null column is simply false /
  excluded, which is the desired behavior — nothing to special-case).
- Decide whether "upcoming" should include orders still in `draft` — probably
  not, since a draft hasn't been sent to the customer yet and isn't at risk
  of missing anything customer-facing; likely want `status IN ('sent',
  'viewed', 'changes_requested')` rather than just `!= 'confirmed'` as
  sketched above.

---

## 6. Sortable columns in the orders list

**Problem:** `OrdersView.tsx`'s table (`OrdersView.tsx:89-143`) has no
`sorter` on any column — Created date, Value, and Status all display in
whatever order the backend returns (currently always
`desc(orders.createdAt)`, `service.ts:187`). A staff member wanting to see
the highest-value orders first, or the oldest still-unconfirmed order, has
no way to do that without scrolling through every page.

**Why it fits:** Antd's `Table` already supports column sorting as a
built-in prop; this is UI + one query parameter, no new data.

### Proposed implementation

1. Scope to columns **already fetched** by `listOrders()`
   (`service.ts:167-178`: `status`, `orderValueAmount`, `createdAt`,
   `confirmedAt`) to avoid widening the query — add `sorter: true` (server-side
   sort mode) to the `Value` and `Created` columns in
   `OrdersView.tsx:89-143`.
2. Antd's `Table` `onChange` callback receives the active sorter
   (`{ field, order }`); wire that into a new piece of state alongside the
   existing `status`/`debouncedSearch`/`page` state (`OrdersView.tsx:46-50`)
   and include it in the `fetchOrders()` `URLSearchParams`
   (`OrdersView.tsx:61-66`), same pattern already used for `status` and
   `search`.
3. Extend `listOrders()`'s signature with `sortBy?: 'createdAt' |
   'orderValueAmount'` and `sortDir?: 'asc' | 'desc'`
   (`service.ts:145-150`), and swap the hardcoded
   `.orderBy([desc(orders.createdAt)])` (`service.ts:187`) for a small
   switch/lookup over the two sortable columns. Keep the lookup allow-listed
   (don't accept an arbitrary column name from the query string) — this is
   the one part of this feature with any real risk: an unvalidated `ORDER
   BY` column name from user input is a known SQL-injection-adjacent
   footgun even though Drizzle's query builder (not raw SQL string
   interpolation) makes actual injection unlikely here — validate against a
   fixed enum regardless, as defense in depth and to fail cleanly on a
   malformed request rather than a DB error.
4. Extend `GET /api/admin/orders` (`route.ts:6-20`) to read/forward
   `sortBy`/`sortDir` from `searchParams`, mirroring how `status`/`search`
   are already read there.

### Gotchas to watch for

- `orderValueAmount` is nullable (`schema.ts:93` — no `.notNull()`) and drawn
  from a Postgres `numeric` returned as a string by Drizzle; sorting a
  numeric-as-string column needs `ORDER BY` at the SQL level (which sorts
  correctly on the underlying numeric type, not lexicographically) —
  Drizzle's `orderBy(orders.orderValueAmount)` does this correctly since
  it's operating on the real column type, not the JS string representation,
  but if this were ever done client-side instead (sorting the already-fetched
  string values in JS) it would sort "100" before "20" — stay server-side.
- Keep this to 1–2 sortable columns rather than making every column
  sortable — `customerName`/`clubName` sorting is low-value (search already
  covers finding a specific customer) and just adds surface area for
  relatively little benefit in a light app.

---

## 7. Internal (staff-only) notes field

**Problem:** The only free-text notes field on an order is
`orders.generalNotes` (`schema.ts:100`), and it is **customer-facing** —
shown on the confirmation page (`view.tsx:446-449`) and in the exported PDF
(`OrderPdf.tsx:256-257`). There's nowhere for staff to jot something the
customer should never see — e.g. "customer called, wants to hold shipment,"
"discount approved by manager," "third reprint due to fabric issue." Today
that kind of note either goes in `generalNotes` (leaking to the customer, a
real risk) or lives outside the app entirely (Slack, email, memory).

**Why it fits:** One additive nullable column, shown only in the admin UI —
no cron, no email, no new route beyond extending the existing update path.

### Proposed implementation

1. **Migration (additive, per CLAUDE.md convention):** add
   `internal_notes: text('internal_notes')` to the `orders` table in
   `schema.ts` (near `generalNotes`, `schema.ts:100`), then
   `npm run db:generate` to produce the migration file in `./drizzle`
   (per `drizzle.config.ts:12`) and `npm run db:migrate` to apply it.
2. **Admin contract:** add `internalNotes: z.string().optional()` to the
   update schema in `src/server/orders/admin-contract.ts` (alongside the
   existing fields, mirroring how `generalNotes`/`status` are already
   optional there per `admin-contract.ts:16` for `status`).
3. **Do NOT add it to `src/server/orders/contract.ts`** (`createOrderSchema`)
   — that's the public `POST /api/orders` contract used by the future
   sales-platform integration (per CLAUDE.md's "integration seam" note), and
   internal notes should only ever be set by staff after the fact, inside
   the admin UI, never by an external caller.
4. **UI:** add a textarea to the Details tab of `OrderDetailView.tsx`
   (near wherever `generalNotes` is currently editable in `OrderForm.tsx`),
   clearly labeled "Internal notes (staff only, never shown to customer)" —
   the label matters here more than usual, since the whole point is avoiding
   the exact mistake of someone assuming it's private when it isn't (or vice
   versa).
5. **Confirm it's excluded everywhere customer-facing** — this is the one
   part worth being careful about, precisely because it's easy to forget one
   spot:
   - `customer-service.ts`'s `snapshot` object (`customer-service.ts:214-242`)
     already hand-picks exact fields from `order` rather than spreading the
     whole row — so a new `internalNotes` column is **safe by construction**
     here; it simply won't appear unless someone explicitly adds it.
   - `OrderPdf.tsx`'s props (`pdf/route.tsx:24-47`) are similarly hand-picked
     from `getOrderAdmin()`'s result — same safety-by-construction applies,
     just don't add `internalNotes` to the `pdfProps` object.
   - `getOrderAdmin()` itself (`service.ts:200+`) is only ever called from
     admin-authenticated routes, so returning the new column from that query
     is fine — the leak risk is entirely about which *consumers* of that
     data re-expose fields, not the query itself.

### Gotchas to watch for

- Because both `generalNotes` and the new `internalNotes` will sit next to
  each other in the Details tab, the biggest real risk is a staff member
  mistaking one field for the other and typing something private into the
  customer-facing one. Visually distinguishing them (e.g. a colored border
  or an icon on the internal one, not just a text label easy to skim past)
  is worth the extra few minutes given the cost of the mistake is a data
  leak to the customer.
- If an audit trail matters for internal notes edits, reuse the existing
  `order.updated` domain event (already emitted generically on any admin
  update — `service.ts:260-264`) rather than inventing a new event type;
  it already logs which fields changed via `Object.keys(patch)`.

---

## 8. Duplicate / "Create similar" order

**Problem:** Repeat customers (a club ordering the same kit again next
season, or a re-order with only sizing changes) require staff to rebuild the
entire order from scratch — every garment, every fabric note, every size
chart link — even when 90% of it is identical to a past order.

**Why it's listed last:** this is the heaviest of the additions here. It
touches the create-order path, needs a product decision about what *not* to
copy, and — unlike the others — can't be built as a thin read-only query or
a button wired to an existing endpoint. Treat it as a "nice to have," not a
quick win, and only build it if repeat orders turn out to be common enough
in practice to justify the effort.

### Proposed implementation

1. **New service function** `duplicateOrder(id: string, createdBy?: string)`
   in `src/server/orders/service.ts`, structured as `createOrder()`
   (`service.ts:64-136`) is: fetch the source order via `getOrderAdmin(id)`
   (already returns garments with sizing, images, and size-chart links —
   `service.ts:200+`), then run essentially the same insert transaction as
   `createOrder()`, sourcing values from the fetched order instead of a
   `CreateOrderInput`.
2. **New route:** `POST /api/admin/orders/[id]/duplicate`, following the
   auth/error-handling shape of every other admin order route (session
   check, `NotFoundError` → 404, generic catch → 500).
3. **UI:** a "Duplicate" button on the order detail header, next to
   "Download PDF" (`OrderDetailView.tsx:286-297`) — on success, navigate to
   the new order's edit page so staff can adjust customer details/sizing
   before sending.

### What NOT to copy (the actual design decision this feature hinges on)

- **Status, `confirmedAt`, `orderAccess` rows, `confirmations`,
  `conversionEvents`, and `domain_events`** — the duplicate is a brand-new
  order and must start at `status: 'draft'` with no token, exactly like
  `createOrder()` already does. Copying any of these would be a serious
  correctness bug (e.g. a duplicated order showing as pre-confirmed, or
  inheriting a live magic-link token that points at stale data).
- **Mock-up images** (`mockupImages.storageKey`) — storage keys are
  namespaced per-order (`mockupKey(orderId, garmentId, filename)` in
  `src/lib/storage.ts:59-61`), so simply copying the DB row's `storageKey`
  string into a new garment would point at the *original* order's S3
  object — deleting the original order's mock-up later would silently break
  the image reference for the duplicate. Either skip mock-ups entirely on
  duplicate (simplest, and often correct — a repeat order may need updated
  mock-ups anyway) or actually copy the underlying S3 object via
  `uploadFile`/a server-side S3 copy call keyed to the new order/garment
  IDs. Skipping is the "light app" answer.
- **`externalRef`** (`schema.ts:86`) — this ties an order to a record in the
  future sales platform (per CLAUDE.md's integration-seam note) and has a
  partial unique index (`orders_external_ref_uq`, `schema.ts:112-114`);
  copying it verbatim onto a new order would either collision-fail the
  insert or, worse, silently misattribute the duplicate to the wrong
  external record. Always leave it `null` on a duplicate.
- **Customer email/shipping address** — worth a product decision, not just
  a technical one: if the "same club, different season" use case is the
  primary motivation, keep customer name/email/club/shipping prefilled
  (staff edits only what changed — sizing, dates, value); if it's more often
  "someone asks for a near-identical order for a *different* customer,"
  those fields should be cleared and left for staff to fill in. Cheapest
  starting point: keep everything prefilled (matches "same customer,
  re-order" being the more common real-world case for this kind of
  business) and let staff clear fields that don't apply.

### Gotchas to watch for

- `orderNumber` must be freshly generated (`generateOrderNumber()`,
  `service.ts:48-50`) — never copied, since it's `unique()`
  (`schema.ts:82`) and the insert would fail outright if reused.
- Decide whether duplicating an order that's `changes_requested` should pull
  in the *latest* garment/sizing state (i.e. whatever staff already edited
  in response to the customer's feedback) — it should, since `getOrderAdmin`
  always reads current state, not a historical snapshot, so this happens
  automatically and doesn't need special-casing.

---

## 9. Fix: magic links never actually expire (dormant `expiresAt`)

**Another bug wearing a feature's clothes**, same family as #4. The expiry
machinery is half-built: enforcement exists everywhere, but nothing in
production code ever *sets* an expiry, so every check is vacuously true and
customer links live forever.

**The mismatch, verified:**

- `orderAccess.expiresAt` exists in the schema (`schema.ts:132`).
- It is **enforced in four places** — `service.ts:535`
  (`verifyAccessToken`-style lookup), `customer-service.ts:32`,
  `customer-service.ts:120`, and `customer-service.ts:176` all do
  `if (access.expiresAt && access.expiresAt.getTime() < Date.now()) return null`.
- But the only code that ever **writes** `expiresAt` is the seed scripts
  (`seed-demo.ts:210` etc. set 30 days). The two real insert sites —
  `createOrder()` at `service.ts:137` and `generateAccessToken()` at
  `service.ts:490` — insert `{ orderId, tokenHash }` and nothing else.

So a magic link emailed today is valid indefinitely. For an app whose brief
stores tokens hashed specifically so "a DB leak never exposes a live link"
(`schema.ts:127-129`), an unbounded link lifetime is out of step with its own
security posture: an old email forwarded months later still opens the order.

### Proposed implementation

1. Add `LINK_EXPIRY_DAYS: z.coerce.number().optional()` to `src/lib/env.ts`,
   following the existing optional-config pattern (`CRON_SECRET` at
   `env.ts:18`, `SMTP_HOST` at `env.ts:50`). Unset → no expiry → exactly
   today's behavior; this keeps the change zero-risk to roll out.
2. In both insert sites (`service.ts:137`, `service.ts:490`), compute
   `expiresAt: env.LINK_EXPIRY_DAYS ? new Date(Date.now() + days * 86_400_000) : null`
   — a shared 3-line helper next to `generateOrderNumber()` keeps the two
   sites in sync.
3. Suggested default once enabled: 30 days (matches what the seed data
   already assumes).

### Gotchas to watch for

- **Expired and invalid are indistinguishable to the customer today** — all
  four enforcement sites return `null`, which surfaces as the generic
  not-found state. That's acceptable for v1 (fail closed, no information
  leak), but the friendlier version — an "this link has expired, contact us
  for a fresh one" page — requires the lookup functions to return a
  discriminated result instead of `null`. Worth doing only if customers
  actually start hitting expiries; don't build it speculatively.
- Recovery is already one click: the "Resend link" header button (#2, done)
  and ShareLinkPanel's "Email to customer" both mint a fresh token. That's
  what makes this safe to turn on — an expired link costs the customer one
  email to support, not a stuck order.
- Existing `order_access` rows keep `expiresAt = null` and never expire.
  That's fine (additive, no retroactive breakage), but if a hard cutover is
  ever wanted, staff resending from the UI naturally rotates old tokens out.
- ShareLinkPanel already displays `tokenCreatedAt`
  (`ShareLinkPanel.tsx:113-117`) — once expiry is real, showing "expires
  {date}" in the same spot is a two-line follow-up that saves staff
  guessing why a customer says the link stopped working.

---

## 10. Customer confirmation receipt email

**Problem:** When a customer confirms, *staff* get an email
(`notifyStaffOfConfirmation`, wired as an outbox handler) — but the customer
gets nothing. Their only record of what they agreed to is the status page
they saw once, on whatever device they happened to confirm from. For an app
whose entire purpose is capturing a defensible "here's what was agreed"
moment (immutable snapshot, signature, IP — `confirmations`,
`schema.ts:235-250`), it's odd that only one side of the agreement gets a
copy.

**Why it fits:** This is the textbook use of the existing outbox — CLAUDE.md
literally describes the pattern as "Google Ads conversion is a consumer of
`order.confirmed`." This adds a third consumer to an array. No migration, no
new route, no cron changes.

### What exists today (reuse, don't rebuild)

- `src/server/events/processor.ts:55-58` — the `EVENT_HANDLERS` registry:
  `'order.confirmed': [handleGoogleAdsConversion, handleConfirmationEmail]`.
  The new handler is literally a third element in this array.
- `src/server/orders/notifications.ts:46-75` — `notifyStaffOfConfirmation`
  is the exact shape to copy: `isEmailConfigured()` guard (degrades
  gracefully when SMTP is unset), fetch the order, send. The customer
  variant is simpler — no staff lookup needed, `order.customerEmail` is
  right on the row.
- `src/lib/email.ts` — four senders exist (`sendMagicLink:170`,
  `sendInviteEmail:230`, `sendStaffChangeRequestEmail:268`,
  `sendStaffConfirmationEmail:327`); `sendMagicLink` is the only
  customer-facing one and shows the established customer-tone template to
  copy.

### Proposed implementation

1. `sendCustomerReceiptEmail()` in `email.ts` — order number, customer name,
   a short garment summary (names + quantities), confirmed-at date, and "if
   anything looks wrong, reply to this email." Keep it text-first like the
   existing templates.
2. `notifyCustomerOfConfirmation(orderId, orderNumber, confirmedAt)` in
   `notifications.ts`, copying the staff function minus the staff lookup.
3. Register it as a third handler on `'order.confirmed'` in
   `processor.ts:55-58`.

### Gotchas to watch for

- **Outbox failure semantics — the one real design point here.** The
  processor marks the *whole event* `failed` if *any* handler throws
  (`processor.ts:91-110`), and failed events are never retried —
  `processOutbox()` only selects `status = 'pending'` (`processor.ts:74`).
  So a customer-email bounce after Google Ads already fired would strand the
  event as `failed` with no retry. This is already true for the staff email
  today, so it's not a new class of bug — but adding a third handler raises
  the odds of hitting it. Cheapest mitigation: make the receipt handler
  best-effort (catch-and-log inside the handler rather than throwing) — a
  missed receipt is a shrug, not a stuck queue.
- **Don't include a magic link in the receipt.** The order is confirmed; the
  link's job is done. Minting a fresh token just for the receipt would churn
  `order_access` rows for zero benefit, and reusing the old one is
  impossible anyway (tokens are stored hashed, per #1's gotcha).
- Content-wise, everything in the receipt is data the customer has already
  seen on the confirmation page — no new exposure surface. Resist the
  temptation to attach the PDF (`OrderPdf.tsx` is admin-shaped, renders from
  live admin data not the confirmed snapshot, and attachment plumbing is new
  weight); a plain summary email is the light-app answer.

---

## 11. Cancel a dead order (add a `cancelled` status)

**Problem:** There is currently **no way to get a dead deal out of the
list.** The status enum (`schema.ts:31-37`) is `draft → sent → viewed →
confirmed / changes_requested` — no terminal "this isn't happening" state —
and `deleteOrder()` refuses anything past draft (`service.ts:351-358`,
`ConflictError: 'Only draft orders can be deleted'`, surfaced as a 409 by
`orders/[id]/route.ts:36-47`). So an order that was sent and then died
(customer ghosted, club folded, deal lost) sits in `sent`/`viewed` forever:
inflating the dashboard counts, polluting the now-live stale-orders widget
(#1) with orders staff have already written off, and keeping a live magic
link pointing at an order nobody intends to fulfil.

**Why it fits:** One additive enum value plus a small guarded transaction —
the same shape as the existing confirm/revoke flows. The draft-only delete
guard stays exactly as is (it's correct — sent orders have an audit trail
worth keeping; that's precisely why they can't be hard-deleted).

### Proposed implementation

1. **Migration:** add `'cancelled'` to the `order_status` enum. Postgres
   `ALTER TYPE ... ADD VALUE` is additive, satisfying the CLAUDE.md
   migration rule; `npm run db:generate` produces it from the schema change.
2. **Service:** `cancelOrder(id, meta)` in `service.ts`, as a guarded
   transaction copying `generateAccessToken()`'s shape (`service.ts:483-503`):
   - Conflict-guard: refuse if status is already `confirmed` (mirroring the
     existing confirm-race guard pattern) or `cancelled`.
   - Set `status: 'cancelled'`, bump `updatedAt`.
   - Revoke active tokens — the same
     `update(orderAccess).set({ revokedAt }).where(orderId, revokedAt is null)`
     block that `generateAccessToken` already runs (`service.ts:485-488`),
     so the customer's link immediately stops working.
   - `emitDomainEvent` with a new `'order.cancelled'` type, same call shape
     as `service.ts:498-502`.
3. **Route:** `POST /api/admin/orders/[id]/cancel` following the standard
   admin-route shape (session for `actorEmail`, `NotFoundError` → 404,
   `ConflictError` → 409).
4. **UI:** a "Cancel order" button in the `OrderDetailView` header behind a
   `Popconfirm` (the existing Delete button's treatment), shown for
   `sent`/`viewed`/`changes_requested`. Draft keeps its Delete button.

### Touch points (the real cost of a new status)

This is the part that makes it heavier than it looks — a new enum value
fans out to every place that switches on status:

- `OrderStatusBadge.tsx` — new color/label case.
- `OrdersView.tsx` `STATUS_TABS` — add a Cancelled tab (or fold into a
  filter; a tab matches the existing pattern).
- Dashboard counts map (`dashboard/page.tsx:45-53`) — add `cancelled`, and
  decide whether the headline **total value sum** (`dashboard/page.tsx:15-18`,
  currently sums *all* orders including drafts) should exclude cancelled —
  it almost certainly should, and arguably this feature is what makes that
  number honest for the first time.
- `getStaleOrders()` (`service.ts:222-233`) — already safe: it filters to
  `sent`/`viewed` only, so cancelled orders drop out of the widget
  automatically. This is half the point of the feature.
- `AuditLogTab.tsx:29-65` — icon/label/color for `'order.cancelled'`.
- The customer-facing side needs nothing: revoked tokens already surface as
  the not-found state.

### Gotchas to watch for

- **No un-cancel.** Resist building a "reactivate" path — it reopens every
  question about stale tokens and status history for a case that's rare by
  definition. If a cancelled deal revives, staff re-send a fresh link (which
  un-sticks the status via the existing draft→sent logic — verify the
  transition, or simply document "duplicate the order" (#8) as the revival
  path once that exists).
- `ALTER TYPE ... ADD VALUE` has a Postgres quirk: the new value can't be
  *used* in the same transaction that adds it (relevant if a future
  migration both adds the value and backfills rows — keep those as separate
  migration files). Adding the value alone, as here, is unaffected on
  Supabase's Postgres.
- Keep `POST /api/orders` (the public contract, `contract.ts`) untouched —
  external callers should never create or set a cancelled order; cancelling
  is a staff decision made after the fact.

---

## 12. Staff "last login" column

**Problem:** `UsersView.tsx` shows Name / Email / Role / Status / Active /
Joined (`UsersView.tsx:106-194`) — but nothing about whether an account is
actually *used*. An admin deciding whether to deactivate a departed
salesperson's account, or auditing after an incident, has no signal beyond
"joined eight months ago." For an app that already invested in 2FA, hashed
invite tokens, and a last-admin guard, "which accounts are dormant" is the
cheap missing piece of the same story.

### Proposed implementation

1. **Migration (additive):** `lastLoginAt: timestamp('last_login_at',
   { withTimezone: true })` on `staffUsers` (`schema.ts:60-75`), nullable —
   null reads naturally as "never logged in" for invited-but-inactive
   accounts.
2. **Stamp it in `loginStaff()`** (`src/server/auth/service.ts:21-33`): one
   `db.update(staffUsers).set({ lastLoginAt: new Date() })` after the
   password check passes. Fire-and-forget semantics are fine — a failed
   stamp shouldn't fail a login.
3. **UI:** one more column in `UsersView.tsx` next to "Joined"
   (`UsersView.tsx:188-189`), rendered with the same date formatting, with
   `—` for null.

### Gotchas to watch for

- **Where the stamp goes matters because of 2FA.** `loginStaff()` succeeds
  at the *password* stage; users with TOTP enabled aren't fully in until
  `/api/auth/2fa/verify` completes. Stamping in `loginStaff()` records
  "credentials verified" (fine for a dormancy signal, and one call site);
  stamping only after 2FA completion is more precise but needs the update
  in two places (password-only path and 2FA-verify path). For the stated
  purpose — spotting dead accounts — the `loginStaff()` stamp is enough;
  don't build the two-site version unless this ever feeds a real audit
  requirement.
- Don't add sorting/filtering on the column — at a staff table's size
  (single digits), eyeballing is fine, and #6's "keep sortable surface
  small" logic applies double here.

---

## 13. Per-order access code — finish or consciously drop `accessCodeHash`

**The situation:** `orderAccess.accessCodeHash` (`schema.ts:131`) was
designed in from the start — "only set when the optional per-order
confirmation code is enabled (default off)," per its own comment and BRIEF
§7 — but it is **completely dormant**: a repo-wide search finds no code that
writes it and no code that checks it. Unlike #9 (where enforcement existed
and only the write was missing), here *neither* side exists. The magic link
is the sole factor protecting an order page.

**Listed last on purpose:** this is the heaviest item in this document and
the only one that touches customer-facing UX flow. It's included less as a
recommendation and more so the dormant column doesn't sit unexplained
forever.

### If building it

1. Admin side: a "Require access code" toggle in `ShareLinkPanel` that
   generates a short numeric code, stores its hash (same SHA-256 + pepper
   pattern as `src/lib/tokens.ts`), and shows the raw code once — identical
   show-once semantics to the link itself. Staff relay the code out-of-band
   (phone/text), which is the entire security value: possession of the
   email alone stops being enough.
2. Customer side: when `accessCodeHash` is set, `/o/[token]` renders a code
   prompt before the order; on match (rate-limited — reuse
   `rateLimitedResponse`, the pattern in `request-changes/route.ts:12-14`),
   set a short-lived cookie or just gate per-request.

### If not building it

Also a legitimate outcome: the column is nullable, invisible, and
safe-by-construction (nothing reads it) — the honest move is a one-line
comment update in `schema.ts` marking it reserved-but-unimplemented, so the
next reader doesn't assume protection that isn't there. **Decide based on
whether any real order has ever needed more than link-possession security;
if that's never come up, leave it dormant.**

---

## Suggested order of implementation

**Done:** #4 (email search), #2 (resend button), #1's recommended variant
(stale-orders dashboard widget), #3 (CSV export), #5 (upcoming-deadlines
dashboard widget).

Remaining, roughly lightest to heaviest:

1. **Magic-link expiry** (#9) — a handful of lines across two insert sites
   plus one optional env var; no migration, and unset config preserves
   today's behavior exactly. Like #4 was, this is really a fix.
2. **Staff last-login column** (#12) — one additive column, one update
   statement, one table column.
3. **Customer receipt email** (#10) — no migration and pure
   pattern-copying, but it has email copy to write and the outbox
   failure-semantics decision to make.
4. **Sortable list columns** (#6) — small UI change plus one validated query
   parameter; slightly more surface than the widgets because it touches the
   shared `listOrders()` signature.
5. **Internal staff-only notes** (#7) — needs a migration and touches
   several consumers (even though each touch point is "make sure it's *not*
   there"), so more moving parts than anything above.
6. **Cancel a dead order** (#11) — the enum migration is trivial but the
   status fans out to every UI surface that switches on it; budget for the
   touch-point list, not the service function.
7. **Duplicate / "Create similar" order** (#8) — real product decisions to
   make (what to copy) and the most new surface area of anything here. Only
   worth building if repeat orders turn out to be common enough in practice.
8. **Per-order access code** (#13) — last, and possibly never; read that
    section's "if not building it" option before starting it.
