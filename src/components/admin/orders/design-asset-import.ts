/**
 * Pure helpers for the DesignFlow asset pull (fleet thread 2026-07-31,
 * designflow's read-assets contract). Separated from the modal because jsdom
 * cannot exercise the fetch/upload loop — these are the decisions worth
 * unit-testing.
 */
import type { OrderAssetKind } from '@/db/schema';

/** One row of designflow's GET /api/action/v1/projects/:id/assets response. */
export interface DesignFlowAsset {
  id: string;
  kind: 'approved_design' | 'font' | 'reference';
  name: string;
  garment?: string;
  variation?: string;
  thumbnailUrl?: string;
  downloadUrl: string;
}

/** DesignFlow's asset classes → our order-asset kinds. */
export function orderAssetKindFor(kind: DesignFlowAsset['kind']): OrderAssetKind {
  if (kind === 'approved_design') return 'design';
  if (kind === 'font') return 'font';
  return 'other';
}

/** Display name for the imported row — approved designs get their garment/variation label. */
export function importedAssetName(asset: DesignFlowAsset): string {
  const context = [asset.garment, asset.variation].filter(Boolean).join(' — ');
  return context ? `${asset.name} (${context})` : asset.name;
}

/** Must stay in sync with the upload route's ALLOWED_EXTENSIONS. */
const UPLOADABLE_EXTENSIONS = new Set([
  'otf', 'ttf', 'woff', 'woff2',
  'ai', 'eps', 'pdf', 'svg', 'png', 'jpg', 'jpeg', 'webp',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/postscript': 'ai',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
};

/**
 * A filename our upload route will accept, or null when neither the presigned
 * URL's key nor the byte response's Content-Type yields a known extension.
 * (The route validates by extension — fonts arrive as octet-stream, so the S3
 * key path is the primary source and the mime the fallback.)
 */
export function uploadFilenameFor(
  asset: DesignFlowAsset,
  contentType: string | null,
): string | null {
  let ext: string | null = null;
  try {
    const path = new URL(asset.downloadUrl).pathname;
    const fromPath = path.split('.').pop()?.toLowerCase() ?? '';
    if (UPLOADABLE_EXTENSIONS.has(fromPath)) ext = fromPath;
  } catch {
    // unparseable URL — fall through to the mime type
  }
  if (!ext && contentType) {
    ext = EXTENSION_BY_MIME[contentType.split(';')[0].trim().toLowerCase()] ?? null;
  }
  if (!ext) return null;

  // The display name may already carry the extension; don't double it.
  const base = asset.name.toLowerCase().endsWith(`.${ext}`)
    ? asset.name.slice(0, -(ext.length + 1))
    : asset.name;
  return `${base}.${ext}`;
}
