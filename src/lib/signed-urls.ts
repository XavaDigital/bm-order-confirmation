/**
 * Shared signed-URL mappers for storage-backed DTO arrays.
 *
 * Both surfaces (admin and customer pages) repeatedly mapped size-chart and
 * mock-up image rows through `getSignedUrl()` with the same try/catch shape —
 * these helpers dedupe that. Storage failures (e.g. not configured in this
 * environment) never throw: chart URLs come back `null`, image URLs come back
 * as an empty string, matching the previous inline behaviour at every site.
 */
import { getSignedUrl } from '@/lib/storage';

const DEFAULT_TTL_SECONDS = 3600;

export interface SignedChartRef {
  name: string;
  storageKey: string | null;
  url: string | null;
  downloadUrl: string | null;
}

/**
 * Map size-chart refs (e.g. a garment's `sizeChartLinks[].sizeChart` rows, or
 * the roster services' `{ name, storageKey }` projections) to the customer DTO
 * shape with a signed view URL and a signed download (attachment) URL.
 */
export async function signChartRefs(
  charts: { name: string; storageKey?: string | null }[],
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<SignedChartRef[]> {
  return Promise.all(
    charts.map(async (chart) => {
      const storageKey = chart.storageKey ?? null;
      let url: string | null = null;
      let downloadUrl: string | null = null;
      try {
        if (storageKey) {
          const filename = storageKey.split('/').pop() ?? chart.name;
          [url, downloadUrl] = await Promise.all([
            getSignedUrl(storageKey, ttlSeconds),
            getSignedUrl(storageKey, ttlSeconds, {
              contentDisposition: `attachment; filename="${filename}"`,
            }),
          ]);
        }
      } catch {
        // Storage not configured in this environment — leave links null.
      }
      return { name: chart.name, storageKey, url, downloadUrl };
    }),
  );
}

/**
 * Enrich mock-up image rows with a signed `url` (full-size original) and
 * `thumbnailUrl` (the generated small copy, roadmap 7.3 — falls back to the
 * original's own signed URL when there is no `thumbnailStorageKey`, whether
 * because the row predates the feature or generation failed at upload time).
 * Preserves every input field; on storage failure both URLs are an empty
 * string so the row still renders without crashing.
 */
export async function signImageRefs<T extends { storageKey: string; thumbnailStorageKey?: string | null }>(
  images: T[],
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<(T & { url: string; thumbnailUrl: string })[]> {
  return Promise.all(
    images.map(async (img) => {
      let url = '';
      let thumbnailUrl = '';
      try {
        url = await getSignedUrl(img.storageKey, ttlSeconds);
        thumbnailUrl = img.thumbnailStorageKey
          ? await getSignedUrl(img.thumbnailStorageKey, ttlSeconds)
          : url;
      } catch {
        // Storage not configured — leave empty; image won't render but won't crash.
      }
      return { ...img, url, thumbnailUrl };
    }),
  );
}

/**
 * Enrich PO snapshot assets (`PoSnapshot.assets`) with one field the UI can
 * always link: the Drive `url`, or a short-lived signed URL for an uploaded
 * `storageKey`. Mirrors `GET /api/admin/orders/[id]/assets` — signed HERE, per
 * request, so nothing durable (the snapshot itself) ever holds an expiring
 * URL. Null on a storage hiccup; the row still renders, just not as a link.
 */
export async function signPoAssets<T extends { url: string | null; storageKey?: string | null }>(
  assets: T[],
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<(T & { downloadUrl: string | null })[]> {
  return Promise.all(
    assets.map(async (asset) => ({
      ...asset,
      downloadUrl: asset.url ?? (asset.storageKey ? await getSignedUrl(asset.storageKey, ttlSeconds).catch(() => null) : null),
    })),
  );
}
