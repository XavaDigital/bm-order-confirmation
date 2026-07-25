// URL-routing fetch mock for jsdom component tests.
//
// Components converted to the `@/lib/api-fetch` helpers often fetch on mount
// AND on user actions, which makes `mockResolvedValueOnce` queues brittle: an
// extra (or re-ordered) request silently consumes the wrong queued response.
// `installMockFetch` routes by URL pattern + method instead, so tests declare
// "requests to X answer with Y" and any unmatched request throws loudly.
//
// Usage:
//   const { fetchMock, addRoute } = installMockFetch([
//     { match: /\/api\/admin\/orders\/[^/]+\/roster$/, response: rosterData },
//   ]);
//   addRoute({ match: '/api/admin/orders/order-1/roster/members', method: 'POST', response: member });
//   expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'POST' }));
import { vi, type Mock } from 'vitest';

export interface MockRoute {
  /** String = exact URL match; RegExp = tested against the full URL. */
  match: RegExp | string;
  /** HTTP method to match (case-insensitive). Omit to match any method. */
  method?: string;
  /**
   * JSON body of the response. May be a function of (url, init) for dynamic
   * responses; it is invoked once per matched request.
   */
  response: unknown | ((url: string, init?: RequestInit) => unknown);
  /** HTTP status (default 200). `ok` is derived (2xx). */
  status?: number;
  /**
   * Consume this route after its first match. Later requests fall through to
   * earlier routes — useful for "first call succeeds, second fails" cases
   * without reintroducing a whole-test response queue.
   */
  once?: boolean;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function routeMatches(route: MockRoute, url: string, method: string): boolean {
  if (route.method && route.method.toUpperCase() !== method) return false;
  return typeof route.match === 'string' ? route.match === url : route.match.test(url);
}

function describeRoute(route: MockRoute): string {
  return `${route.method?.toUpperCase() ?? '*'} ${String(route.match)}`;
}

/**
 * Installs a `global.fetch` mock (via `vi.stubGlobal`) that answers requests by
 * URL pattern + method. When several routes match, the last-added route wins,
 * so tests can override a baseline route for a specific case. Unmatched
 * requests throw with the URL and the registered routes, turning silent test
 * drift into loud failures.
 */
export function installMockFetch(routes: MockRoute[] = []): {
  fetchMock: Mock;
  addRoute: (route: MockRoute) => void;
} {
  const table: MockRoute[] = [...routes];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    for (let i = table.length - 1; i >= 0; i--) {
      const route = table[i];
      if (!routeMatches(route, url, method)) continue;
      if (route.once) table.splice(i, 1);
      const status = route.status ?? 200;
      const body =
        typeof route.response === 'function'
          ? (route.response as (url: string, init?: RequestInit) => unknown)(url, init)
          : route.response;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as Response;
    }

    throw new Error(
      `mockFetch: no route matched ${method} ${url}\nRegistered routes:\n` +
        (table.length > 0 ? table.map((r) => `  - ${describeRoute(r)}`).join('\n') : '  (none)'),
    );
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    addRoute: (route: MockRoute) => {
      table.push(route);
    },
  };
}
