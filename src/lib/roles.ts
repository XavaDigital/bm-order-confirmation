/**
 * Staff roles, and the ONE place their ordering is defined.
 *
 * Four roles, deliberately including a bottom one:
 *
 *  - `none`   — signed in, sees nothing. This is what an UNKNOWN or missing
 *               identity role resolves to. It exists so that a grant we cannot
 *               interpret fails closed instead of quietly becoming a working
 *               account: an unrecognised role must never be a way in.
 *  - `viewer` — read-only. Can look at orders, boards and checklists; cannot
 *               change anything.
 *  - `sales`  — the day-to-day operating role: create and edit orders, move
 *               cards, confirm checks, send purchase orders.
 *  - `admin`  — the above plus configuration, overrides and user management.
 *
 * Everything that asks "may this person…?" must go through here, so the answer
 * cannot drift between the API, the middleware and the UI.
 */
export const STAFF_ROLES = ['none', 'viewer', 'sales', 'admin'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles an admin may deliberately assign. `none` is a fallback, never a choice. */
export const ASSIGNABLE_ROLES = ['viewer', 'sales', 'admin'] as const satisfies readonly StaffRole[];

const RANK: Record<StaffRole, number> = {
  none: 0,
  viewer: 1,
  sales: 2,
  admin: 3,
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  none: 'No access',
  viewer: 'Viewer',
  sales: 'Sales',
  admin: 'Admin',
};

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  none: 'Signed in but cannot open the portal. Assign a role to give access.',
  viewer: 'Can see orders, boards and checklists. Cannot change anything.',
  sales: 'Can create and edit orders, move work, confirm checks and send purchase orders.',
  admin: 'Everything sales can do, plus configuration, overrides and user management.',
};

/** Is this a role this app understands at all? */
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export function hasAtLeast(role: StaffRole, minimum: StaffRole): boolean {
  return RANK[role] >= RANK[minimum];
}

/** May they open the portal and read? */
export function canRead(role: StaffRole): boolean {
  return hasAtLeast(role, 'viewer');
}

/** May they change anything? The single check every mutation is gated on. */
export function canWrite(role: StaffRole): boolean {
  return hasAtLeast(role, 'sales');
}

export function isAdmin(role: StaffRole): boolean {
  return role === 'admin';
}

/**
 * Map a role string from the identity service onto this app's vocabulary.
 *
 * Anything unrecognised — a role from another app's vocabulary, a typo, or no
 * grant value at all — becomes `none`. That is the whole point: identity may say
 * a person has access, but if it cannot say *what* access in words this app
 * understands, the safe reading is "none", not "the default".
 */
export function roleFromIdentity(value: string | null | undefined): StaffRole {
  return isStaffRole(value) && value !== 'none' ? value : 'none';
}
