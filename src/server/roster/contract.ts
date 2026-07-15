/**
 * Team roster contract — Zod schemas for staff-side roster management
 * (TEAM_ROSTER_PLAN.md Phases 2 and 5).
 */
import { z } from 'zod';

export const addRosterMemberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  playerNumber: z.string().trim().max(20).optional(),
  email: z.string().trim().max(254).email().optional(),
});

export const updateRosterMemberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200).optional(),
  playerNumber: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().max(254).email().nullable().optional(),
});

export type AddRosterMemberInput = z.infer<typeof addRosterMemberSchema>;
export type UpdateRosterMemberInput = z.infer<typeof updateRosterMemberSchema>;

export const submitMemberSizesSchema = z.object({
  sizes: z
    .array(
      z.object({
        garmentId: z.string().min(1),
        size: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/[a-zA-Z0-9]/, 'Size must include at least one letter or number'),
      }),
    )
    .min(1)
    .max(200),
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

// How to resolve same-name rows whose other details don't confirm a match (see
// src/server/roster/service.ts `importRosterMembers`) — omitted on the first
// commit attempt; the caller re-sends it once staff have confirmed.
export const duplicateResolutionSchema = z.enum(['importAll', 'skipAmbiguous']).optional();
