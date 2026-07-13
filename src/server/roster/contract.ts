/**
 * Team roster contract — Zod schemas for staff-side roster management
 * (TEAM_ROSTER_PLAN.md Phase 2). The customer-facing submission schema is
 * added alongside src/server/roster/customer-service.ts in a later phase.
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

// Column indices into a parsed CSV/XLSX sheet (see src/server/roster/import.ts) — the
// staff-confirmed mapping of "which column is which field" for a bulk import.
export const rosterImportMappingSchema = z.object({
  nameColumn: z.number().int().min(0),
  playerNumberColumn: z.number().int().min(0).nullable(),
  emailColumn: z.number().int().min(0).nullable(),
});

export type RosterImportMapping = z.infer<typeof rosterImportMappingSchema>;
