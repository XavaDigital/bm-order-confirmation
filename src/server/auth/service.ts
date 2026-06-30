import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { verifyPassword } from '@/lib/password';

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

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    requiresMfa: user.totpEnabled,
  };
}
