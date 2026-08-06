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

/**
 * Sequential order numbers (David, 2026-08-02): OC-10001, OC-10002, …
 * A sequence never hands out the same value twice, so concurrent creates
 * cannot collide; a number burned by a failed create leaves a gap, which
 * sequential-with-gaps accepts. Pre-existing random OC-XXXXXXXX numbers
 * stay valid history and cannot collide with the numeric form.
 */
export const orderNumberSeq = confirmation.sequence('order_number_seq', {
  startWith: '10001',
});

// --- enums -----------------------------------------------------------------
// Order matters only for readability; the ordering that decides access lives in
// src/lib/roles.ts. 'none' is the fail-closed fallback for an identity role this
// app does not understand — never a role anyone is deliberately given.
export const staffRole = confirmation.enum('staff_role', ['none', 'viewer', 'sales', 'admin']);
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
// Production flow per David's 2026-08-05 vocabulary: sent renders as
// UNCONFIRMED, pre_production as DESIGN PREP, in_production as PRODUCTION,
// in_transit as SHIPPING (values keep their names — pg enum values cannot be
// renamed or removed, and fleet consumers already hold them). test_print,
// prod_layout and quality_control are the 2026-08-05 additions; `confirmed`
// is legacy (new flow goes sent → design prep directly) but rows hold it.
export const poStatus = confirmation.enum('po_status', [
  'draft',
  'approved',
  'sent',
  'confirmed',
  'pre_production',
  'test_print',
  'prod_layout',
  'in_production',
  'quality_control',
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
  /**
   * The fleet identity-service user id (bm-identity `identity.users.id`).
   *
   * No FK: that service lives in a different database, and its rows are never
   * deleted — only disabled — so the reference cannot dangle. Unique, because
   * two local accounts pointing at one identity would make "who is this?"
   * ambiguous at login. Null until the account is bridged.
   */
  identityUserId: uuid('identity_user_id').unique(),
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
    // Staff-facing label ("Winter hoodies 2026") — from the email composer's
    // create or typed in the admin UI (David, 2026-08-02). Distinct from the
    // order number; also the hub index row's display name when present.
    name: text('name'),
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

    // Print names in CAPITALS (David, 2026-08-05) — a per-order choice made
    // WITH the customer. True: every player name is uppercased at write, in
    // every writer (roster, name lists, sizing, CSV import), and existing
    // names are converted when the flag is turned on. False (default): names
    // are printed exactly as entered, and the team roster page says so —
    // as-typed is the default because silent conversion is the lossy
    // direction.
    namesUppercase: boolean('names_uppercase').notNull().default(false),

    status: orderStatus('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => staffUsers.id),

    // Set while a team roster (see roster_members/roster_access) is locked for
    // review/finalization. Deliberately not folded into `status` — outbox
    // consumers key off status, and roster progress is orthogonal to it.
    rosterLockedAt: timestamp('roster_locked_at', { withTimezone: true }),

    // The short-URL roster page (David, 2026-08-03: /roster/<order-number>,
    // typeable). Null = the page 404s; staff enable it per order on request.
    rosterEnabledAt: timestamp('roster_enabled_at', { withTimezone: true }),
    // Its optional password — stored READABLY like orders.accessCode (same
    // ruling: staff must see it on demand; it may be a word, not just digits).
    // Null = the page opens without a password. Enabling the page generates
    // one by default (David, 2026-08-03).
    rosterPassword: text('roster_password'),
    // The CLUB ADMIN's own password — the guest whose email matches the
    // order's customer email may edit anyone's players, so their email alone
    // must not be enough to become them. Chosen by the club admin on first
    // visit, HASHED (user-chosen secret — staff RESET it, never read it).
    rosterAdminPasswordHash: text('roster_admin_password_hash'),

    // Set when the customer, at confirmation time, asked for a colour book /
    // physical sample for colour matching before production (BRIEF §5 ack 2,
    // §11). Production must hold until this is resolved with the customer.
    colorSampleRequestedAt: timestamp('color_sample_requested_at', { withTimezone: true }),

    // The customer-link access code, stored RECOVERABLY by David's explicit
    // ruling (2026-08-03): staff must be able to read it back on demand
    // instead of regenerating every time a customer asks. It may be a custom
    // string, not just digits. Verification still runs against the bcrypt
    // hash on the access row (which also binds the verification cookie);
    // this column is the staff-readable source. Deliberate trade-off: it is
    // a per-order second factor, not an account credential.
    accessCode: text('access_code'),

    // Sales Hub (bm-sales) CRM association. A plain uuid HINT, not a FK —
    // separate databases, and the hub merges duplicate customers, so a stored
    // id can become a tombstone. TODO: re-stamp to the survivor when the hub
    // client reports `resolvedFrom` — NOT implemented; a merged customer's id
    // stays stale here indefinitely. Survivable because the hub's read-repair
    // unions tombstoned predecessor ids when fetching orders-by-customer
    // (David's option-(a) ruling, fleet thread 2026-08-05). Non-unique: one
    // customer places many orders. Name is denormalized so the admin chip
    // renders without a hub round-trip.
    hubCustomerId: uuid('hub_customer_id'),
    hubCustomerName: text('hub_customer_name'),

    /**
     * The contact who placed the order, within the hub customer. Same
     * cross-database-hint rules as hubCustomerId: uuid + best-effort name
     * snapshot, re-stamped on read if the hub reports a tombstone hop. The
     * contact must keep resolving after leaving the customer — hub's
     * GET /contacts/:id answers for ended memberships by contract.
     */
    hubContactId: uuid('hub_contact_id'),
    hubContactName: text('hub_contact_name'),

    /**
     * The hub's thin index row for this order (fleet thread
     * 2026-07-31-orders-from-email). Stamped from the register POST; the
     * status push PATCHes by this id. Null = not registered yet — the push
     * path heals by re-registering (idempotent on our order uuid).
     */
    hubOrderId: uuid('hub_order_id'),

    /**
     * One-way link to the originating DesignFlow project — their project
     * uuid, which survives renames and customer merges (their D3 commitment).
     * Deep link renders as designflow.beastmode.co.nz/projects/<uuid>.
     * No sync in either direction by design.
     */
    designProjectRef: uuid('design_project_ref'),

    // Set when this order was created as a REPRINT of another (a repeat job).
    // A real self-FK (same table, same DB, so it can be enforced — unlike
    // hubCustomerId which is a cross-database hint). `set null` rather than
    // cascade: deleting the original must never delete the reprint.
    sourceOrderId: uuid('source_order_id').references((): AnyPgColumn => orders.id, {
      onDelete: 'set null',
    }),
    reprintReason: text('reprint_reason'),

    // --- workflow stage (see workflow_stages) ---------------------------------
    // Nullable with NO backfill: the read path resolves null (or a slug that no
    // longer exists) to the default stage for the row's status, so every
    // pre-existing row renders on the board correctly from day one.
    workflowStageSlug: text('workflow_stage_slug'),
    /**
     * When the entity entered its current stage — the clock the stuck-job scans
     * read. Stored rather than derived from domain_events, which would mean a
     * max(created_at) scan per entity on every tick.
     */
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }),

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
    // Stuck-job scan reads (stage, entered-at). Partial: a row that has never
    // been staged is not a candidate, and rows stay unstaged until the board
    // is used on them.
    index('orders_stage_idx')
      .on(t.workflowStageSlug, t.stageEnteredAt)
      .where(sql`${t.workflowStageSlug} is not null`),
  ],
);

/** What an order asset is, so the UI can group and label the list. */
export type OrderAssetKind = 'design' | 'font' | 'colour-book' | 'other';

// --- order notes (staff-only, attributed, threaded) ------------------------
// A chat on the order — and optionally on one garment of it — rather than a
// log line, so staff can see who said what and reply. Written by staff or
// relayed in from Email Flow via the inbound capability surface. Separate from
// orders.internalNotes because these need attribution + timestamps, and from
// generalNotes because that field is customer-visible. Never exposed on /o/**.
//
// `body` is plain text and stays notNull: it is what emails, previews and
// search read, and it is all the Email-Flow path ever writes. `bodyHtml` holds
// the sanitised rich text when a staff note came from the editor — readers
// prefer it and fall back to `body`, so a note is always renderable.
export const orderNotes = confirmation.table(
  'order_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // Null = a note on the order as a whole. Set = a note on this garment,
    // which is the "notes on the specific garments" thread.
    garmentId: uuid('garment_id').references(() => garments.id, { onDelete: 'cascade' }),
    // Set = a comment ON a production file (David, 2026-08-05) — the file's
    // own thread, where change requests and their reasons live. Rides this
    // table (not a new one) so supplier attribution, sanitisation, soft
    // delete and the portal's shared-visibility model all come for free.
    poFileId: uuid('po_file_id').references(() => poFiles.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    bodyHtml: text('body_html'),
    // Two species share this table (David, 2026-08-04): 'comment' — the
    // internal discussion thread — and 'note' — order notes proper: short
    // finalisation points ("sleeves 1cm shorter", "numbers inside the hem")
    // the email app needs to add AND read. Same storage, different surfaces.
    kind: text('kind').notNull().$type<'comment' | 'note'>().default('comment'),
    authorKind: text('author_kind').notNull().$type<'staff' | 'email_flow' | 'system' | 'supplier'>(),
    authorLabel: text('author_label'), // acting-user id / staff email
    // The real actor, for notes written by a signed-in staff member. Nullable
    // because Email-Flow and system notes have no staff row; no cascade, since
    // deleting a user must not silently erase what they said.
    authorStaffUserId: uuid('author_staff_user_id').references(() => staffUsers.id),
    // 'shared' = visible on the token-gated supplier portal (SUPPLIER_PORTAL_PLAN.md).
    // Defaults to 'internal' so no note already in the DB becomes supplier-visible
    // retroactively; a supplier-authored note is always inserted as 'shared'.
    // Staff opt IN per reply rather than the portal reading a whole separate thread.
    visibility: text('visibility').notNull().$type<'internal' | 'shared'>().default('internal'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete: a removed note leaves a "deleted" placeholder in the thread
    // rather than a hole, because a conversation that silently loses messages
    // reads as a bug to the next person in it.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('order_notes_order_idx').on(t.orderId),
    // The garment thread reads by garment; partial because most notes are
    // order-wide and would otherwise sit in the index as nulls.
    index('order_notes_garment_idx')
      .on(t.garmentId, t.createdAt)
      .where(sql`${t.garmentId} is not null`),
    // The per-file thread reads by file; partial for the same reason.
    index('order_notes_po_file_idx')
      .on(t.poFileId, t.createdAt)
      .where(sql`${t.poFileId} is not null`),
  ],
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
    /**
     * What this file is FOR, on a garment: 'playerName', 'playerNumber', or the
     * label of one of the garment's user-defined sizing columns ('Secondary
     * Name'). Null for files that are not tied to a single text field — a
     * design file, or a font used throughout.
     *
     * Deliberately free text rather than an enum: the text fields it names are
     * themselves user-defined per garment type, so a closed list here would go
     * stale the moment someone adds a column.
     */
    usage: text('usage'),
    /**
     * Exactly one of `url` (a Drive link) or `storageKey` (an uploaded file) is
     * set — enforced by a check constraint. `url` lost its NOT NULL in 0025 to
     * make room for uploads; that relaxes a constraint rather than dropping
     * anything, so it stays within the additive-only rule.
     */
    url: text('url'),
    storageKey: text('storage_key'),
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
    // Staff-readable copy of the raw token (David, 2026-08-04): the confirmation
    // URL stays visible in the admin, like the roster page URL. tokenHash remains
    // the lookup key; rows predating this column are null and cannot show a URL
    // until the link is regenerated.
    tokenPlain: text('token_plain'),
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
// --- roster guests (short-URL page identities; David, 2026-08-03) ----------
// A guest is "whoever entered this email on the roster page" — no password,
// the email IS the identifier (the page itself is the gate, via its optional
// password or an unguessable token link). Guests own the members they add and
// can only edit their own.
export const rosterGuests = confirmation.table(
  'roster_guests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Stored lowercased — the identity key on this order. */
    email: text('email').notNull(),
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('roster_guests_order_idx').on(t.orderId),
    uniqueIndex('roster_guests_order_email_uq').on(t.orderId, t.email),
  ],
);

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
    // The guest who added this member on the short-URL page. Null for
    // staff-imported members and legacy shared-link entries — those are
    // read-only to guests (only their creator may edit a member).
    guestId: uuid('guest_id').references(() => rosterGuests.id, { onDelete: 'set null' }),
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

/** A field is shown only when the named parent option currently equals one of `equals`. */
export interface ConditionalRule {
  parentLabel: string;
  equals: string[]; // checkbox parent: ['true'] / ['false']; select parent: one or more of its option values
}

/**
 * One configurable option on a garment type: a constrained pick-list, a
 * free-text field, or a checkbox — optionally shown only when a preceding
 * option (`showWhen`) matches. `required` (David, 2026-08-06: "the sales
 * person MUST choose a colour for the cord") blocks saving a garment while a
 * VISIBLE required option is unanswered; a checkbox has no `required` because
 * unchecked IS an answer.
 */
export type GarmentTypeOption =
  | { label: string; type: 'select'; options: string[]; defaultOption?: string; required?: boolean; showWhen?: ConditionalRule }
  | { label: string; type: 'text'; defaultValue?: string; required?: boolean; showWhen?: ConditionalRule }
  | { label: string; type: 'checkbox'; defaultValue?: boolean; showWhen?: ConditionalRule };

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

/**
 * Which surface a chart is for (David, 2026-08-06): 'customer' charts are what
 * the customer sees and picks sizes from; 'production' charts carry the fuller
 * factory detail for PO/supplier surfaces. See sizeCharts.kind below.
 */
export type SizeChartKind = 'customer' | 'production';

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
    // "Got Your Back" style: this garment carries a name list (print content,
    // GARMENT_NAME_LIST_ENTRIES below) IN ADDITION TO its normal sizing rows
    // — the two are deliberately independent (see garmentNameListEntries doc
    // comment). nameListRows is the print layout's row count; columns are
    // derived at render time (ceil(count / rows)), not stored.
    nameListEnabled: boolean('name_list_enabled').notNull().default(false),
    nameListRows: integer('name_list_rows'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('garments_order_idx').on(t.orderId), index('garments_type_idx').on(t.garmentTypeId)],
);

// --- "Got Your Back" name list (print content, NOT a manufacture unit) -----
// Deliberately separate from garment_sizing: sizing rows are summed into
// purchase-order quantities (src/server/purchase-orders/xlsx.ts), but a name
// printed on a shared design has no relationship to how many physical
// garments get made — so this table carries no size/quantity column and can
// never be pulled into that math. An independent, staff/customer-editable
// copy rather than a live roster join or per-member submission (see
// GOT_YOUR_BACK_PLAN.md) — "import from roster" is a one-shot bulk-copy.
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
    /**
     * How many of this line to make. 1 for a named player; higher for bulk
     * unnamed stock ("Medium x 20") so a run of identical rows is not needed.
     *
     * NOT NULL DEFAULT 1 so every existing row backfills to its current
     * meaning — one row was one garment before this column existed.
     */
    quantity: integer('quantity').notNull().default(1),
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
    // Best-effort resized copy generated at upload time (roadmap 7.3) so the
    // customer gallery grid doesn't pull the full-size original just to show
    // a 160x120 tile. Nullable: rows predating this feature, and any row
    // where thumbnail generation failed, fall back to `storageKey`.
    thumbnailStorageKey: text('thumbnail_storage_key'),
    caption: text('caption'),
    // Team-only reference image (David, 2026-08-06): never shown on the
    // customer surface — it exists for the production team when the PO is
    // prepared, and it DOES ride the PO snapshot to the factory.
    internalOnly: boolean('internal_only').notNull().default(false),
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
  // Two chart sets per garment (David, 2026-08-06): 'customer' charts are
  // what the customer picks sizes from; 'production' charts carry the fuller
  // factory detail and are what the PO/supplier surfaces show. Existing
  // charts default to 'customer'; supplier surfaces fall back to customer
  // charts when a garment has no production one, so old orders keep working.
  kind: text('kind').notNull().$type<SizeChartKind>().default('customer'),
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

/**
 * Acknowledgment keys are free slugs since 2026-08-03: the set lives in
 * `acknowledgement_settings` (admin-editable, migration 0031 seeds the
 * original nine), no longer a closed union. The agreed title/wording is
 * snapshotted per confirmation, so editing a setting never rewrites history.
 */
export type AckKey = string;

// --- acknowledgement settings (admin-editable; David, 2026-08-03) ----------
export const acknowledgementSettings = confirmation.table('acknowledgement_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Stable slug — referenced by acknowledgment rows; never re-used once retired. */
  key: text('key').notNull().unique(),
  /** Bold heading shown above the wording (David: draw attention to each). */
  title: text('title').notNull(),
  body: text('body').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  // Deactivate-never-delete: past confirmations reference the key.
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
    // Plain text in the database, so widening this union is a type-only change
    // and needs no migration.
    aggregateType: text('aggregate_type').notNull().$type<'order' | 'staff_user' | 'garment_type' | 'purchase_order' | 'supplier' | 'shipment' | 'workflow_stage' | 'acknowledgement_setting'>(),
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
    // Short uppercase code used in PO numbers ({CODE}{seq}, e.g. DY123) and in
    // the supplier portal URL (/supplier/{CODE}). Unique when set;
    // auto-generated 2-char fallback from the name when blank.
    supplierCode: text('supplier_code'),
    // Supplier portal password (David, 2026-08-05) — one shared password per
    // supplier, set by an admin, stored READABLY like orders.rosterPassword
    // (staff must be able to tell the supplier what it is). Null = the portal
    // is closed for this supplier. Verification binds it into the portal
    // cookie signature, so changing it signs everyone out.
    portalPassword: text('portal_password'),
    // Per-supplier PO number sequence ({CODE}{seq}, David, 2026-08-05: each
    // supplier counts alone — DY123 and GOAL123 coexist). Incremented with a
    // row lock inside the PO create transaction; POs predating the format
    // keep their PO-{YYMM}-… numbers.
    poSeq: integer('po_seq').notNull().default(0),
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

/**
 * A supplier's colour books (David, 2026-08-05): "each supplier has a list of
 * color books and we typically use the latest one". The DEFAULT is simply the
 * newest row per supplier — adding a book makes it the default with no flag
 * to keep in sync; older books stay selectable (reprints match the book the
 * original job used). Never deleted, only added.
 */
export const supplierColorBooks = confirmation.table(
  'supplier_color_books',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdBy: uuid('created_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('supplier_color_books_supplier_idx').on(t.supplierId, t.createdAt),
    uniqueIndex('supplier_color_books_supplier_name_uq').on(t.supplierId, t.name),
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
  /**
   * How many of this line. Optional because revisions cut before 0025 have no
   * quantity — readers must treat a missing value as 1, which is what a line
   * meant back then.
   */
  quantity?: number;
  notes: string | null;
  /** Values for the garment's user-defined sizing columns ({label: value}). */
  customValues?: Record<string, string> | null;
}

/**
 * A pre-production check that had been confirmed when this revision was cut.
 * "Checked" on a document means checked BEFORE it was issued — a confirmation
 * recorded after the send belongs to the next revision, not this one.
 */
export interface PoSnapshotCheck {
  taskName: string;
  stageName: string | null;
  /** Denormalised at confirm time; survives the user being renamed. */
  byEmail: string | null;
  /** ISO timestamp. */
  at: string;
}

/** A size chart the factory should cut to, captured at revision time. */
export interface PoSnapshotSizeChart {
  id: string;
  name: string;
  /** Signed at render time from the storage key — never stored as a URL. */
  storageKey: string | null;
  /**
   * Which chart set this came from (additive, 2026-08-06): 'production' when
   * the garment had production charts, else the customer-chart fallback.
   * Absent on snapshots cut before the field existed.
   */
  kind?: SizeChartKind;
}

/** A garment mock-up image captured at revision time (David, 2026-08-05: the
 *  supplier PO must show the garment images). Only storage keys are stored —
 *  signed at render time like every other snapshot asset. */
export interface PoSnapshotImage {
  id: string;
  storageKey: string;
  /** Resized copy for grids; falls back to storageKey when null. */
  thumbnailStorageKey: string | null;
  caption: string | null;
}

export interface PoSnapshotGarment {
  garmentId: string;
  name: string;
  garmentTypeId: string | null;
  /** Denormalized so the PDF renders without a live garment_types read. */
  garmentTypeName: string | null;
  /** Mock-up images at revision time. Optional: revisions cut before 0038-era
   *  snapshots have none, and readers must tolerate absence. */
  images?: PoSnapshotImage[];
  fabrics: string[];
  selectedFabrics: Record<string, string> | null;
  selectedOptions: Record<string, string> | null;
  /** Column definitions in force when this revision was cut — the supplier
   *  documents render exactly these, in this order, even if the garment's
   *  columns change later. */
  sizingColumns?: GarmentTypeOption[];
  /** Reference size charts linked to this garment when the revision was cut. */
  sizeCharts?: PoSnapshotSizeChart[];
  notes: string | null;
  lines: PoSnapshotLine[];
}

/** A factory-facing asset link, captured at revision time. */
export interface PoSnapshotAsset {
  kind: OrderAssetKind;
  name: string;
  /** What the file is for — 'playerName', or a sizing-column label. */
  usage?: string | null;
  /** A Drive link. Null when the file was uploaded instead. */
  url: string | null;
  /** An uploaded file. Signed at render time, so the link cannot go stale. */
  storageKey?: string | null;
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
  /** Who cut this revision — the staff email from the acting session. */
  preparedByEmail?: string | null;
  /** Order-level checks confirmed before this revision was cut. */
  checks?: PoSnapshotCheck[];
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
    // Which of the supplier's colour books this job is matched against
    // (David, 2026-08-05). Id references the book row; the name is
    // denormalized so PO documents render without a join and keep saying what
    // they said even if a book is later renamed.
    colorBookId: uuid('color_book_id').references(() => supplierColorBooks.id),
    colorBookName: text('color_book_name'),
    // The human-readable customer string in the DISPLAY title (David,
    // 2026-08-06): "2608-DY3-DAVID-BAIRD" — YYMM (stamped from sentAt, so
    // absent until sent) + the poNumber + this. poNumber stays the canonical
    // id everywhere (URLs, portal); this is presentation only.
    customerRef: text('customer_ref'),
    createdBy: uuid('created_by').references(() => staffUsers.id),

    // Workflow stage — same shape and same nullable-no-backfill reasoning as on
    // `orders` (see there).
    workflowStageSlug: text('workflow_stage_slug'),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }),

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
    // The stuck-job scan reads (stage, entered-at) pairs; partial because a row
    // that has never been staged is not a candidate.
    index('purchase_orders_stage_idx')
      .on(t.workflowStageSlug, t.stageEnteredAt)
      .where(sql`${t.workflowStageSlug} is not null`),
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

/**
 * Production files on a PO (David, 2026-08-05): suppliers upload their layout
 * file before test print, the production layout, the test print photo, etc.;
 * staff can upload too. Each file anchors its own comment thread
 * (order_notes.poFileId), which is where "change this, because…" lives — the
 * per-category sequence of files plus those threads IS the progression record
 * David asked to see. `statusAtUpload` stamps where in the flow the file
 * arrived. Stored in S3 "for essentially eternity": no hard delete; deletedAt
 * hides a mistaken upload but the object stays.
 */
export const poFiles = confirmation.table(
  'po_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    /** Free grouping label — "Layout", "Test print", "Production layout"… */
    category: text('category'),
    uploadedByKind: text('uploaded_by_kind').notNull().$type<'staff' | 'supplier'>(),
    /** "Ana (Dynasty)" or the staff email — snapshot at write. */
    uploadedByLabel: text('uploaded_by_label'),
    statusAtUpload: text('status_at_upload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('po_files_po_idx').on(t.poId, t.createdAt)],
);

/**
 * The pre-send checklist (David, 2026-08-06): a configurable list of checks
 * the production-prep team works through before a PO may be sent. Some items
 * auto-tick from data (`autoRule`), the rest are manual ticks recorded with
 * who/when. Items are config (admin-managed, deactivate-never-delete);
 * completions are per-PO facts.
 */
export const poChecklistItems = confirmation.table(
  'po_checklist_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    label: text('label').notNull(),
    /**
     * Auto-satisfied when the rule holds; null = manual tick only.
     * 'design_file_attached' — a live po_file in the Design file category or
     * a design asset in the snapshot; 'color_book_set' — po.colorBookId set.
     * Vocabulary is code (evaluated in checklist-service) — adding a rule is
     * a deploy, adding an ITEM is config.
     */
    autoRule: text('auto_rule').$type<'design_file_attached' | 'color_book_set'>(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('po_checklist_items_active_idx').on(t.isActive, t.sortOrder)],
);

export const poChecklistCompletions = confirmation.table(
  'po_checklist_completions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => poChecklistItems.id, { onDelete: 'cascade' }),
    checkedByEmail: text('checked_by_email'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('po_checklist_completions_po_item_uq').on(t.poId, t.itemId)],
);

// --- supplier portal access (magic link, SUPPLIER_PORTAL_PLAN.md) -----------
// Same shape as order_access/roster_access, scoped to ONE purchase order (not
// to a supplier account — no supplier login exists). A supplier with several
// open POs gets a separate link per PO, minted the first time each is sent.
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
    // What of the PO is IN this shipment (David, 2026-08-05): a PO can split
    // across shipments weeks apart, so each link says which part travelled —
    // "hoodies only, jerseys follow", free text. Null = the whole PO.
    contentsNote: text('contents_note'),
  },
  (t) => [
    // The composite PK means one link row per (shipment, PO) — a partial
    // re-ship goes on a NEW shipment, which is exactly the model David
    // described (parts of one PO shipping at different times).
    primaryKey({ columns: [t.shipmentId, t.purchaseOrderId] }),
    index('shipment_pos_po_idx').on(t.purchaseOrderId),
  ],
);

// --- workflow: configurable stages over the fixed status enums ---------------
// The `order_status` / `po_status` enums stay the state machine. A stage is a
// configurable *column on a board* that sits UNDER one of those statuses, so
// staff can add pre-production steps ("artwork", "digitising") without inventing
// new statuses that every consumer of the enum would then have to understand.
//
// Every status has at least one seeded stage, so a board can always be rendered
// from stages alone. Moving between stages inside one status group is a pure
// stage move; crossing a group boundary also performs a status transition, and
// that goes through the existing guard (`canTransition`).

/** Which board a stage belongs to. */
export type WorkflowBoardKey = 'order' | 'purchase_order';

/** Whether one confirmation is enough, or every owner must confirm. */
export type ConfirmationPolicy = 'any' | 'all';

export const workflowStages = confirmation.table(
  'workflow_stages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    boardKey: text('board_key').notNull().$type<WorkflowBoardKey>(),
    /**
     * Stable identifier. Entities reference the SLUG, not the id, so a stage can
     * be renamed or recoloured without touching every row that sits in it.
     */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** The enum status this stage sits under (`order_status` / `po_status`). */
    statusKey: text('status_key').notNull(),
    /**
     * Set when leaving this stage should also move the entity's status forward.
     * Null means the stage is one of several inside a single status group.
     */
    advancesToStatus: text('advances_to_status'),
    sortOrder: integer('sort_order').notNull().default(0),
    color: text('color'),
    isActive: boolean('is_active').notNull().default(true),
    /** Nothing is expected to leave a terminal stage, so stuck-scans skip it. */
    isTerminal: boolean('is_terminal').notNull().default(false),
    // Null = inherit the app default, so tuning one stage does not mean
    // restating the policy for all of them.
    warnAfterHours: integer('warn_after_hours'),
    urgentAfterHours: integer('urgent_after_hours'),
    defaultConfirmationPolicy: text('default_confirmation_policy')
      .notNull()
      .default('any')
      .$type<ConfirmationPolicy>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('workflow_stages_board_slug_uq').on(t.boardKey, t.slug),
    index('workflow_stages_board_sort_idx').on(t.boardKey, t.sortOrder),
    index('workflow_stages_status_idx').on(t.boardKey, t.statusKey),
  ],
);

// A step that has to happen while an entity sits in a stage. Blocking tasks must
// all be satisfied before the entity can leave; non-blocking ones stay open and
// follow the job (a colour sample can still be outstanding in production), which
// is what makes "mostly sequential, some parallel" expressible without a DAG.
export const workflowStageTasks = confirmation.table(
  'workflow_stage_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => workflowStages.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isBlocking: boolean('is_blocking').notNull().default(true),
    /** Null = inherit the stage's `defaultConfirmationPolicy`. */
    confirmationPolicy: text('confirmation_policy').$type<ConfirmationPolicy>(),
    /**
     * Gate keys this task feeds. A gate is not a table: it is "every active task
     * carrying this key is satisfied" (see GATE_CATALOG in the workflow server
     * module), which keeps gates configurable without another join.
     */
    gateKeys: jsonb('gate_keys').$type<string[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('workflow_stage_tasks_stage_slug_uq').on(t.stageId, t.slug),
    index('workflow_stage_tasks_stage_sort_idx').on(t.stageId, t.sortOrder),
  ],
);

// One row PER CONFIRMING USER — that is what makes an 'all' policy expressible
// at all. Polymorphic on (entityType, entityId) with no FK, matching
// audit_events: the same task set applies to orders and purchase orders.
export const workflowTaskCompletions = confirmation.table(
  'workflow_task_completions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => workflowStageTasks.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull().$type<WorkflowBoardKey>(),
    entityId: uuid('entity_id').notNull(),
    /** Null for a system-recorded completion (a scan, an import). */
    confirmedByStaffUserId: uuid('confirmed_by_staff_user_id').references(() => staffUsers.id),
    // Denormalised so the trail survives a user being renamed or deactivated.
    confirmedByEmail: text('confirmed_by_email'),
    note: text('note'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Two constraints, not one: Postgres treats NULLs as distinct, so a single
    // unique including the nullable user column would not stop repeated system
    // completions.
    uniqueIndex('workflow_task_completions_user_uq')
      .on(t.taskId, t.entityType, t.entityId, t.confirmedByStaffUserId)
      .where(sql`${t.confirmedByStaffUserId} is not null`),
    uniqueIndex('workflow_task_completions_system_uq')
      .on(t.taskId, t.entityType, t.entityId)
      .where(sql`${t.confirmedByStaffUserId} is null`),
    index('workflow_task_completions_entity_idx').on(t.entityType, t.entityId),
  ],
);

// Who owns what. A user owning a STAGE is a row with entityType
// 'workflow_stage' — that is how "notify whoever owns this step" resolves
// without a separate stage_owners table.
export type AssignmentEntityType = 'order' | 'purchase_order' | 'workflow_stage';

export const assignments = confirmation.table(
  'assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull().$type<AssignmentEntityType>(),
    entityId: uuid('entity_id').notNull(),
    /** Free-form ('owner', 'watcher'); the recipient rules read it. */
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => staffUsers.id),
  },
  (t) => [
    uniqueIndex('assignments_unique_uq').on(t.staffUserId, t.entityType, t.entityId, t.role),
    index('assignments_entity_idx').on(t.entityType, t.entityId),
    index('assignments_user_idx').on(t.staffUserId),
  ],
);

// --- notifications ----------------------------------------------------------
// Config here is OVERRIDE-ONLY: a missing row means "use the code-defined
// default" (see src/server/notifications/catalog.ts). The feature therefore
// ships working, and an admin who never opens the settings page keeps today's
// behaviour rather than silently getting no notifications at all.

/** How a recipient set is derived. */
export type RecipientRuleKind =
  | 'intrinsic'
  | 'role'
  | 'specific_users'
  | 'stage_owners'
  | 'entity_assignees'
  | 'order_owner'
  | 'po_creator';

export const notificationEventSettings = confirmation.table(
  'notification_event_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Matches a key in the code catalog. */
    eventKey: text('event_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('notification_event_settings_key_uq').on(t.eventKey)],
);

export const notificationRecipientRules = confirmation.table(
  'notification_recipient_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventKey: text('event_key').notNull(),
    kind: text('kind').notNull().$type<RecipientRuleKind>(),
    /** For 'role': the role name. For 'specific_users': ignored. */
    roleKey: text('role_key'),
    /** For 'specific_users'. */
    staffUserIds: jsonb('staff_user_ids').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('notification_recipient_rules_event_idx').on(t.eventKey)],
);

/**
 * Claim-before-send ledger. A row is inserted BEFORE the send is attempted, and
 * the unique index is what makes the claim atomic.
 *
 * The outbox re-runs every handler for an event on retry, so without this one
 * flaky SMTP call would email five owners five times over the backoff schedule.
 * That is the single most likely way this feature gets switched off by the
 * people it is meant to help. The trade-off is stated plainly: at-most-once, so
 * a crash between claiming and sending loses that one notification.
 */
export const notificationDeliveries = confirmation.table(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventKey: text('event_key').notNull(),
    /**
     * What makes this send unique. Usually the domain_events row id, so a retry
     * of the same event claims the same key; the reminder scans use a
     * time-bucketed key instead.
     */
    dedupeKey: text('dedupe_key').notNull(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull().$type<'email' | 'inbox'>(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedReason: text('failed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('notification_deliveries_claim_uq').on(
      t.eventKey,
      t.dedupeKey,
      t.staffUserId,
      t.channel,
    ),
  ],
);

/**
 * The in-app inbox. The email outbox lives ON the row (subject/html persisted,
 * nulled on success) rather than in a separate queue table: one insert instead
 * of two, and the unread badge and the retry scan read the same row.
 */
export const inboxItems = confirmation.table(
  'inbox_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    eventKey: text('event_key').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Where clicking it goes — a deep link to the checklist or the board. */
    href: text('href'),
    /** For grouping and for the "go to this order" affordance. */
    entityType: text('entity_type').$type<'order' | 'purchase_order'>(),
    entityId: uuid('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    // On-row email outbox. Nulled once sent so a delivered row carries no
    // duplicate copy of the body.
    emailSubject: text('email_subject'),
    emailHtml: text('email_html'),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    emailAttempts: integer('email_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // The unread badge is the most frequent query in the app once this ships.
    index('inbox_items_unread_idx')
      .on(t.staffUserId, t.createdAt)
      .where(sql`${t.readAt} is null`),
    // The retry scan looks only at rows with an unsent email still on them.
    index('inbox_items_pending_email_idx')
      .on(t.emailAttempts)
      .where(sql`${t.emailSubject} is not null and ${t.emailSentAt} is null`),
    index('inbox_items_entity_idx').on(t.entityType, t.entityId),
  ],
);

/**
 * Reminders and snoozes on a piece of work.
 *
 * Both kinds live in one table because they are the same shape and the scan
 * reads them together: a `snooze` suppresses nagging until `dueAt`, a `reminder`
 * asks to be resurfaced at `dueAt`.
 *
 * Snoozes are PER USER, not per entity. On a shared board a global snooze would
 * let one person silence a job for the whole team, which is how a nagging system
 * becomes a lying one.
 */
export type ReminderKind = 'snooze' | 'reminder';

export const workflowReminders = confirmation.table(
  'workflow_reminders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityType: text('entity_type').notNull().$type<'order' | 'purchase_order'>(),
    entityId: uuid('entity_id').notNull(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<ReminderKind>(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    note: text('note'),
    /** Null while live. Set when it fires, or when the user clears it. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // One LIVE row per person per entity per kind, so re-snoozing extends the
    // existing row instead of stacking duplicates that all fire later.
    uniqueIndex('workflow_reminders_live_uq')
      .on(t.entityType, t.entityId, t.staffUserId, t.kind)
      .where(sql`${t.resolvedAt} is null`),
    // The due scan: live rows whose time has come.
    index('workflow_reminders_due_idx')
      .on(t.dueAt)
      .where(sql`${t.resolvedAt} is null`),
    index('workflow_reminders_user_idx').on(t.staffUserId, t.dueAt),
  ],
);

/**
 * A reminder attached to ONE order or PO that fires when that job's status
 * becomes `triggerStatus` — a conditional/checkpoint reminder, as opposed to
 * `workflowReminders`' calendar-due-date kind. Deliberately a separate table
 * rather than a third `ReminderKind`: `workflowReminders`' one-live-row-per
 * -(entity,user,kind) unique index exists so re-snoozing extends in place,
 * which would be wrong here — a job can reasonably carry several pending
 * status reminders for different statuses at once.
 *
 * Fired via the outbox at the exact call sites that write `orders.status` /
 * `purchaseOrders.status` (see `fireDueStatusReminders` in
 * `server/workflow/status-reminders.ts`), not by a poll — so this is a
 * one-shot, exact-status-match check: a job whose status jumps past
 * `triggerStatus` without ever equaling it leaves the row pending until
 * someone cancels it.
 */
export const workflowStatusReminders = confirmation.table(
  'workflow_status_reminders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityType: text('entity_type').notNull().$type<'order' | 'purchase_order'>(),
    entityId: uuid('entity_id').notNull(),
    /** An OrderStatus or PoStatus value, validated at the API layer. */
    triggerStatus: text('trigger_status').notNull(),
    note: text('note').notNull(),
    createdByStaffUserId: uuid('created_by_staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    /** Null until the trigger status is reached. */
    firedAt: timestamp('fired_at', { withTimezone: true }),
    /** Null while pending. Set when it fires, or when cancelled beforehand. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // The lookup done at fire time: live rows for this entity.
    index('workflow_status_reminders_entity_idx')
      .on(t.entityType, t.entityId)
      .where(sql`${t.resolvedAt} is null`),
    index('workflow_status_reminders_creator_idx').on(t.createdByStaffUserId, t.resolvedAt),
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
  colorBooks: many(supplierColorBooks),
}));

export const supplierColorBooksRelations = relations(supplierColorBooks, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierColorBooks.supplierId],
    references: [suppliers.id],
  }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  order: one(orders, { fields: [purchaseOrders.orderId], references: [orders.id] }),
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  revisions: many(purchaseOrderRevisions),
  shipmentLinks: many(shipmentPurchaseOrders),
  supplierAccess: many(poSupplierAccess),
  files: many(poFiles),
  colorBook: one(supplierColorBooks, {
    fields: [purchaseOrders.colorBookId],
    references: [supplierColorBooks.id],
  }),
  createdByUser: one(staffUsers, {
    fields: [purchaseOrders.createdBy],
    references: [staffUsers.id],
  }),
}));

export const poFilesRelations = relations(poFiles, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [poFiles.poId],
    references: [purchaseOrders.id],
  }),
  comments: many(orderNotes),
}));

export const poSupplierAccessRelations = relations(poSupplierAccess, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [poSupplierAccess.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
}));

export const workflowStagesRelations = relations(workflowStages, ({ many }) => ({
  tasks: many(workflowStageTasks),
}));

export const workflowStageTasksRelations = relations(workflowStageTasks, ({ one, many }) => ({
  stage: one(workflowStages, {
    fields: [workflowStageTasks.stageId],
    references: [workflowStages.id],
  }),
  completions: many(workflowTaskCompletions),
}));

export const workflowTaskCompletionsRelations = relations(workflowTaskCompletions, ({ one }) => ({
  task: one(workflowStageTasks, {
    fields: [workflowTaskCompletions.taskId],
    references: [workflowStageTasks.id],
  }),
  // Polymorphic on (entityType, entityId), so there is deliberately no relation
  // to the entity itself — the service resolves it per board.
  confirmedBy: one(staffUsers, {
    fields: [workflowTaskCompletions.confirmedByStaffUserId],
    references: [staffUsers.id],
  }),
}));

export const inboxItemsRelations = relations(inboxItems, ({ one }) => ({
  staffUser: one(staffUsers, {
    fields: [inboxItems.staffUserId],
    references: [staffUsers.id],
    relationName: 'inboxRecipient',
  }),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  staffUser: one(staffUsers, {
    fields: [assignments.staffUserId],
    references: [staffUsers.id],
    relationName: 'assignee',
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
  garment: one(garments, { fields: [orderNotes.garmentId], references: [garments.id] }),
  poFile: one(poFiles, { fields: [orderNotes.poFileId], references: [poFiles.id] }),
  author: one(staffUsers, {
    fields: [orderNotes.authorStaffUserId],
    references: [staffUsers.id],
  }),
}));

export const garmentsRelations = relations(garments, ({ one, many }) => ({
  assets: many(orderAssets),
  order: one(orders, { fields: [garments.orderId], references: [orders.id] }),
  sizing: many(garmentSizing),
  images: many(mockupImages),
  sizeChartLinks: many(garmentSizeChartLinks),
  nameListEntries: many(garmentNameListEntries),
  garmentType: one(garmentTypes, {
    fields: [garments.garmentTypeId],
    references: [garmentTypes.id],
  }),
}));

export const garmentNameListEntriesRelations = relations(garmentNameListEntries, ({ one }) => ({
  garment: one(garments, { fields: [garmentNameListEntries.garmentId], references: [garments.id] }),
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
  guest: one(rosterGuests, { fields: [rosterMembers.guestId], references: [rosterGuests.id] }),
}));

export const rosterGuestsRelations = relations(rosterGuests, ({ one, many }) => ({
  order: one(orders, { fields: [rosterGuests.orderId], references: [orders.id] }),
  members: many(rosterMembers),
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
