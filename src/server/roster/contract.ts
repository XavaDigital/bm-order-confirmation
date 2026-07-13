/**
 * Team roster contract — Zod schemas for staff-side roster management
 * (TEAM_ROSTER_PLAN.md Phases 2 and 5).
 */
import { z } from 'zod';

export const addRosterMemberSchema = z.object({
  name: z.string().min(1),
  playerNumber: z.string().optional(),
  email: z.string().email().optional(),
});

export const updateRosterMemberSchema = z.object({
  name: z.string().min(1).optional(),
  playerNumber: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
});

export type AddRosterMemberInput = z.infer<typeof addRosterMemberSchema>;
export type UpdateRosterMemberInput = z.infer<typeof updateRosterMemberSchema>;

export const submitMemberSizesSchema = z.object({
  sizes: z
    .array(
      z.object({
        garmentId: z.string().min(1),
        size: z.string().trim().min(1).max(64),
      }),
    )
    .min(1),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [i, row] of value.sizes.entries()) {
    if (seen.has(row.garmentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizes', i, 'garmentId'],
        message: 'Duplicate garment submitted',
      });
      continue;
    }
    seen.add(row.garmentId);
  }
});

export type SubmitMemberSizesInput = z.infer<typeof submitMemberSizesSchema>;

// Column indices into a parsed CSV/XLSX sheet (see src/server/roster/import.ts) — the
// staff-confirmed mapping of "which column is which field" for a bulk import.
export const rosterImportMappingSchema = z.object({
  nameColumn: z.number().int().min(0),
  playerNumberColumn: z.number().int().min(0).nullable(),
  emailColumn: z.number().int().min(0).nullable(),
});

export type RosterImportMapping = z.infer<typeof rosterImportMappingSchema>;
