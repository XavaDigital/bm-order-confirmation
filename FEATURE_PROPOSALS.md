# Feature Proposals — Light Additions

Not part of any committed roadmap phase — these are optional, low-effort additions
that reuse existing plumbing rather than introducing new architecture. Scoped
deliberately small to stay in keeping with this being a "light" internal tool,
not a full CRM.

---

## 1. Stale-order reminders

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

**Status: mostly already built.** The functional piece exists —
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

## Suggested order of implementation

Across everything in this document, roughly lightest to heaviest:

1. **Fix orders search to include email** (#4) — a one-line query change;
   arguably should just be done immediately rather than "proposed."
2. **CSV export** (#3) — smallest self-contained feature, no email/cron
   dependencies, immediate reporting value.
3. **Resend button on the Details tab** (#2) — UI-only change against an
   endpoint that already exists.
4. **Upcoming-deadlines dashboard widget** (#5) — read-only query, same
   shape as existing dashboard queries.
5. **Sortable list columns** (#6) — small UI change plus one validated query
   parameter; slightly more surface than the widget because it touches the
   shared `listOrders()` signature.
6. **Stale-order dashboard widget** (#1, cheapest variant only — skip the
   cron/email version for now) — same shape as the deadlines widget, listed
   after it only because it depends on reasoning about `domain_events`
   instead of a plain column.
7. **Internal staff-only notes** (#7) — needs a migration and touches
   several consumers (even though each touch point is "make sure it's *not*
   there"), so more moving parts than anything above.
8. **Duplicate / "Create similar" order** (#8) — save for last; real product
   decisions to make (what to copy) and the most new surface area of
   anything here. Only worth building if repeat orders turn out to be common
   enough in practice.
