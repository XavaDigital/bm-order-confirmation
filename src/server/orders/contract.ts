/**
 * The ORDER CONTRACT — the documented input shape for creating an order.
 *
 * This is the integration boundary (PROJECT_BRIEF.md §15): both the admin UI and
 * the future sales platform create orders by satisfying this contract, whether
 * over HTTP (`POST /api/orders`) or by importing the same schema directly.
 *
 * Keep it stable and additive. Breaking changes here are breaking changes for
 * every order source.
 */
import { z } from 'zod';
import { garmentTypeOptionSchema } from '@/server/garment-types/contract';

// {label: chosenValue} maps for garment-type option picks, fabric-field picks
// and custom sizing-column values — shared with the admin garment contracts.
export const selectedValuesSchema = z.record(z.string().max(300));

// The ONE sizing-row shape — the admin update contract derives from this
// (nullable fields clear values; null and undefined both land as column NULL).
export const sizingRowSchema = z.object({
  size: z.string().nullish(),
  playerName: z.string().nullish(),
  playerNumber: z.string().nullish(),
  /**
   * How many of this line to make. Optional and defaulted, so this is an
   * ADDITIVE change to the documented `POST /api/orders` contract — an existing
   * integrator that never sends it keeps getting one garment per row, which is
   * what a row meant before the field existed.
   *
   * Capped rather than unbounded: this is a garment count, and a fat-fingered
   * 100000 is a production run nobody meant to order.
   *
   * `.optional()` and NOT `.default(1)`: a Zod default makes the field REQUIRED
   * on the parsed output type, so every existing caller constructing a row in
   * TypeScript would have to start supplying it. The write sites default it
   * instead, which keeps this genuinely additive.
   */
  quantity: z.number().int().min(1).max(10_000).optional(),
  notes: z.string().nullish(),
  // Values for the garment's user-defined sizing columns ({label: value}).
  // Unknown labels are dropped on write — the garment's column definitions are
  // the allowlist, so a stale client can't smuggle arbitrary keys in.
  customValues: selectedValuesSchema.nullish(),
});


export const garmentSchema = z.object({
  name: z.string().min(1),
  fabrics: z.array(z.string()).optional().default([]),
  notes: z.string().optional(),
  sizing: z.array(sizingRowSchema).optional().default([]),
  // reference size-chart ids from the library to link to this garment
  sizeChartIds: z.array(z.string().uuid()).optional().default([]),
  // storage keys of already-uploaded mock-ups (upload happens separately)
  mockupStorageKeys: z.array(z.string()).optional().default([]),
  // optional garment-type preset: links the type, auto-attaches its size
  // charts, and defaults selectedOptions ({optionLabel: chosenValue})
  garmentTypeId: z.string().uuid().optional(),
  selectedOptions: selectedValuesSchema.optional(),
  // fabric picks per type fabric field ({fieldLabel: chosenFabric})
  selectedFabrics: selectedValuesSchema.optional(),
  // extra sizing-table columns for this garment; defaults from the garment type
  sizingColumns: z.array(garmentTypeOptionSchema).max(20).optional(),
});

export const createOrderSchema = z.object({
  // 'platform' when pushed in by the future sales platform; defaults to admin.
  source: z.enum(['internal_admin', 'platform']).optional().default('internal_admin'),
  externalRef: z.string().optional(),

  /**
   * OPTIONAL when `hubCustomerId` is given (David's ruling, fleet thread
   * 2026-07-31): the email relay carries the hub customer id, never a name —
   * a uuid is stable through renames and merges, a name string drifts. The
   * service resolves name/email from the hub at create time. Standalone
   * orders (no hub id) still require it — enforced by the superRefine below.
   */
  customer: z
    .object({
      name: z.string().min(1),
      email: z.string().email(),
      contact: z.string().optional(),
      clubName: z.string().optional(),
    })
    .optional(),

  /**
   * `name` is the order's staff-facing label ("Winter hoodies 2026") — a real
   * column since 2026-08-02 (David's ruling), settable from the email
   * composer's relay create or the admin UI, and pushed as the hub index
   * row's display name. `notes` is the composer's first note, folded into the
   * draft's internal notes so nothing the salesperson typed is lost.
   */
  name: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(4000).optional(),

  orderValue: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.string().length(3).default('NZD'),
    })
    .optional(),

  // http(s) only — .url() alone accepts javascript: (July assessment / R2 §2.3),
  // and this renders as a link in the admin UI.
  invoiceUrl: z.string().url().regex(/^https?:\/\//i, 'Only http(s) links').optional(),
  expectedShipDate: z.string().optional(), // ISO date (YYYY-MM-DD)
  deadlineDate: z.string().optional(),
  generalNotes: z.string().optional(),

  shipping: z
    .object({
      mode: z.enum(['prefilled', 'customer_entered', 'later']).default('prefilled'),
      address: z.record(z.unknown()).optional(),
    })
    .optional(),

  /**
   * A hub-linked relay create may arrive with NO garments — the email
   * composer is metadata-only and staff complete the draft here. Standalone
   * creates still need at least one; the superRefine at the bottom enforces
   * the pair of rules together.
   */
  garments: z.array(garmentSchema).default([]),

  // optionally enable the per-order confirmation code (default off — link alone works)
  requireAccessCode: z.boolean().optional().default(false),

  // Sales Hub CRM association (optional; see src/server/hub/client.ts).
  // The id is a hint into the hub's core.customer — no cross-DB FK.
  hubCustomerId: z.string().uuid().optional(),
  hubCustomerName: z.string().min(1).optional(),
  // The contact who placed the order (within the hub customer) — same
  // cross-DB-hint semantics. Set by the email-relay create and the admin UI.
  hubContactId: z.string().uuid().optional(),
  hubContactName: z.string().min(1).optional(),
  // One-way pointer to the originating DesignFlow project (their uuid —
  // rename/merge-stable per the fleet thread). No sync either direction.
  designProjectRef: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  // The pair of standalone-vs-relay rules. A hub-linked create may omit both
  // (the service resolves the customer from the hub; staff add garments); a
  // standalone create must carry both, as it always has.
  if (!value.hubCustomerId) {
    if (!value.customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customer'],
        message: 'customer is required unless hubCustomerId is given',
      });
    }
    if (value.garments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['garments'],
        message: 'an order needs at least one garment',
      });
    }
  }
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
