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

export interface HubContact {
  id: string;
  name: string;
  email?: string | null;
  /** Set when a future contact merge tombstones the requested id. */
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

/**
 * Rows from a hub customer response, tolerating both shapes: the live
 * endpoints wrap in `{ items: [...] }`; a bare array is accepted too so a
 * hub-side envelope change can't silently blank every picker again (the
 * search shipped expecting an array and returned [] against the real
 * `{items}` envelope — found live 2026-08-02).
 */
function customerRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const items = (body as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

/** Typeahead search. Returns [] when unconfigured or on any failure. */
export async function searchHubCustomers(query: string, limit = 20): Promise<HubCustomer[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await call(`/customers?search=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res?.ok) return [];
  try {
    return customerRows(await res.json()).map(toCustomer);
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
      out.push(...customerRows(await res.json()).map(toCustomer));
    } catch {
      // skip malformed chunk
    }
  }
  return out;
}

/**
 * Push an order's aggregate production status to the hub, keyed by the hub's
 * own order reference (orders.externalRef). Best-effort/non-throwing like
 * everything here. NOTE: the hub-side inbound endpoint is a PROPOSAL — this
 * ships dormant; coordinate the contract with bm-sales before enabling
 * (see PO_PLAN "Hub write-back").
 */
export async function pushProductionStatus(
  hubOrderRef: string,
  status: string,
): Promise<boolean> {
  const res = await call(`/orders/${encodeURIComponent(hubOrderRef)}/production-status`, {
    method: 'POST',
    body: { status },
  });
  return Boolean(res?.ok);
}

/**
 * A customer's ACTIVE contacts — the picker surface. Historical rendering of
 * an order's contact goes through getHubContact instead, which by contract
 * answers for ended memberships (never filter history on active membership —
 * fleet trap 3).
 */
export async function listHubCustomerContacts(customerId: string): Promise<HubContact[]> {
  const res = await call(`/customers/${encodeURIComponent(customerId)}/contacts`);
  if (!res || !res.ok) return [];
  try {
    const body = (await res.json()) as { items?: Record<string, unknown>[] } | Record<string, unknown>[];
    const rows = Array.isArray(body) ? body : (body.items ?? []);
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? row.displayName ?? ''),
      email: (row.email as string | null | undefined) ?? null,
    }));
  } catch {
    return [];
  }
}

export interface HubCustomerProject {
  /** The HUB project id (not DesignFlow's). */
  hubProjectId: string;
  name: string;
  designStatus?: string | null;
  /**
   * DesignFlow's project uuid, from the `design_tool` external reference —
   * the value orders.design_project_ref stores (rename/merge-stable, fleet
   * thread D3). Null when the hub project has no DesignFlow counterpart,
   * in which case there is nothing to link an order to.
   */
  designProjectRef: string | null;
}

/**
 * A hub customer's design projects, for the order↔project link picker.
 * Reads the same aggregation MailFlow's tabs use (`/customers/:id/projects`,
 * paginated envelope); tombstoned customer ids resolve one hop hub-side.
 */
export async function listHubCustomerProjects(customerId: string): Promise<HubCustomerProject[]> {
  const res = await call(`/customers/${encodeURIComponent(customerId)}/projects?limit=100`);
  if (!res?.ok) return [];
  try {
    const body = (await res.json()) as {
      items?: Array<{
        id?: unknown;
        name?: unknown;
        designStatus?: unknown;
        externalReferences?: Array<{ system?: unknown; externalId?: unknown }>;
      }>;
    };
    return (body.items ?? []).map((row) => ({
      hubProjectId: String(row.id),
      name: String(row.name ?? ''),
      designStatus: typeof row.designStatus === 'string' ? row.designStatus : null,
      designProjectRef:
        row.externalReferences?.find((r) => r.system === 'design_tool')?.externalId != null
          ? String(row.externalReferences.find((r) => r.system === 'design_tool')!.externalId)
          : null,
    }));
  } catch {
    return [];
  }
}

/** One contact by id — answers for ended memberships and soft-deleted rows. */
export async function getHubContact(contactId: string): Promise<HubContact | null> {
  const res = await call(`/contacts/${encodeURIComponent(contactId)}`);
  if (!res || !res.ok) return null;
  try {
    const row = (await res.json()) as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name ?? row.displayName ?? ''),
      email: (row.email as string | null | undefined) ?? null,
      ...(typeof row.resolvedFrom === 'string' && { resolvedFrom: row.resolvedFrom }),
    };
  } catch {
    return null;
  }
}

/**
 * Register this order's THIN index row on the hub (fleet thread
 * 2026-07-31-orders-from-email, David's ruling: the projects pattern).
 * Idempotent on (system:'order_platform', externalId = our order uuid) —
 * replay returns the existing row. Read the BODY, not the status code.
 * Returns the hub order id to stamp onto orders.hub_order_id, or null on any
 * failure (callers are fire-and-forget; the next push heals by re-registering).
 */
export async function registerHubOrder(input: {
  customerId: string;
  contactId?: string | null;
  orderNumber: string;
  /** The index row's display label (salesflow's live contract requires it). */
  name: string;
  status: string;
  orderValue?: number | null;
  currency?: string | null;
  externalId: string;
  url: string;
}): Promise<string | null> {
  const res = await call('/orders', {
    method: 'POST',
    body: { ...input, system: 'order_platform' },
  });
  if (!res || !res.ok) return null;
  try {
    const body = (await res.json()) as { id?: string; order?: { id?: string } };
    return body.id ?? body.order?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Snapshot push to the hub index row — status chip, value, url. Snapshot-not-
 * events (designflow D1): a dropped push is healed by the next one, so
 * best-effort is safe; the outbox retry on top makes it at-least-once.
 */
export async function patchHubOrder(
  hubOrderId: string,
  patch: {
    status?: string;
    orderValue?: number | null;
    currency?: string | null;
    url?: string;
    orderNumber?: string;
    /** An explicit rename of the index row (hub accepts since bm-sales 00060). */
    name?: string;
  },
): Promise<boolean> {
  const res = await call(`/orders/${encodeURIComponent(hubOrderId)}`, {
    method: 'PATCH',
    body: patch,
  });
  return Boolean(res?.ok);
}

/**
 * Reverse lookup on the hub's external-reference registry: recover the HUB
 * entity id from our own (or a sibling's) id. Used to find the hub project id
 * for a DesignFlow project uuid (`system:'design_tool'`) — the action-token
 * mint is keyed by the HUB id, while we deliberately store DesignFlow's
 * rename/merge-stable uuid.
 */
export async function lookupHubEntityId(
  system: string,
  externalId: string,
  entityType: 'customer' | 'order' | 'project',
): Promise<string | null> {
  const res = await call(
    `/external-references?system=${encodeURIComponent(system)}&externalId=${encodeURIComponent(externalId)}`,
  );
  if (!res?.ok) return null;
  try {
    const rows = (await res.json()) as Array<{ entityType?: string; entityId?: string }>;
    return rows.find((r) => r.entityType === entityType)?.entityId ?? null;
  } catch {
    return null;
  }
}

export type MintActionTokenResult =
  | { outcome: 'ok'; token: string; expiresAt: string }
  | { outcome: 'refused'; status: number; message: string }
  | { outcome: 'error' };

/**
 * Action-token brokerage (capability-api.md): the hub authorises, DesignFlow
 * mints, and OUR BROWSER then calls DesignFlow's /api/action/v1 directly with
 * the token — bytes never transit the hub or our server. `hubProjectId` is the
 * HUB project id (see lookupHubEntityId); `actingUser` is the staff member's
 * identity user id and is required by the hub.
 *
 * Refusals are surfaced with the hub's status so the route can explain WHY the
 * picker cannot open (409 = DesignFlow doesn't know the project, 403 = acting
 * user not permitted, 503/502 = brokerage down) instead of a blanket failure.
 */
export async function mintProjectActionToken(
  hubProjectId: string,
  action: string,
  actingUser: string,
): Promise<MintActionTokenResult> {
  const res = await call(`/projects/${encodeURIComponent(hubProjectId)}/action-tokens`, {
    method: 'POST',
    body: { action },
    actingUser,
  });
  if (!res) return { outcome: 'error' };
  try {
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return {
        outcome: 'refused',
        status: res.status,
        message: body.message ?? `The hub refused the token (${res.status})`,
      };
    }
    const body = (await res.json()) as { token?: string; expiresAt?: string };
    if (!body.token) return { outcome: 'error' };
    return { outcome: 'ok', token: body.token, expiresAt: body.expiresAt ?? '' };
  } catch {
    return { outcome: 'error' };
  }
}

/**
 * Ingest one item onto the hub's customer communications timeline
 * (`POST /communications`, capability-api.md §7). Idempotent hub-side on
 * (channel, externalRef) — a replay returns the existing row — so callers may
 * safely re-run. Fleet convention (salesflow, thread 2026-07-31): the timeline
 * is the customer's cross-fleet history; push only what belongs there.
 */
export async function postHubCommunication(input: {
  channel: 'note';
  direction: 'inbound' | 'outbound';
  occurredAt: Date;
  customerId: string;
  contactId?: string | null;
  /** The HUB order id (orders.hub_order_id), not our own uuid. */
  orderId?: string | null;
  externalRef: string;
  subject: string;
  snippet?: string | null;
}): Promise<boolean> {
  // The hub validates optional fields with .optional(), which rejects null —
  // absent fields must be OMITTED, not sent as null.
  const res = await call('/communications', {
    method: 'POST',
    body: {
      channel: input.channel,
      direction: input.direction,
      sourceApp: 'orders',
      occurredAt: input.occurredAt.toISOString(),
      customerId: input.customerId,
      externalRef: input.externalRef,
      subject: input.subject,
      ...(input.contactId != null && { contactId: input.contactId }),
      ...(input.orderId != null && { orderId: input.orderId }),
      ...(input.snippet != null && { snippet: input.snippet }),
    },
  });
  return Boolean(res?.ok);
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
