import type { MetadataRoute } from 'next';

// This app must not be discoverable (PROJECT_BRIEF.md §1, §7). Disallow everything.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
