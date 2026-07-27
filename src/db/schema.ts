/**
 * Database schema — mirrors PROJECT_BRIEF.md §6.
 *
 * Everything is namespaced under the `confirmation` Postgres schema so it can
 * coexist with the future shared sales-platform tables (BRIEF §15).
 */
import { sql, relations } from 'drizzle-orm';
// Type-only import — erased at runtime, so no module cycle with the outbox.
import type { DomainEventType } from '@/server/events/outbox';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  date,
  inet,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const confirmation = pgSchema('confirmation');

// --- enums -----------------------------------------------------------------
export const staffRole = confirmation.enum('staff_role', ['sales', 'admin']);
export const orderSource = confirmation.enum('order_source', [
  'internal_admin',
  'platform',
]);
export const orderStatus = confirmation.enum('order_status', [
  'draft',
  'sent',
  'viewed',
  'confirmed',
  'changes_requested',
  'cancelled',
]);
export const shippingMode = confirmation.enum('shipping_mode', [
  'prefilled',
  'customer_entered',
  'later',
]);
export const signatureType = confirmation.enum('signature_type', [
  'drawn',
  'uploaded',
  'none',
]);
export const conversionStatus = confirmation.enum('conversion_status', [
  'pending',
  'sent',
  'failed',
]);
export const eventStatus = confirmation.enum('event_status', [
  'pending',
  'delivered',
  'failed',
  'dead',
]);
export const poStatus = confirmation.enum('po_status', [
  'draft',
  'sent',
  'confirmed',
  'pre_production',
  'in_production',
  'in_transit',
  'received',
  'completed',
  'remake',
  'cancelled',
]);
export const shipmentStatus = confirmation.enum('shipment_status', [
  'pending',
  'in_transit',
  'delivered',
  'delayed',
  'exception',
  'cancelled',
]);

// --- staff users -----------------------------------------------------------
export const staffUsers = confirmation.table(
  'staff_users',
  {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: staffRole('role').notNull().default('sales'),
  isActive: boolean('is_active').notNull().default(true),
  inviteTokenHash: text('invite_token_hash'),
  inviteTokenExpiresAt: timestamp('invite_token_expires_at', { withTimezone: true }),
  // Forgot-password self-service reset (separate from invite fields above —
  // resetting a password must never re-activate a deactivated/pending account).
  resetTokenHash: text('reset_token_hash'),
  resetTokenExpiresAt: timestamp('reset_token_expires_at', { withTimezone: true }),
  // TOTP-based 2FA
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  totpBackupCodes: jsonb('totp_backup_codes').$type<string[]>(),
  // Stamped on successful password verification (loginStaff). Null = never logged in.
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  },
  (t) => [
    index('staff_users_invite_token_idx').on(t.inviteTokenHash),
    index('staff_users_reset_token_idx').on(t.resetTokenHash),
  ],
);

// --- orders ----------------------------------------------------------------
export const orders = confirmation.table(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    // who created it; lets a platform-originated order be told apart (BRIEF §15)
    source: orderSource('source').notNull().default('internal_admin'),
    // the order/quote id in the future sales platform
    externalRef: text('external_ref'),

    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    customerContact: text('customer_contact'),
    clubName: text('club_name'), // shown on order page + internal; not required by conversion

    orderValueAmount: numeric('order_value_amount', { precision: 12, scale: 2 }),
    orderValueCurrency: text('order_value_currency').notNull().default('NZD'),
    invoiceUrl: text('invoice_url'),

    expectedShipDate: date('expected_ship_date'),
    deadlineDate: date('deadline_date'),

    generalNotes: text('general_notes'), // shown to the customer (confirmation page + PDF)
    internalNotes: text('internal_notes'), // staff-only; never shown to the customer
    shippingMode: shippingMode('shipping_mode').notNull().default('prefilled'),
    shippingAddress: jsonb('shipping_address').$type<Record<string, unknown>>(),

    status: orderStatus('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => staffUsers.id),

    // Set while a team roster (see roster_members/roster_access) is locked for
    // review/finalization. Deliberately not folded into `status` — outbox
    // consumers key off status, and roster progress is orthogonal to it.
    rosterLockedAt: timestamp('roster_locked_at', { withTimezone: true }),

    // Set when the customer, at confirmation time, asked for a colour book /
    // physical sample for colour matching before production (BRIEF §5 ack 2,
    // §11). Production must hold until this is resolved with the customer.
    colorSampleRequestedAt: timestamp('color_sample_requested_at', { withTimezone: true }),

    // Sales Hub (bm-sales) CRM association. A plain uuid HINT, not a FK —
    // separate databases, and the hub merges duplicate customers (a stored id
    // can become a tombstone; re-stamp to the survivor on read). Non-unique:
    // one customer places many orders. Name is denormalized so the admin chip
    // renders without a hub round-trip.
    hubCustomerId: uuid('hub_customer_id'),
    hubCustomerName: text('hub_customer_name'),

    // Set when this order was created as a REPRINT of another (a repeat job).
    // A real self-FK (same table, same DB, so it can be enforced — unlike
    // hubCustomerId which is a cross-database hint). `set null` rather than
    // cascade: deleting the original must never delete the reprint.
    sourceOrderId: uuid('source_order_id').references((): AnyPgColumn => orders.id, {
      onDelete: 'set null',
    }),
    reprintReason: text('reprint_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('orders_external_ref_uq')
      .on(t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    index('orders_status_idx').on(t.status),
    index('orders_hub_customer_idx').on(t.hubCustomerId),
    // List default sort + dashboard reads
    index('orders_created_at_idx').on(t.createdAt),
    index('orders_deadline_idx').on(t.deadlineDate),
    index('orders_created_by_idx').on(t.createdBy),
    index('orders_color_sample_idx')
      .on(t.colorSampleRequestedAt)
      .where(sql`${t.colorSampleRequestedAt} is not null`),
    // "show me the reprints of this order" — a small partial index, since most
    // orders are not reprints.
    index('orders_source_order_idx')
      .on(t.sourceOrderId)
      .where(sql`${t.sourceOrderId} is not null`),
  ],
);

/** What an order asset is, so the UI can group and label the list. */
export type OrderAssetKind = 'design' | 'font' | 'other';

// --- order notes (staff-only, attributed) ----------------------------------
// Written by staff or relayed in from Email Flow via the inbound capability
// surface. Separate from orders.internalNotes because these need attribution
// + timestamps, and from generalNotes because that field is customer-visible.
// Never exposed on /o/**.
export const orderNotes = confirmation.table(
  'order_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    authorKind: text('author_kind').notNull().$type<'staff' | 'email_flow' | 'system'>(),
    authorLabel: text('author_label'), // acting-user id / staff email
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('order_notes_order_idx').on(t.orderId)],
);

// --- order assets (design files, font files) --------------------------------
// Named links to artwork the factory and the next reprint need — Drive links
// today, so this stores a URL rather than a storageKey (uploads would use
// src/lib/storage.ts instead). Order-level with an OPTIONAL garment tag: most
// jobs have order-wide artwork, but a multi-garment order can pin a file to the
// garment it belongs to. Reprints copy these forward — that's the point of them.
export const orderAssets = confirmation.table(
  'order_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // Null = applies to the whole order. Cascades so deleting a garment doesn't
    // strand its asset rows.
    garmentId: uuid('garment_id').references(() => garments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<OrderAssetKind>(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    notes: text('notes'),
    // Included in the PO documents sent to the supplier. Off by default —
    // an internal working file is not automatically factory-facing.
    includeOnPo: boolean('include_on_po').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('order_assets_order_idx').on(t.orderId, t.sortOrder),
    index('order_assets_garment_idx').on(t.garmentId),
  ],
);

// --- shared access-token column set -----------------------------------------
// Every magic-link table (order_access, roster_access, roster_member_access,
// and any future portal link) spreads these alongside its own scope FK, so
// the shapes cannot drift. tokenHash = SHA-256 of the high-entropy token
// (+ pepper) — we look up by hashing the incoming token, so a DB leak never
// exposes a live link (BRIEF §7).
const accessTokenColumns = () => ({
  id: uuid('id').defaultRandom().primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// --- order access (magic link) --------------------------------------------
export const orderAccess = confirmation.table(
  'order_access',
  {
    ...accessTokenColumns(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // only set when the optional per-order confirmation code is enabled (default off).
    // bcrypt hash (low-entropy code needs a slow KDF) — see src/lib/access-code.ts
    accessCodeHash: text('access_code_hash'),
  },
  (t) => [
    index('order_access_order_idx').on(t.orderId),
    // DB-level guarantee of the revoke-then-insert invariant: at most one
    // active (unrevoked) link per order, even under concurrent regeneration.
    uniqueIndex('order_access_one_active_uq')
      .on(t.orderId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

// --- team roster members ----------------------------------------------------
// A team member entered manually or via CSV/XLSX import. Sizing they submit is
// still stored as ordinary garment_sizing rows (roster_member_id set on those
// rows), so it coexists with staff-entered sizing with no schema conflict.
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

// --- team roster shared-link access -----------------------------------------
// Deliberately a SEPARATE table from order_access: generateAccessToken()
// revokes all prior active order_access rows when the manager regenerates
// their confirmation link, and that must never revoke the team's in-progress
// roster link (or vice versa).
export const rosterAccess = confirmation.table(
  'roster_access',
  {
    ...accessTokenColumns(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('roster_access_order_idx').on(t.orderId),
    uniqueIndex('roster_access_one_active_uq')
      .on(t.orderId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

// --- team roster per-member individual link access (v2, TEAM_ROSTER_PLAN.md Phase 9) --
// Same shape as roster_access but scoped to a single roster_member_id instead of
// order_id, so each team member can have their own single-purpose link
// alongside the still-live shared roster_access link (kept as a fallback for
// self-add and members without an email on file).
export const rosterMemberAccess = confirmation.table(
  'roster_member_access',
  {
    ...accessTokenColumns(),
    rosterMemberId: uuid('roster_member_id')
      .notNull()
      .references(() => rosterMembers.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('roster_member_access_member_idx').on(t.rosterMemberId),
    uniqueIndex('roster_member_access_one_active_uq')
      .on(t.rosterMemberId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

// --- garments (line items) -------------------------------------------------
// --- garment type presets (admin-managed catalog) --------------------------
// Mirrors Sales Hub's products.orderOptions/sizes shapes (bm-sales
// src/db/schema/sales.ts) for fleet parity, extended with free-text options.

/** One configurable option on a garment type: a constrained pick-list or a free-text field. */
export type GarmentTypeOption =
  | { label: string; type: 'select'; options: string[]; defaultOption?: string }
  | { label: string; type: 'text'; defaultValue?: string };

/** A labeled fabric slot on a garment type (e.g. "Outer Fabric", "Hood Lining") — staff pick ONE per field. */
export interface GarmentTypeFabricField {
  label: string;
  options: string[];
}

/** One size entry on a size chart; tall=true offers an extra-long "<label> Tall" variant. */
export interface SizeChartSize {
  label: string;
  tall: boolean;
}

export const garmentTypes = confirmation.table(
  'garment_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    category: text('category'), // optional grouping, e.g. 'Hoodies'
    // Labeled fabric slots, each with its own pick-list (one pick per slot).
    fabricFields: jsonb('fabric_fields').$type<GarmentTypeFabricField[]>().notNull().default([]),
    orderOptions: jsonb('order_options').$type<GarmentTypeOption[]>().notNull().default([]),
    // Default EXTRA sizing-table columns for garments of this type (Colour,
    // Variation, …). Copied onto a garment at create time; the garment owns its
    // copy from then on, so editing the type never rewrites live orders.
    sizingColumns: jsonb('sizing_columns').$type<GarmentTypeOption[]>().notNull().default([]),
    // Deactivate-never-delete (Sales Hub dictionary convention): existing
    // garments keep pointing at retired types.
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('garment_types_active_idx').on(t.isActive)],
);

// charts auto-attached to garments created with this type (many-to-many)
export const garmentTypeSizeChartLinks = confirmation.table(
  'garment_type_size_chart_links',
  {
    garmentTypeId: uuid('garment_type_id')
      .notNull()
      .references(() => garmentTypes.id, { onDelete: 'cascade' }),
    sizeChartId: uuid('size_chart_id')
      .notNull()
      .references(() => sizeCharts.id, { onDelete: 'cascade' }),
  },
  (t) => [
    // Composite PK (not just a unique index): tables without a PK break
    // logical replication / CDC, which the shared-platform DB will need.
    primaryKey({ columns: [t.garmentTypeId, t.sizeChartId] }),
    uniqueIndex('garment_type_size_chart_uq').on(t.garmentTypeId, t.sizeChartId),
  ],
);

export const garments = confirmation.table(
  'garments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // LEGACY free-text fabric list for typeless garments; typed garments use
    // selectedFabrics. Resolve via effectiveFabrics() (src/lib/fabric-fields.ts).
    fabrics: jsonb('fabrics').$type<string[]>(),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    // Preset link + the values chosen for the type's orderOptions ({label: value}).
    // Both nullable — garments without a type keep the free-text workflow.
    garmentTypeId: uuid('garment_type_id').references(() => garmentTypes.id, {
      onDelete: 'set null',
    }),
    selectedOptions: jsonb('selected_options').$type<Record<string, string>>(),
    // Fabric picks per type fabric field ({fieldLabel: chosenFabric}). Null
    // for typeless garments, which keep the legacy free-text `fabrics` list.
    selectedFabrics: jsonb('selected_fabrics').$type<Record<string, string>>(),
    // EXTRA columns on this garment's sizing table beyond size/player/number/
    // notes — e.g. Colour, Variation, Sponsor. Same shape as a garment type's
    // orderOptions, so the select-vs-text editor is reused verbatim. Defined
    // per garment (added on the fly) and optionally saved onto the garment type
    // as a reusable default; values live in garment_sizing.customValues.
    sizingColumns: jsonb('sizing_columns').$type<GarmentTypeOption[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('garments_order_idx').on(t.orderId), index('garments_type_idx').on(t.garmentTypeId)],
);

// --- per-garment sizing rows ----------------------------------------------
export const garmentSizing = confirmation.table(
  'garment_sizing',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    garmentId: uuid('garment_id')
      .notNull()
      .references(() => garments.id, { onDelete: 'cascade' }),
    size: text('size'),
    playerName: text('player_name'),
    playerNumber: text('player_number'),
    notes: text('notes'),
    // Values for this garment's user-defined sizingColumns ({label: value}).
    // Null when the garment has no custom columns — same "null when empty"
    // convention as garments.selectedOptions.
    customValues: jsonb('custom_values').$type<Record<string, string>>(),
    sortOrder: integer('sort_order').notNull().default(0),
    // Set when this row was submitted by a team member via the roster flow
    // rather than typed by staff. Null for all pre-existing/staff-entered rows.
    rosterMemberId: uuid('roster_member_id').references(() => rosterMembers.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('garment_sizing_garment_idx').on(t.garmentId),
    index('garment_sizing_roster_member_idx').on(t.rosterMemberId),
  ],
);

// --- mock-up images (garment-level) ---------------------------------------
export const mockupImages = confirmation.table(
  'mockup_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    garmentId: uuid('garment_id')
      .notNull()
      .references(() => garments.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    caption: text('caption'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('mockup_images_garment_idx').on(t.garmentId)],
);

// --- reusable reference size-chart library --------------------------------
export const sizeCharts = confirmation.table('size_charts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  storageKey: text('storage_key'),
  description: text('description'),
  // Ordered structured size list — drives the size dropdowns in the staff
  // sizing table and the customer roster flow for garments linked to this
  // chart. The uploaded file stays the visual reference.
  sizes: jsonb('sizes').$type<SizeChartSize[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// link a garment to one or more reference charts (many-to-many)
export const garmentSizeChartLinks = confirmation.table(
  'garment_size_chart_links',
  {
    garmentId: uuid('garment_id')
      .notNull()
      .references(() => garments.id, { onDelete: 'cascade' }),
    sizeChartId: uuid('size_chart_id')
      .notNull()
      .references(() => sizeCharts.id, { onDelete: 'cascade' }),
  },
  (t) => [
    // Composite PK — see garment_type_size_chart_links note.
    primaryKey({ columns: [t.garmentId, t.sizeChartId] }),
    uniqueIndex('garment_size_chart_uq').on(t.garmentId, t.sizeChartId),
  ],
);

/** Canonical acknowledgment keys — REQUIRED_ACK_KEYS (customer-service) must stay in sync. */
export type AckKey =
  | 'color_accuracy'
  | 'color_matching'
  | 'mockup_correct'
  | 'sizing_correct'
  | 'size_charts_used'
  | 'no_refunds'
  | 'womens_unisex_sizing'
  | 'payment_terms'
  | 'authorised';

// --- acknowledgments (one row per checkbox, audit trail) ------------------
export const acknowledgments = confirmation.table(
  'acknowledgments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ackKey: text('ack_key').notNull().$type<AckKey>(),
    ackTextVersion: text('ack_text_version').notNull(),
    accepted: boolean('accepted').notNull().default(false),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ack_order_key_uq').on(t.orderId, t.ackKey)],
);

// --- final confirmation snapshot ------------------------------------------
export const confirmations = confirmation.table('confirmations', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' })
    .unique(),
  signatureType: signatureType('signature_type').notNull().default('none'),
  signatureStorageKey: text('signature_storage_key'),
  // IMMUTABLE copy of the order as shown at confirmation — including the NAME of
  // each linked size chart. Live records may change/disappear later; this is the
  // record of what was actually agreed. (BRIEF §6, §8)
  // KEY CONVENTION: snapshots written from 2026-07-26 use camelCase keys;
  // earlier rows are snake_case — readers must normalize (see orders/snapshot).
  confirmedSnapshot: jsonb('confirmed_snapshot').notNull().$type<Record<string, unknown>>(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
});

// --- Google Ads conversion events -----------------------------------------
export const conversionEvents = confirmation.table(
  'conversion_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    valueAmount: numeric('value_amount', { precision: 12, scale: 2 }),
    valueCurrency: text('value_currency'),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    status: conversionStatus('status').notNull().default('pending'),
    providerResponse: jsonb('provider_response').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // One conversion per order is the invariant confirmOrder relies on — the
  // unique index both declares it and gives the lookup its index.
  (t) => [uniqueIndex('conversion_events_order_uq').on(t.orderId)],
);

// --- domain events outbox (platform integration, BRIEF §15) ---------------
export const domainEvents = confirmation.table(
  'domain_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aggregateType: text('aggregate_type').notNull().$type<'order'>(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull().$type<DomainEventType>(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    status: eventStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    // Retry/redrive (roadmap 3.1). attempts counts failed deliveries; nextAttemptAt
    // gates when a 'failed' row becomes eligible for re-selection (exponential backoff).
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  },
  (t) => [
    index('domain_events_status_idx').on(t.status),
    index('domain_events_aggregate_idx').on(t.aggregateType, t.aggregateId),
    // Serves the aggregate-scoped reads that omit aggregateType
    // (getChangesRequested*, getStaleOrders) — the composite above can't.
    index('domain_events_aggregate_id_idx').on(t.aggregateId, t.eventType, t.createdAt),
    // The outbox poller's working set: tiny live sliver of a growing table.
    index('domain_events_outbox_idx')
      .on(t.createdAt)
      .where(sql`${t.status} in ('pending', 'failed')`),
  ],
);

// --- audit events (staff/customer action history) ---------------------------
// Distinct from domain_events: audit rows are NOT outbox messages — they have
// no delivery lifecycle, and they carry actor attribution as a real query
// dimension. domain_events stays a pure transactional outbox; getOrderAuditLog
// merges both sources into the order timeline.
export const auditEvents = confirmation.table(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aggregateType: text('aggregate_type').notNull().$type<'order' | 'staff_user' | 'garment_type' | 'purchase_order' | 'supplier' | 'shipment'>(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    actorEmail: text('actor_email'),
    actorStaffUserId: uuid('actor_staff_user_id').references(() => staffUsers.id),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('audit_events_aggregate_idx').on(t.aggregateId, t.createdAt),
    index('audit_events_actor_idx').on(t.actorEmail),
  ],
);

// --- rate limiting (Postgres-backed, roadmap 3.3) --------------------------
// Fixed-window counter shared across horizontally-scaled instances via a
// single atomic upsert (see checkRateLimitDb() in src/lib/rate-limit.ts).
// The in-memory limiter in that same file remains the fallback when this
// table is unreachable (and is what unit tests exercise).
export const rateLimits = confirmation.table(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(1),
  },
  // Lets the cron purge of expired windows run as an index scan.
  (t) => [index('rate_limits_window_start_idx').on(t.windowStart)],
);

// --- suppliers (factory partners; PO_PLAN) ----------------------------------
// Deactivate-never-delete, like garment types: POs on old orders keep
// pointing at retired suppliers.
export const suppliers = confirmation.table(
  'suppliers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    // Short uppercase code used in PO numbers (PO-{YYMM}-{CODE}{NN}-…).
    // Unique when set; auto-generated 2-char fallback from the name when blank.
    supplierCode: text('supplier_code'),
    contactPerson: text('contact_person'),
    email: text('email'),
    phone: text('phone'),
    website: text('website'),
    address: jsonb('address').$type<Record<string, unknown>>(),
    specialties: jsonb('specialties').$type<string[]>().notNull().default([]),
    minimumOrderQuantity: integer('minimum_order_quantity'),
    leadTimeWeeks: integer('lead_time_weeks'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('suppliers_active_idx').on(t.isActive),
    uniqueIndex('suppliers_code_uq').on(t.supplierCode).where(sql`${t.supplierCode} is not null`),
  ],
);

// --- purchase orders ---------------------------------------------------------
// One sizing-row line in a PO revision snapshot, keyed by the garment_sizing
// row UUID (stable across staff saves — see upsertSizingRows). Variance and
// coverage are computed against these ids, never by size-string matching.
export interface PoSnapshotLine {
  sizingRowId: string;
  size: string | null;
  playerName: string | null;
  playerNumber: string | null;
  notes: string | null;
  /** Values for the garment's user-defined sizing columns ({label: value}). */
  customValues?: Record<string, string> | null;
}

export interface PoSnapshotGarment {
  garmentId: string;
  name: string;
  garmentTypeId: string | null;
  /** Denormalized so the PDF renders without a live garment_types read. */
  garmentTypeName: string | null;
  fabrics: string[];
  selectedFabrics: Record<string, string> | null;
  selectedOptions: Record<string, string> | null;
  /** Column definitions in force when this revision was cut — the supplier
   *  documents render exactly these, in this order, even if the garment's
   *  columns change later. */
  sizingColumns?: GarmentTypeOption[];
  notes: string | null;
  lines: PoSnapshotLine[];
}

/** A factory-facing asset link, captured at revision time. */
export interface PoSnapshotAsset {
  kind: OrderAssetKind;
  name: string;
  url: string;
  notes: string | null;
  /** Garment this file belongs to, when it was tagged to one. */
  garmentName: string | null;
}

/** The immutable content of one PO revision — what the supplier was sent. */
export interface PoSnapshot {
  orderNumber: string;
  garments: PoSnapshotGarment[];
  /** Assets flagged includeOnPo when this revision was cut. */
  assets?: PoSnapshotAsset[];
  /** "Reprint of OC-…" reference, so the factory can reuse the prior layout. */
  reprintOfOrderNumber?: string | null;
}

export const purchaseOrders = confirmation.table(
  'purchase_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Legacy-familiar format: PO-{YY}{MM}-{supplierCode}{NN}-{CUSTOMER10}
    poNumber: text('po_number').notNull().unique(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    status: poStatus('status').notNull().default('draft'),
    // Denormalized pointer to the latest revision (latest = max(revisionNumber);
    // no circular FK on purpose).
    currentRevisionNumber: integer('current_revision_number').notNull().default(1),
    deadlineDate: date('deadline_date'),
    expectedShipDate: date('expected_ship_date'),
    actualShipDate: date('actual_ship_date'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('purchase_orders_order_idx').on(t.orderId),
    index('purchase_orders_supplier_idx').on(t.supplierId),
    index('purchase_orders_status_idx').on(t.status),
  ],
);

export const purchaseOrderRevisions = confirmation.table(
  'purchase_order_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    // Why this revision was issued — null only for revision 1 (the original).
    reason: text('reason'),
    snapshot: jsonb('snapshot').notNull().$type<PoSnapshot>(),
    createdBy: uuid('created_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('po_revisions_po_rev_uq').on(t.poId, t.revisionNumber)],
);

// --- shipments ---------------------------------------------------------------
export const shipments = confirmation.table(
  'shipments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    nickname: text('nickname'),
    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    boxCount: integer('box_count'),
    pieceCount: integer('piece_count'),
    shippingCost: numeric('shipping_cost', { precision: 12, scale: 2 }),
    shippingCostCurrency: text('shipping_cost_currency').notNull().default('USD'),
    etaDate: date('eta_date'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    status: shipmentStatus('status').notNull().default('pending'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('shipments_supplier_idx').on(t.supplierId),
    index('shipments_status_idx').on(t.status),
  ],
);

export const shipmentPurchaseOrders = confirmation.table(
  'shipment_purchase_orders',
  {
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.shipmentId, t.purchaseOrderId] }),
    index('shipment_pos_po_idx').on(t.purchaseOrderId),
  ],
);

// --- relations (no DB migration needed — type-level only for db.query.* API) ---

export const ordersRelations = relations(orders, ({ one, many }) => ({
  garments: many(garments),
  access: many(orderAccess),
  rosterMembers: many(rosterMembers),
  rosterAccess: many(rosterAccess),
  notes: many(orderNotes),
  assets: many(orderAssets),
  purchaseOrders: many(purchaseOrders),
  confirmation: one(confirmations, {
    fields: [orders.id],
    references: [confirmations.orderId],
  }),
  acknowledgments: many(acknowledgments),
  conversionEvents: many(conversionEvents),
  createdByUser: one(staffUsers, {
    fields: [orders.createdBy],
    references: [staffUsers.id],
  }),
  // The order this one reprints. `relationName` is required because both sides
  // point at the same table.
  sourceOrder: one(orders, {
    fields: [orders.sourceOrderId],
    references: [orders.id],
    relationName: 'reprints',
  }),
  reprints: many(orders, { relationName: 'reprints' }),
}));

export const confirmationsRelations = relations(confirmations, ({ one }) => ({
  order: one(orders, { fields: [confirmations.orderId], references: [orders.id] }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
  shipments: many(shipments),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  order: one(orders, { fields: [purchaseOrders.orderId], references: [orders.id] }),
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  revisions: many(purchaseOrderRevisions),
  shipmentLinks: many(shipmentPurchaseOrders),
  createdByUser: one(staffUsers, {
    fields: [purchaseOrders.createdBy],
    references: [staffUsers.id],
  }),
}));

export const purchaseOrderRevisionsRelations = relations(purchaseOrderRevisions, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderRevisions.poId],
    references: [purchaseOrders.id],
  }),
}));

export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [shipments.supplierId], references: [suppliers.id] }),
  purchaseOrderLinks: many(shipmentPurchaseOrders),
}));

export const shipmentPurchaseOrdersRelations = relations(shipmentPurchaseOrders, ({ one }) => ({
  shipment: one(shipments, {
    fields: [shipmentPurchaseOrders.shipmentId],
    references: [shipments.id],
  }),
  purchaseOrder: one(purchaseOrders, {
    fields: [shipmentPurchaseOrders.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
}));

export const acknowledgmentsRelations = relations(acknowledgments, ({ one }) => ({
  order: one(orders, { fields: [acknowledgments.orderId], references: [orders.id] }),
}));

export const conversionEventsRelations = relations(conversionEvents, ({ one }) => ({
  order: one(orders, { fields: [conversionEvents.orderId], references: [orders.id] }),
}));

export const staffUsersRelations = relations(staffUsers, ({ many }) => ({
  createdOrders: many(orders),
}));

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  actor: one(staffUsers, {
    fields: [auditEvents.actorStaffUserId],
    references: [staffUsers.id],
  }),
}));

export const orderAssetsRelations = relations(orderAssets, ({ one }) => ({
  order: one(orders, { fields: [orderAssets.orderId], references: [orders.id] }),
  garment: one(garments, { fields: [orderAssets.garmentId], references: [garments.id] }),
}));

export const orderNotesRelations = relations(orderNotes, ({ one }) => ({
  order: one(orders, { fields: [orderNotes.orderId], references: [orders.id] }),
}));

export const garmentsRelations = relations(garments, ({ one, many }) => ({
  assets: many(orderAssets),
  order: one(orders, { fields: [garments.orderId], references: [orders.id] }),
  sizing: many(garmentSizing),
  images: many(mockupImages),
  sizeChartLinks: many(garmentSizeChartLinks),
  garmentType: one(garmentTypes, {
    fields: [garments.garmentTypeId],
    references: [garmentTypes.id],
  }),
}));

export const garmentTypesRelations = relations(garmentTypes, ({ many }) => ({
  garments: many(garments),
  sizeChartLinks: many(garmentTypeSizeChartLinks),
}));

export const garmentTypeSizeChartLinksRelations = relations(
  garmentTypeSizeChartLinks,
  ({ one }) => ({
    garmentType: one(garmentTypes, {
      fields: [garmentTypeSizeChartLinks.garmentTypeId],
      references: [garmentTypes.id],
    }),
    sizeChart: one(sizeCharts, {
      fields: [garmentTypeSizeChartLinks.sizeChartId],
      references: [sizeCharts.id],
    }),
  }),
);

export const garmentSizingRelations = relations(garmentSizing, ({ one }) => ({
  garment: one(garments, { fields: [garmentSizing.garmentId], references: [garments.id] }),
  rosterMember: one(rosterMembers, {
    fields: [garmentSizing.rosterMemberId],
    references: [rosterMembers.id],
  }),
}));

export const rosterMembersRelations = relations(rosterMembers, ({ one, many }) => ({
  order: one(orders, { fields: [rosterMembers.orderId], references: [orders.id] }),
  sizing: many(garmentSizing),
  memberAccess: many(rosterMemberAccess),
}));

export const rosterAccessRelations = relations(rosterAccess, ({ one }) => ({
  order: one(orders, { fields: [rosterAccess.orderId], references: [orders.id] }),
}));

export const rosterMemberAccessRelations = relations(rosterMemberAccess, ({ one }) => ({
  member: one(rosterMembers, {
    fields: [rosterMemberAccess.rosterMemberId],
    references: [rosterMembers.id],
  }),
}));

export const mockupImagesRelations = relations(mockupImages, ({ one }) => ({
  garment: one(garments, { fields: [mockupImages.garmentId], references: [garments.id] }),
}));

export const garmentSizeChartLinksRelations = relations(garmentSizeChartLinks, ({ one }) => ({
  garment: one(garments, { fields: [garmentSizeChartLinks.garmentId], references: [garments.id] }),
  sizeChart: one(sizeCharts, { fields: [garmentSizeChartLinks.sizeChartId], references: [sizeCharts.id] }),
}));

export const sizeChartsRelations = relations(sizeCharts, ({ many }) => ({
  garmentLinks: many(garmentSizeChartLinks),
  garmentTypeLinks: many(garmentTypeSizeChartLinks),
}));

export const orderAccessRelations = relations(orderAccess, ({ one }) => ({
  order: one(orders, { fields: [orderAccess.orderId], references: [orders.id] }),
}));
