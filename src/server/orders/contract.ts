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

export const sizingRowSchema = z.object({
  size: z.string().optional(),
  playerName: z.string().optional(),
  playerNumber: z.string().optional(),
  notes: z.string().optional(),
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
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
