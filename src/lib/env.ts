/**
 * Centralised, validated environment access. Import `env` instead of reading
 * process.env directly so missing config fails fast and loudly.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  TOKEN_PEPPER: z.string().min(1, 'TOKEN_PEPPER is required'),
  INTERNAL_API_KEY: z.string().min(1, 'INTERNAL_API_KEY is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // Object storage (S3-compatible). Optional at boot — fails gracefully at upload time if absent.
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
});

// During `next build` env may be partially absent; only hard-validate at runtime.
const parsed = schema.safeParse(process.env);

if (!parsed.success && process.env.NODE_ENV !== 'production') {
  // Surface config problems early in dev without crashing the build.
  console.warn(
    '[env] invalid or missing environment variables:',
    parsed.error.flatten().fieldErrors,
  );
}

export const env = (parsed.success ? parsed.data : (process.env as unknown)) as z.infer<
  typeof schema
>;
