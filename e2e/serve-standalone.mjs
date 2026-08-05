// `output: 'standalone'` (next.config.mjs, needed for the Docker/App Runner
// deploy target) produces a self-contained server that does NOT include
// public/ or .next/static — the Dockerfile copies those in alongside it
// before running `node server.js` (never `next start`, which prints its own
// warning that it doesn't work with standalone output — in practice this
// isn't a cosmetic warning, it leaves RSC/Suspense streaming unable to
// resolve and every page hangs on its loading fallback forever). Mirror the
// same copy-then-run shape here so the e2e server matches what actually
// ships, instead of the two ways of running this app silently diverging.
import { cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standaloneDir = path.join(root, '.next', 'standalone');

cpSync(path.join(root, 'public'), path.join(standaloneDir, 'public'), { recursive: true });
cpSync(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'), { recursive: true });
// Standalone tracing can't see this (read with readFileSync at runtime, not
// imported — see the Dockerfile's comment on the equivalent COPY). Without
// it the startup check finds no journal and starts anyway, unverified.
cpSync(path.join(root, 'drizzle'), path.join(standaloneDir, 'drizzle'), { recursive: true });

// `next start`/`next dev` load .env.local automatically; a bare `node
// server.js` does not, so the standalone server would otherwise fail env
// validation for DATABASE_URL/TOKEN_PEPPER/etc. Values already present in
// process.env (playwright.config.ts's webServer.env overrides) win, as
// dotenv never overwrites an existing key.
loadEnv({ path: path.join(root, '.env.local'), quiet: true });

const child = spawn(process.execPath, ['server.js'], {
  cwd: standaloneDir,
  stdio: 'inherit',
  env: { ...process.env, HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0' },
});
child.on('exit', (code) => process.exit(code ?? 0));
