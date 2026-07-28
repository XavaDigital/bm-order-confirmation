import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { verifyPassword } from '@/lib/password';
import { env } from '@/lib/env';
import { googleLogin, roleFromGrants } from '@/server/identity/client';
import { logger } from '@/lib/logger';

export class AuthError extends Error {
  constructor(message = 'Invalid email or password') {
    super(message);
    this.name = 'AuthError';
  }
}

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'sales' | 'admin';
  requiresMfa: boolean;
};

export async function loginStaff(email: string, password: string): Promise<AuthUser> {
  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.email, email.toLowerCase().trim()),
  });

  // Always run verify to prevent timing-based user enumeration.
  const hash = user?.passwordHash ?? '$2b$12$invalidhashforblindverification000000000000000000000000';
  const valid = await verifyPassword(password, hash);

  if (!user || !valid || !user.isActive) {
    throw new AuthError();
  }

  // Dormancy signal only — a failed stamp must never fail the login.
  try {
    await db
      .update(staffUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(staffUsers.id, user.id));
  } catch (err) {
    logger.error('[auth] failed to stamp lastLoginAt', err);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    requiresMfa: user.totpEnabled,
  };
}


// ---------------------------------------------------------------------------
// Fleet identity (bm-identity) sign-in
// ---------------------------------------------------------------------------

/**
 * Why a Google sign-in was refused. Kept distinct from AuthError because these
 * need visibly different words in front of the user — "your account is not set
 * up for this app" and "that did not work" are not the same message, and
 * conflating them sends people to the wrong person for help.
 */
export class IdentityAuthError extends Error {
  readonly reason: 'not_configured' | 'invalid_credential' | 'no_app_access' | 'unavailable' | 'disabled';

  constructor(reason: IdentityAuthError['reason'], message: string) {
    super(message);
    this.name = 'IdentityAuthError';
    this.reason = reason;
  }
}

/**
 * Sign in with a Google credential, through the fleet identity service.
 *
 * The bridge to a local `staff_users` row is tried in three steps, in this
 * order, and the order matters:
 *   1. by `identityUserId` — the durable link, unaffected by an email change;
 *   2. by email, but ONLY an email identity has verified, and stamp the link;
 *   3. create, because identity has already vouched for them and said they have
 *      a grant for this app.
 *
 * Local `isActive` still wins. Deactivating someone here must lock them out
 * immediately, without waiting for a change in another service — this app has to
 * be able to close its own door.
 */
export async function loginWithIdentity(credential: string): Promise<AuthUser> {
  const result = await googleLogin(credential);

  if ('reason' in result) {
    const messages: Record<string, string> = {
      not_configured: 'Google sign-in is not enabled on this server.',
      invalid_credential: 'That Google sign-in did not work. Please try again.',
      // NOT "unknown user": this is a real colleague without a grant for this app.
      no_app_access: 'Your account does not have access to the order portal yet. Ask an admin to grant it.',
      unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
    };
    throw new IdentityAuthError(result.reason, messages[result.reason]);
  }

  const { user: identity, access } = result;
  const role = roleFromGrants(identity.grants, env.IDENTITY_APP_ID) ?? normaliseRole(access.role);

  // 1. The durable link.
  let local = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.identityUserId, identity.id),
  });

  // 2. A verified email, bridged and stamped so step 1 works next time.
  if (!local && identity.email) {
    local = await db.query.staffUsers.findFirst({
      where: eq(staffUsers.email, identity.email.toLowerCase()),
    });
    if (local) {
      await db
        .update(staffUsers)
        .set({ identityUserId: identity.id })
        .where(eq(staffUsers.id, local.id));
    }
  }

  // 3. Create. Identity has verified the person AND confirmed a grant, so there
  // is nothing further to check — but the row still gets an unusable password
  // hash, so the account cannot be used through the password form.
  if (!local) {
    const [created] = await db
      .insert(staffUsers)
      .values({
        email: identity.email.toLowerCase(),
        name: identity.name ?? identity.email,
        passwordHash: UNUSABLE_PASSWORD_HASH,
        role: role ?? 'sales',
        identityUserId: identity.id,
      })
      .returning();
    local = created;
  }

  if (!local.isActive) {
    throw new IdentityAuthError('disabled', 'This account has been deactivated.');
  }

  // Keep the local role in step with the grant. `roleFromGrants` returns null
  // for anything this app does not understand, and null LEAVES THE ROLE ALONE —
  // an unrecognised role must never silently demote someone.
  const patch: Partial<typeof staffUsers.$inferInsert> = { lastLoginAt: new Date() };
  if (role && role !== local.role) patch.role = role;
  if (identity.name && identity.name !== local.name) patch.name = identity.name;

  try {
    await db.update(staffUsers).set(patch).where(eq(staffUsers.id, local.id));
  } catch (err) {
    // A failed stamp must never fail a login.
    logger.error('[auth] failed to update local user from identity', err);
  }

  return {
    id: local.id,
    email: local.email,
    name: patch.name ?? local.name,
    role: role ?? local.role,
    // Identity has already verified the person via Google; a second factor here
    // would be asking them to prove the same thing twice.
    requiresMfa: false,
  };
}

/** Map an identity role string onto this app's vocabulary, or null if foreign. */
function normaliseRole(role: string): 'sales' | 'admin' | null {
  return role === 'admin' || role === 'sales' ? role : null;
}

/**
 * A bcrypt-shaped string that no password can ever produce, so an
 * identity-created account cannot be signed into through the password form.
 * `verifyPassword` runs against it and always fails, which also keeps the
 * timing profile of the password path unchanged.
 */
const UNUSABLE_PASSWORD_HASH = '$2b$12$identityonlyaccountnopasswordlogin000000000000000000000';
