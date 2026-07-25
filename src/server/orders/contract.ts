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

// The ONE sizing-row shape — the admin update contract derives from this
// (nullable fields clear values; null and undefined both land as column NULL).
export const sizingRowSchema = z.object({
  size: z.string().nullish(),
  playerName: z.string().nullish(),
  playerNumber: z.string().nullish(),
  notes: z.string().nullish(),
});

// {label: chosenValue} maps for garment-type option picks and fabric-field
// picks — shared with the admin garment contracts.
export const selectedValuesSchema = z.record(z.string().max(300));

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
});

export const createOrderSchema = z.object({
  // 'platform' when pushed in by the future sales platform; defaults to admin.
  source: z.enum(['internal_admin', 'platform']).optional().default('internal_admin'),
  externalRef: z.string().optional(),

  customer: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    contact: z.string().optional(),
    clubName: z.string().optional(),
  }),

  orderValue: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.string().length(3).default('NZD'),
    })
    .optional(),

  invoiceUrl: z.string().url().optional(),
  expectedShipDate: z.string().optional(), // ISO date (YYYY-MM-DD)
  deadlineDate: z.string().optional(),
  generalNotes: z.string().optional(),

  shipping: z
    .object({
      mode: z.enum(['prefilled', 'customer_entered', 'later']).default('prefilled'),
      address: z.record(z.unknown()).optional(),
    })
    .optional(),

  garments: z.array(garmentSchema).min(1, 'an order needs at least one garment'),

  // optionally enable the per-order confirmation code (default off — link alone works)
  requireAccessCode: z.boolean().optional().default(false),

  // Sales Hub CRM association (optional; see src/server/hub/client.ts).
  // The id is a hint into the hub's core.customer — no cross-DB FK.
  hubCustomerId: z.string().uuid().optional(),
  hubCustomerName: z.string().min(1).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
