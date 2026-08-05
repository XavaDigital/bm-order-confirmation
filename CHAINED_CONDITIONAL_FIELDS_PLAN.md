# Chained conditional fields — implementation plan

**Task:** *"Chained conditional fields. e.g. numbers -> numbers front/numbers
back checkboxes"* (IMPROVEMENT_ROADMAP.md).

**Reading of the ask:** a garment-type option can gate other options — e.g. a
top-level "Numbers?" checkbox that, only when checked, reveals "Numbers
Front" and "Numbers Back" checkboxes. Today `GarmentTypeOption` is a flat,
independent list (`select` | `text`); nothing hides or reveals a field based
on another field's value, and there's no boolean/checkbox variant at all.

**Status:** plan only — no code changed yet.

---

## Scope decision

`GarmentTypeOption` is reused in two places (`src/db/schema.ts:566-568`):

1. **`orderOptions`** — per-garment-type options, filled in once per garment
   line item (staff-only editor: `GarmentsMasterDetail.tsx`).
2. **`sizingColumns`** — extra columns on the *sizing table*, filled in once
   per **size/name row** (`SizingTable.tsx`, admin only — the customer-facing
   `SizingTableReadOnly.tsx` only displays it).

The roadmap example ("numbers front/back") is a per-garment decision, not a
per-size-row one, and a table can't hide/show individual cells per row without
becoming a much stranger UI (some cells editable, some blank, per row, based
on another cell in the same row). So:

- **In scope:** conditional logic on `orderOptions`, edited in
  `GarmentsMasterDetail.tsx` and defined in `OrderOptionsManager.tsx`.
- **Out of scope (v1):** `sizingColumns`. The schema below is written so it
  *could* apply there unchanged later, but the sizing-table UI work is a
  separate follow-up, not bundled into this one.
- Customer surfaces (`/o/[token]`, roster pages) only ever *display*
  `selectedOptions` read-only today — they don't need conditional-rendering
  logic, just to keep rendering "whatever's in the map," which already works
  (see "Enforcement point" below).

## Data model changes

### 1. New `checkbox` option type

`src/db/schema.ts` — extend the union:

```ts
export type GarmentTypeOption =
  | { label: string; type: 'select'; options: string[]; defaultOption?: string; showWhen?: ConditionalRule }
  | { label: string; type: 'text'; defaultValue?: string; showWhen?: ConditionalRule }
  | { label: string; type: 'checkbox'; defaultValue?: boolean; showWhen?: ConditionalRule };

/** A field is shown only when the named parent option currently equals one of `equals`. */
export interface ConditionalRule {
  parentLabel: string;
  equals: string[]; // checkbox parent: ['true'] / ['false']; select parent: one or more of its option values
}
```

No DB migration needed — `orderOptions`/`sizingColumns` are already
untyped `jsonb`, so this is a TypeScript-level widening only. Existing rows
(no `showWhen`, no `checkbox` entries) remain valid as-is — purely additive.

### 2. Value representation stays a flat string map

`selectedOptions` stays `Record<string, string>`
(`selectedValuesSchema = z.record(z.string().max(300))` in
`src/server/orders/contract.ts`). A checkbox's value is stored as the string
`"true"` / `"false"`, not a JSON boolean. This is deliberate: every read site
downstream (customer view, PDF, PO xlsx, supplier portal) already does
`Object.entries(selectedOptions).filter(([, v]) => v)` over strings — keeping
checkboxes as strings means **zero changes** to any of those render sites.

### 3. Chain rule: parent must precede child, and chains resolve transitively

- Validation requires a `showWhen.parentLabel` to reference an option earlier
  in the same `orderOptions` array (by index) — this is the acyclic
  guarantee, for free, without a graph check: you cannot depend on something
  defined after you.
- Visibility is evaluated top-down: an option is visible iff it has no
  `showWhen`, **or** (its parent is currently visible **and** the parent's
  current value is in `showWhen.equals`). A hidden parent hides its children
  regardless of what value they'd otherwise match — this is what makes it
  "chained" rather than single-level.

## Validation changes

`src/server/garment-types/contract.ts`:

- Add `checkboxOptionSchema` (`type: z.literal('checkbox')`,
  `defaultValue: z.boolean().optional()`).
- Add `showWhen: z.object({ parentLabel: z.string(), equals: z.array(z.string()).min(1) }).optional()`
  to all three member schemas.
- Extend `garmentTypeOptionSchema`'s `discriminatedUnion` to
  `[selectOptionSchema, textOptionSchema, checkboxOptionSchema]`.
- Add a `superRefine` on `createGarmentTypeSchema.orderOptions` (array-level,
  not per-item, since it needs sibling context):
  - `showWhen.parentLabel` must match a **preceding** option's `label`
    (index check) — reject forward/self references.
  - if the parent is `type: 'select'`, every value in `equals` must be one of
    the parent's `options`.
  - if the parent is `type: 'checkbox'`, `equals` must be a subset of
    `['true', 'false']`.
  - if the parent is `type: 'text'`, reject — free text has no closed value
    set to gate on (keeps the feature well-defined; can be revisited later).
- Same `superRefine` added to `sizingColumns` for schema symmetry even though
  the UI won't expose it yet (cheap to keep both arrays honest, avoids a
  second schema fork if `sizingColumns` scope expands later).

## Enforcement point: strip hidden values on write, not on every read

`src/server/orders/service.ts` currently has three write sites for
`selectedOptions` (garment create ~L955-968, garment update ~L1004-1010, and
the type-apply path ~L409-420). Add one shared helper, e.g.
`resolveVisibleOptions(type: GarmentType, selectedOptions)` in
`src/server/garment-types/service.ts` (or a new small module,
`src/server/garment-types/visibility.ts`), that:

1. Walks `type.orderOptions` top-down.
2. Drops any key from the incoming map whose option is currently not visible
   per the chain (parent missing, unchecked, or set to a non-matching value).
3. Returns the pruned map.

Call it at all three write sites, mirroring the existing pattern where
`sizingRowSchema.customValues` already drops unknown labels (`contract.ts:40-42`,
"the garment's column definitions are the allowlist"). This is the same
allowlist idea, extended to *conditionally* allowed keys.

**Why enforce here instead of in every renderer:** every downstream consumer
(customer view `o/[token]/view.tsx`, `OrderPdf.tsx`, `PoPdf.tsx`,
`SupplierPoContent.tsx`, `xlsx.ts`) already renders "whatever's a truthy
value in the map" and does not know about garment-type option definitions at
all (some don't even load the `GarmentType` row). Stripping at write time
means a hidden child's stale value can never leak into a PDF or PO even if
the type's option config changes later — vs. re-deriving visibility at every
read site, which would require loading and threading the garment type
through five unrelated renderers for a feature none of them need to know
about.

## UI changes

### `OrderOptionsManager.tsx` (garment-type option editor)

- Add `'checkbox'` as a third `Answer type` radio choice (alongside
  `select`/`text`); its editor is just a `defaultValue` checkbox, no values
  list.
- Add an optional **"Show only when"** section:
  - A `Select` of eligible parents: options already added *above* this one
    in the list (client-side mirror of the index rule) whose type is
    `select` or `checkbox`.
  - If parent is `checkbox`: a `Radio.Group` of `Checked` / `Unchecked`.
  - If parent is `select`: a `Select mode="multiple"` over the parent's
    `options`.
  - Clears (and disables) if the chosen parent is later deleted or reordered
    below this option — same "listen for the modal re-seeding" pattern
    already used for the label/type re-seed effect.
- Table view: add a small "Condition" column/tag (e.g. `Shown if Numbers = ✓`)
  so an admin scanning the option list can see the chain without opening each
  row.

### `GarmentsMasterDetail.tsx` (order-entry, staff fills in a garment)

- `currentType.orderOptions.map(...)` (~L562) needs to become
  visibility-aware: compute the same top-down visible-set client-side
  (shared helper — export the pure function from
  `src/server/garment-types/visibility.ts` and import it here too, so the
  client and server never disagree about what "visible" means) and skip
  rendering hidden options.
- Add the `checkbox` render branch alongside the existing `select`/`text`
  branches (an antd `Checkbox`, storing `"true"`/`"false"` into
  `selectedOptions[opt.label]`).
- When a parent's value changes such that a child becomes hidden, clear the
  child's key from `currentOptions` in the same `setEdit` call — keeps local
  state consistent with what the server will persist, so the "Save" button
  doesn't silently drop something the user still sees on screen.
- `typeOptionDefaults()` (~L89-96) needs a `checkbox` branch
  (`defaultValue` boolean → `"true"`/`"false"`) and should itself run through
  the same visibility filter so a default doesn't pre-fill a hidden child.

## Suggested build order

1. Schema + contract (`schema.ts`, `garment-types/contract.ts`) — additive,
   safe to land alone, everything still parses as before.
2. `visibility.ts` pure helper + unit tests (parent-before-child ordering,
   transitive hide, select-vs-checkbox parent matching) — this is the part
   worth the most test coverage since it's shared client/server.
3. Wire the helper into `service.ts`'s three write sites + integration test
   (save a hidden child's value, assert it's dropped).
4. `OrderOptionsManager.tsx` editor UI.
5. `GarmentsMasterDetail.tsx` render + defaults wiring.
6. Manual pass through `npm run dev`: build a "Numbers?" checkbox with
   "Numbers Front"/"Numbers Back" checkbox children on a real garment type,
   confirm add-to-order, save, PDF, and customer view all behave — per
   CLAUDE.md, this is a UI change and needs a real dev-server check, not just
   typecheck/tests.

## Explicitly deferred / not part of this plan

- `sizingColumns` conditional support (per-row table UX problem, see Scope
  decision above).
- Multi-value `select` parents with OR/AND combination logic beyond "value is
  in this set" — not asked for, adds complexity for no known use case yet.
- Customer-editable options (customer surface is read-only for
  `selectedOptions` today; out of scope here, same boundary
  `GOT_YOUR_BACK_PLAN.md` already drew for customer-side line-item edits).
