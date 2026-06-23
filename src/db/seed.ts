/**
 * Creates (or updates) the first admin user.
 * Run once after migrations: npm run db:seed
 *
 * Required env vars (in .env.local):
 *   SEED_ADMIN_EMAIL
 *   SEED_ADMIN_PASSWORD  (min 8 chars)
 *   SEED_ADMIN_NAME      (optional, defaults to "Admin")
 */
import { sql } from 'drizzle-orm';
import { db } from './index';
import { staffUsers } from './schema';
import { hashPassword } from '@/lib/password';

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() ?? 'Admin';

  if (!email || !password) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env.local');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('SEED_ADMIN_PASSWORD must be at least 8 characters');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  await db
    .insert(staffUsers)
    .values({ email: email.toLowerCase(), passwordHash, name, role: 'admin' })
    .onConflictDoUpdate({
      target: staffUsers.email,
      set: { passwordHash, name, updatedAt: sql`now()` },
    });

  console.log(`✓ Admin user ready: ${email}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
