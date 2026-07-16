import { eq, desc, and, isNull, or } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { generateToken, hashToken } from '@/lib/tokens';
import { hashPassword } from '@/lib/password';
import { env } from '@/lib/env';
import { recordAuditEvent } from '@/server/events/outbox';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

export class UserConflictError extends Error {
  constructor() {
    super('A user with that email already exists');
    this.name = 'UserConflictError';
  }
}

export class LastAdminError extends Error {
  constructor() {
    super('Cannot remove the last admin user');
    this.name = 'LastAdminError';
  }
}

export class InviteExpiredError extends Error {
  constructor() {
    super('This invite link has expired or is invalid');
    this.name = 'InviteExpiredError';
  }
}

export class ResetTokenExpiredError extends Error {
  constructor() {
    super('This password reset link has expired or is invalid');
    this.name = 'ResetTokenExpiredError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StaffUserRow = {
  id: string;
  email: string;
  name: string;
  role: 'sales' | 'admin';
  isActive: boolean;
  isPending: boolean; // true = invited but not yet accepted
  lastLoginAt: Date | null; // null = never logged in
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listStaffUsers(): Promise<StaffUserRow[]> {
  const users = await db.query.staffUsers.findMany({
    orderBy: (u, { desc }) => [desc(u.createdAt)],
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    isPending: Boolean(u.inviteTokenHash),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

const INVITE_TTL_MS = 72 * 60 * 60 * 1_000; // 72 hours
const PLACEHOLDER_HASH = '$2b$12$invitedplaceholderhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

export async function inviteUser(
  name: string,
  email: string,
  role: 'sales' | 'admin',
): Promise<{ rawToken: string; setupUrl: string }> {
  const existing = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.email, email.toLowerCase().trim()),
  });
  if (existing) throw new UserConflictError();

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await db.insert(staffUsers).values({
    email: email.toLowerCase().trim(),
    name: name.trim(),
    role,
    passwordHash: PLACEHOLDER_HASH,
    isActive: false,
    inviteTokenHash: tokenHash,
    inviteTokenExpiresAt: expiresAt,
  });

  const base = env.APP_BASE_URL.replace(/\/$/, '');
  const setupUrl = `${base}/accept-invite?token=${rawToken}`;

  return { rawToken, setupUrl };
}

// ---------------------------------------------------------------------------
// Accept invite
// ---------------------------------------------------------------------------

export async function acceptInvite(rawToken: string, password: string): Promise<void> {
  const tokenHash = hashToken(rawToken);

  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.inviteTokenHash, tokenHash),
  });

  if (!user || !user.inviteTokenExpiresAt || user.inviteTokenExpiresAt < new Date()) {
    throw new InviteExpiredError();
  }

  const passwordHash = await hashPassword(password);

  await db
    .update(staffUsers)
    .set({
      passwordHash,
      isActive: true,
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(staffUsers.id, user.id));
}

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

const RESET_TTL_MS = 60 * 60 * 1_000; // 1 hour — shorter-lived than an invite

export async function requestPasswordReset(
  email: string,
): Promise<{ rawToken: string; resetUrl: string; userName: string; userEmail: string } | null> {
  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.email, email.toLowerCase().trim()),
  });

  // Deactivated accounts and still-pending invites can't log in anyway (see
  // loginStaff), and a pending invite should be completed via its own invite
  // link — don't issue a reset token for either. Caller treats this the same
  // as success (no account-existence enumeration).
  if (!user || !user.isActive) return null;

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  // Overwriting the single reset-token column invalidates any prior
  // outstanding reset link for this user.
  await db
    .update(staffUsers)
    .set({ resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt })
    .where(eq(staffUsers.id, user.id));

  await recordAuditEvent({
    aggregateType: 'staff_user',
    aggregateId: user.id,
    eventType: 'staff.password_reset_requested',
    payload: { email: user.email },
  });

  const base = env.APP_BASE_URL.replace(/\/$/, '');
  const resetUrl = `${base}/reset-password?token=${rawToken}`;

  return { rawToken, resetUrl, userName: user.name, userEmail: user.email };
}

export async function resetPassword(rawToken: string, password: string): Promise<void> {
  const tokenHash = hashToken(rawToken);

  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.resetTokenHash, tokenHash),
  });

  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    throw new ResetTokenExpiredError();
  }

  const passwordHash = await hashPassword(password);

  // Deliberately leaves isActive, totpEnabled/totpSecret/totpBackupCodes
  // untouched — a password reset must not silently reactivate an account or
  // clear an existing 2FA enrollment.
  await db
    .update(staffUsers)
    .set({
      passwordHash,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(staffUsers.id, user.id));

  await recordAuditEvent({
    aggregateType: 'staff_user',
    aggregateId: user.id,
    eventType: 'staff.password_reset_completed',
    payload: { email: user.email },
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateUser(
  id: string,
  patch: { role?: 'sales' | 'admin'; isActive?: boolean },
): Promise<StaffUserRow> {
  return db.transaction(async (tx) => {
    const user = await tx.query.staffUsers.findFirst({ where: eq(staffUsers.id, id) });
    if (!user) throw new UserNotFoundError();

    const demotingRole = patch.role === 'sales';
    const deactivating = patch.isActive === false;

    // Prevent demoting/deactivating the last admin. Row-lock every active
    // admin (`FOR UPDATE`) before counting: a concurrent transaction trying to
    // demote a different admin blocks on this lock until we commit, then
    // re-evaluates the WHERE clause against our committed change — so it can
    // never observe a stale count that lets it also pass the check.
    if (user.role === 'admin' && (demotingRole || deactivating)) {
      const activeAdmins = await tx
        .select({ id: staffUsers.id })
        .from(staffUsers)
        .where(and(eq(staffUsers.role, 'admin'), eq(staffUsers.isActive, true)))
        .for('update');

      if (activeAdmins.length <= 1) {
        throw new LastAdminError();
      }
    }

    const [updated] = await tx
      .update(staffUsers)
      .set({
        ...(patch.role !== undefined && { role: patch.role }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(staffUsers.id, id))
      .returning();

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      isActive: updated.isActive,
      isPending: Boolean(updated.inviteTokenHash),
      lastLoginAt: updated.lastLoginAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Delete (only pending/invited users who never logged in)
// ---------------------------------------------------------------------------

export async function deleteUser(id: string): Promise<void> {
  const user = await db.query.staffUsers.findFirst({ where: eq(staffUsers.id, id) });
  if (!user) throw new UserNotFoundError();

  // Only allow deleting users who are still in the invited/pending state.
  if (user.isActive || !user.inviteTokenHash) {
    throw new Error('Only pending invited users can be deleted. Deactivate active users instead.');
  }

  await db.delete(staffUsers).where(eq(staffUsers.id, id));
}
