/**
 * Outbound client for the Sales Hub (bm-sales) Capability API — the fleet CRM.
 *
 * Modeled on Design Flow's HubService (bm-designflow apps/api/src/modules/hub/
 * hub.service.ts); contract source of truth: bm-sales/docs/capability-api.md.
 *
 * Discipline (fleet convention):
 *  - Dormant unless CAPABILITY_API_URL + CAPABILITY_API_SECRET are set — every
 *    call is a no-op/empty result, so the app runs fully standalone.
 *  - Best-effort and non-throwing: transport failures return null/[], never
 *    propagate. The hub being down must never break order workflows.
 *  - 5s timeout per call. Browser code never calls the hub directly (no CORS);
 *    admin routes under /api/admin/hub/* proxy on the server.
 *  - Hub customer ids are hints: the hub merges duplicates, and a merged-away
 *    id resolves one hop to the survivor (`resolvedFrom`) — callers should
 *    re-stamp their stored id when `resolvedFrom` comes back.
 */
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface HubCustomer {
  id: string;
  name: string;
  email?: string | null;
  isProvisional?: boolean;
  /** Set when the requested id was a merge tombstone — this row is the survivor. */
  resolvedFrom?: string;
}

export type CreateHubCustomerResult =
  | { outcome: 'linked'; customer: HubCustomer }
  | { outcome: 'ambiguous'; candidates: HubCustomer[] }
  | { outcome: 'error' };

const TIMEOUT_MS = 5_000;
const BULK_CHUNK = 100; // ids per request — 200-id URLs have hit 431s in the fleet

export function isHubConfigured(): boolean {
  return Boolean(env.CAPABILITY_API_URL && env.CAPABILITY_API_SECRET);
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; actingUser?: string } = {},
): Promise<Response | null> {
  if (!isHubConfigured()) return null;
  const base = env.CAPABILITY_API_URL!.replace(/\/+$/, '');
  try {
    return await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${env.CAPABILITY_API_SECRET}`,
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(init.actingUser && { 'X-Acting-User': init.actingUser }),
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.error('[hub] capability call failed:', path, err);
    return null;
  }
}

/** Normalize hub rows — search returns `displayName`, get returns `name`. */
function toCustomer(row: Record<string, unknown>): HubCustomer {
  return {
    id: String(row.id),
    name: String(row.name ?? row.displayName ?? ''),
    email: (row.email as string | null | undefined) ?? null,
    ...(row.isProvisional !== undefined && { isProvisional: Boolean(row.isProvisional) }),
    ...(typeof row.resolvedFrom === 'string' && { resolvedFrom: row.resolvedFrom }),
  };
}

/** Typeahead search. Returns [] when unconfigured or on any failure. */
export async function searchHubCustomers(query: string, limit = 20): Promise<HubCustomer[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await call(`/customers?search=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res?.ok) return [];
  try {
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows.map(toCustomer);
  } catch {
    return [];
  }
}

/** Single fetch; follows merge tombstones (result carries `resolvedFrom`). */
export async function getHubCustomer(id: string): Promise<HubCustomer | null> {
  const res = await call(`/customers/${encodeURIComponent(id)}`);
  if (!res?.ok) return null;
  try {
    return toCustomer((await res.json()) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Bulk fetch, chunked; unknown ids are silently omitted by the hub. */
export async function getHubCustomersByIds(ids: string[]): Promise<HubCustomer[]> {
  if (ids.length === 0 || !isHubConfigured()) return [];
  const out: HubCustomer[] = [];
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const chunk = ids.slice(i, i + BULK_CHUNK);
    const res = await call(`/customers?ids=${chunk.map(encodeURIComponent).join(',')}`);
    if (!res?.ok) continue;
    try {
      const rows = (await res.json()) as Record<string, unknown>[];
      out.push(...rows.map(toCustomer));
    } catch {
      // skip malformed chunk
    }
  }
  return out;
}

/**
 * Create (or link to) a hub customer — idempotent on email. A 409 means the
 * hub found multiple plausible candidates; the caller must disambiguate.
 */
export async function createHubCustomer(
  input: { name: string; email?: string },
  actingUser?: string,
): Promise<CreateHubCustomerResult> {
  const res = await call('/customers', { method: 'POST', body: input, actingUser });
  if (!res) return { outcome: 'error' };
  try {
    if (res.status === 409) {
      const body = (await res.json()) as { candidates?: Record<string, unknown>[] };
      return { outcome: 'ambiguous', candidates: (body.candidates ?? []).map(toCustomer) };
    }
    if (!res.ok) return { outcome: 'error' };
    return { outcome: 'linked', customer: toCustomer((await res.json()) as Record<string, unknown>) };
  } catch {
    return { outcome: 'error' };
  }
}
