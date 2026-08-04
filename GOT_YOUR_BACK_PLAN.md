# "Got Your Back" style orders — scoping notes

**Task:** *"Customers should be able to add 'Got Your Back' style orders with many
names. They can define the number of names and rows."*

**Status:** scoping only — no schema/contract/UI changes made. Confirmed against
`PROJECT_BRIEF.md`, `IMPROVEMENT_ROADMAP.md`, `FEATURE_PROPOSALS.md`,
`TEAM_ROSTER_PLAN.md`: none mention this. Genuinely new territory.

**Scope note:** "Got Your Back" here names a *print style* — one garment/design
carrying many names printed on the back, arranged in rows — native to this app.
It is **not** an integration with the separate `bm-gotyaback` fundraising-campaign
product; that app was only checked as a style reference, not as a data source.
No data crosses between the two apps.

---

## Settled shape

- **It's an additional garment, not a modifier on existing ones.** An order
  can have normal garments plus one (or more) "Got Your Back" garments, same
  as any other line item.
- **Staff decides the garment exists** — added in the admin order editor, same
  as every other garment today. There is no existing path for a customer to
  add a new line item to their own order mid-confirmation (the customer
  surface is read + fill-in-details + acknowledge + sign, never "add a
  product" — adding that would be new, unprecedented order-mutation
  capability and is explicitly **out of scope** here).
- **The confirming customer (or team manager) defines the name list and row
  count**, reusing names already collected via Team Roster rather than
  re-entering them. This is the key simplification below.

## What "Got Your Back" means here

A single garment/design whose back print is a **list of many names**, arranged
into rows for the artwork. Unlike Team Roster's normal use (one name per
*physical* garment — a row is a shirt: size + name + qty), here many names sit
on the **same** design; the count of physical shirts manufactured is a
separate number from how many names appear on the print.

## Why the name list can't just be `garment_sizing` rows

Team Roster already collects names via a shared link (`rosterMembers` +
`/o/roster/[rosterToken]`), but `garment_sizing` rows are not just labels —
they're manufacture units. `src/server/purchase-orders/xlsx.ts:222-223` sums
each row's `quantity` (defaulting to 1) straight into the PO's Qty column.
That's correct for Team Roster's cardinality (one row = one name = one
physical shirt, fanning out to many garments) but wrong for this feature's
cardinality (one garment, many names, one shared print — name count has no
relationship to shirt count). Writing name-list entries into `garment_sizing`
— even with `size = null` — would silently inflate the manufacture quantity
by one per name.

**So the two concerns stay in separate tables:**

- **Physical quantity to manufacture** — unchanged, ordinary `garment_sizing`
  rows with size + quantity (the existing "bulk unnamed stock" pattern, e.g.
  "Large x 20"), entirely independent of the name list.
- **The name list** (print content, not inventory) — a **new table**,
  `garment_name_list_entries`, deliberately with **no quantity column**.

## Why the name list is an independent copy, not a live join or a per-member submission

Earlier drafts of this plan tried to reuse Team Roster's *submission*
mechanism directly — each roster member individually "opting into" the
name-list garment the same way they submit a size for a normal garment. That's
more machinery than needed, and it fights the actual answer to "who defines
the list": **the confirming customer/manager does, in one place**, not N
separate people each independently checking in.

Since `rosterMembers` (name + playerNumber) is often already populated by the
time this garment matters, the right move is a **one-click "import from
roster"** action that bulk-copies current roster member names into
`garment_name_list_entries` as a starting point — then the manager freely
adds/removes/edits/reorders names and sets the row count, all before
confirming. This is an independent, editable copy from that point on, not a
live sync back to `rosterMembers` — consistent with how confirmation snapshots
elsewhere in this app are point-in-time copies, not live joins
(`orders.confirmedSnapshot`). It also means non-roster names (e.g. a sponsor
who isn't on the team) can be added freely, and someone on the roster who
doesn't want their name on the print can be left off.

**This drops the `writeMemberSizes`/roster-contract branching entirely** —
no per-member opt-in flow, no new roster submission path. Simpler than every
prior draft of this plan.

## Design summary

- **`garments` gets two new columns**, both additive:
  - `nameListEnabled boolean not null default false` — this garment carries a
    name list *in addition to* its normal (unrelated) manufacture-quantity
    sizing rows, e.g. "Large x 20" for the actual shirts, plus a name list
    with however many names for the print.
  - `nameListRows integer` (nullable) — the row count for the print layout,
    set by the confirming customer/manager. Columns are derived at
    render/print time (`ceil(count / rows)`), not stored.
- **New table `garment_name_list_entries`** (garmentId, name, playerNumber
  optional, sortOrder, createdAt) — no `size`, no `quantity`. No
  `rosterMemberId` FK needed since this is a one-time copy, not a live link.
- **"Import from roster" is a one-shot bulk-copy action**, not an ongoing
  sync — callable multiple times (e.g. re-import to pick up new roster
  signups), each import adding any roster names not already present rather
  than overwriting manual edits.
- **Staff can also seed/edit the list directly** in the admin garment editor —
  same convention as any other admin-editable, customer-reviewable field.

## Open decisions (still need a product call)

1. **Cap on total names?** Recommend reusing the shape of `MAX_ROSTER_MEMBERS
   = 100` (`IMPROVEMENT_ROADMAP.md` 2.3) as precedent — exact number TBD, a
   business call.
2. **Locked at confirmation?** Recommend yes, consistent with the rest of the
   order; post-confirm changes go through the existing "request changes" flow.
3. **Re-import behavior**, confirmed above as additive-only (skip names
   already present) — flag if overwrite-on-reimport is actually wanted
   instead.

---

## Sketch — Phase 1 (schema + contract, additive only)

```ts
// garments table additions
nameListEnabled: boolean('name_list_enabled').notNull().default(false),
nameListRows: integer('name_list_rows'),

// new table — print content, deliberately NOT quantity-bearing, NOT a live
// roster link (see "independent copy" rationale above)
export const garmentNameListEntries = confirmation.table(
  'garment_name_list_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    garmentId: uuid('garment_id')
      .notNull()
      .references(() => garments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    playerNumber: text('player_number'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('garment_name_list_entries_garment_idx').on(t.garmentId)],
);
```

Contract: a new Zod shape (e.g. `src/server/orders/name-list-contract.ts`) for
add/edit/remove/reorder entries + `nameListRows`, validated on both the admin
update path and the customer confirm-flow payload — same "one Zod contract,
two callers" convention as `orders/contract.ts` vs `admin-contract.ts`. The
"import from roster" action reads `rosterMembers` for the order and inserts
any `name` not already present in `garment_name_list_entries` for that
garment.

## Sketch — later phases

- **Phase 2:** admin UI — toggle `nameListEnabled` on a garment
  (`GarmentsMasterDetail.tsx`), `nameListRows` field, a name-list editor
  (add/edit/remove/reorder + "import from roster" button) shown **alongside**,
  not instead of, the normal sizing table for that garment — they track
  different things.
- **Phase 3:** customer-facing UI (`/o/[token]`, styled per
  `src/components/customer/`) — the same name-list editor, read/write for the
  confirming customer up until they confirm.
- **Phase 4:** print artwork export — rows×columns layout of the name list for
  the supplier, likely folded into existing PO/PDF generation (`OrderPdf.tsx`,
  `PoPdf.tsx`). The PO's Qty column keeps summing only `garment_sizing`,
  unaffected by name count.

## Effort

Small — one new (non-quantity) table, two new garment columns, one new
contract, and reuse of existing garment-editor UI patterns. No roster
submission-path changes needed. Rough shape: ~1 day across the phases above,
once the two remaining open decisions are answered.
