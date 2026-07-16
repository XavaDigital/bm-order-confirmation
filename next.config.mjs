import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained server build so the same image runs on AWS App Runner,
  // Render, Fly, ECS, or a plain VM. Keep host-agnostic (see PROJECT_BRIEF.md §2).
  output: 'standalone',

  // Pin the tracing root to this project (the machine has other lockfiles higher up).
  outputFileTracingRoot: projectRoot,

  // This app must NOT be discoverable (PROJECT_BRIEF.md §1, §7).
  // robots.txt (app/robots.ts) + middleware X-Robots-Tag header back this up too.
  //
  // Standard hardening headers for an app that renders signed customer data
  // (PROJECT_BRIEF.md §7). Referrer-Policy matters extra here: magic-link
  // tokens live in the URL path, and the customer page links out to
  // invoice_url — don't leak the token via the Referer header on that hop.
  // process.env is read directly (not src/lib/env.ts) because this file runs
  // at Next config-load time, before the app's Zod env validation applies.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
