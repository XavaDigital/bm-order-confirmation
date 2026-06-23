/**
 * Database schema — mirrors PROJECT_BRIEF.md §6.
 *
 * Everything is namespaced under the `confirmation` Postgres schema so it can
 * coexist with the future shared sales-platform tables (BRIEF §15).
 */
import { sql, relations } from 'drizzle-orm';
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
]);

// --- staff users -----------------------------------------------------------
export const staffUsers = confirmation.table('staff_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: staffRole('role').notNull().default('sales'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
    orderValueCurrency: text('order_value_currency').default('NZD'),
    invoiceUrl: text('invoice_url'),

    expectedShipDate: date('expected_ship_date'),
    deadlineDate: date('deadline_date'),

    generalNotes: text('general_notes'),
    shippingMode: shippingMode('shipping_mode').notNull().default('prefilled'),
    shippingAddress: jsonb('shipping_address'),

    status: orderStatus('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => staffUsers.id),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('orders_external_ref_uq')
      .on(t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    index('orders_status_idx').on(t.status),
  ],
);

// --- order access (magic link) --------------------------------------------
export const orderAccess = confirmation.table(
  'order_access',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // SHA-256 of the high-entropy token (+ pepper). We look up by hashing the
    // incoming token, so a DB leak never exposes a live link. (BRIEF §7)
    tokenHash: text('token_hash').notNull().unique(),
    // only set when the optional per-order confirmation code is enabled (default off)
    accessCodeHash: text('access_code_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('order_access_order_idx').on(t.orderId)],
);

// --- garments (line items) -------------------------------------------------
export const garments = confirmation.table(
  'garments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    fabrics: jsonb('fabrics'), // list of planned fabrics
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('garments_order_idx').on(t.orderId)],
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
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('garment_sizing_garment_idx').on(t.garmentId)],
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
    uniqueIndex('garment_size_chart_uq').on(t.garmentId, t.sizeChartId),
  ],
);

// --- acknowledgments (one row per checkbox, audit trail) ------------------
export const acknowledgments = confirmation.table(
  'acknowledgments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ackKey: text('ack_key').notNull(), // 'color_accuracy' | 'mockup_correct' | ...
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
  confirmedSnapshot: jsonb('confirmed_snapshot').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
});

// --- Google Ads conversion events -----------------------------------------
export const conversionEvents = confirmation.table('conversion_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  valueAmount: numeric('value_amount', { precision: 12, scale: 2 }),
  valueCurrency: text('value_currency'),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  status: conversionStatus('status').notNull().default('pending'),
  providerResponse: jsonb('provider_response'),
});

// --- domain events outbox (platform integration, BRIEF §15) ---------------
export const domainEvents = confirmation.table(
  'domain_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aggregateType: text('aggregate_type').notNull(), // 'order'
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(), // 'order.confirmed' | 'order.viewed' | ...
    payload: jsonb('payload').notNull(),
    status: eventStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    index('domain_events_status_idx').on(t.status),
    index('domain_events_aggregate_idx').on(t.aggregateType, t.aggregateId),
  ],
);

// --- relations (no DB migration needed — type-level only for db.query.* API) ---

export const ordersRelations = relations(orders, ({ many }) => ({
  garments: many(garments),
  access: many(orderAccess),
}));

export const garmentsRelations = relations(garments, ({ one, many }) => ({
  order: one(orders, { fields: [garments.orderId], references: [orders.id] }),
  sizing: many(garmentSizing),
  images: many(mockupImages),
  sizeChartLinks: many(garmentSizeChartLinks),
}));

export const garmentSizingRelations = relations(garmentSizing, ({ one }) => ({
  garment: one(garments, { fields: [garmentSizing.garmentId], references: [garments.id] }),
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
}));

export const orderAccessRelations = relations(orderAccess, ({ one }) => ({
  order: one(orders, { fields: [orderAccess.orderId], references: [orders.id] }),
}));
