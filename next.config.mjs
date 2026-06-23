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
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

export default nextConfig;
