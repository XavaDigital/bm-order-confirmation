/**
 * Shared constants for production-file uploads (David, 2026-08-05) — one
 * allowlist for the staff route and the supplier route, so the two sides
 * cannot drift on what a legal file is.
 *
 * Extension-validated, not MIME (fonts/design files arrive as octet-stream
 * depending on the uploader's OS — same reasoning as the order-asset route).
 */
export const PO_FILE_EXTENSIONS = [
  // design/layout sources
  'ai', 'eps', 'pdf', 'svg', 'psd', 'cdr',
  // fonts (David, 2026-08-06: design AND font files belong on the PO)
  'otf', 'ttf', 'woff', 'woff2',
  // images (test print photos, proofs, reference images)
  'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff',
  // documents/sheets a factory sends back
  'xlsx', 'csv', 'zip',
] as const;

/** Layout sources run big; 50 MB covers every file the factories send today. */
export const PO_FILE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * The category vocabulary BOTH file surfaces suggest (free text stays legal —
 * these are the names the team already uses). One list so the admin card and
 * the supplier portal cannot drift (David, 2026-08-06: design and font
 * categories were missing).
 */
export const PO_FILE_CATEGORIES = [
  'Design file',
  'Font file',
  'Reference image',
  'Layout',
  'Test print',
  'Production layout',
] as const;
