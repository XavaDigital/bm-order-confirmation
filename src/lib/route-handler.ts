/**
 * Route-handler wrapper — the ONE place the per-route boilerplate lives:
 * auth gating, JSON parsing + Zod validation, and the error-to-status mapping
 * that was previously copy-pasted across ~60 route files.
 *
 * Usage:
 *   export const POST = defineRoute({
 *     auth: 'admin',
 *     schema: createThingSchema,
 *     tag: 'things POST',
 *     handler: async ({ body, session }) => NextResponse.json(await createThing(body), { status: 201 }),
 *   });
 *
 * Auth modes:
 *  - 'public'      — no session; token/rate-limit checks are the handler's job.
 *  - 'staff'       — any authenticated staff session (middleware already 401s
 *                    unauthenticated /api/admin requests; this re-checks for
 *                    defense in depth and hands the session to the handler).
 *  - 'admin'       — staff session with role === 'admin'.
 *  - 'capability'  — fleet inbound bearer (INBOUND_CAPABILITY_SECRET) +
 *                    required X-Acting-User; handler receives actingUser.
 *
 * Error contract (uniform across the app):
 *  - schema parse failure     → 400 { error: 'Invalid request', details }
 *  - *NotFoundError thrown    → 404 { error: err.message }
 *  - *ConflictError thrown    → 409 { error: err.message }
 *  - *UnavailableError thrown → 503 { error: err.message } — server-side
 *    dependency misconfigured (e.g. rejected storage credentials); the message
 *    is actionable for staff, so it is surfaced rather than swallowed.
 *  - anything else            → 500 { error: 'Internal server error' } + logger.error
 */
import { NextRequest, NextResponse } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';
import { getSession, requireAdmin, type SessionData } from '@/lib/session';
import { checkCapabilityAuth } from '@/lib/api-auth';
import {
  badRequest,
  unauthorized,
  serviceUnavailable,
  serverError,
} from '@/lib/api-responses';
import { logger } from '@/lib/logger';

type AuthMode = 'public' | 'staff' | 'admin' | 'capability';

export interface RouteContext<P, B> {
  request: NextRequest;
  params: P;
  /** Parsed + validated body (undefined when no schema was given). */
  body: B;
  /** Staff session — null for 'public' and 'capability' routes. */
  session: SessionData | null;
  /** X-Acting-User header value — only set for 'capability' routes. */
  actingUser: string | null;
}

interface RouteConfig<P, B> {
  auth: AuthMode;
  /** Short logger tag, e.g. 'garment-types POST'. */
  tag: string;
  schema?: ZodType<B, ZodTypeDef, unknown>;
  handler: (ctx: RouteContext<P, B>) => Promise<NextResponse> | NextResponse;
}

function isNamed(err: unknown, suffix: string): err is Error {
  return err instanceof Error && err.name.endsWith(suffix);
}

/**
 * The route context is declared as two overloads, and THE ORDER MATTERS.
 *
 * Next 15 generates a validator per route that rejects a handler whose context
 * can be `undefined` (`Type 'undefined' is not assignable to type
 * 'RouteContext'`), so a single optional parameter fails the build. It fails
 * only in `npm run build` — `npm run typecheck` does not look at `.next/types`.
 *
 * TypeScript resolves `T extends (a: any, b: infer B) => any` against the LAST
 * overload, so the required form must come second for Next to see it. Tests that
 * invoke a param-less route as `POST(request)` match the first overload, which is
 * honest: the implementation defaults the params to `{}` when no context arrives.
 */
export function defineRoute<P = Record<string, never>, B = undefined>(
  config: RouteConfig<P, B>,
): {
  (request: NextRequest): Promise<NextResponse>;
  (request: NextRequest, routeArgs: { params: Promise<P> }): Promise<NextResponse>;
} {
  return async (request: NextRequest, routeArgs?: { params: Promise<P> }) => {
    try {
      let session: SessionData | null = null;
      let actingUser: string | null = null;

      if (config.auth === 'staff') {
        session = await getSession();
        if (!session.userId) return unauthorized();
      } else if (config.auth === 'admin') {
        const check = await requireAdmin();
        if (check.error) return check.error;
        session = check.session ?? null;
      } else if (config.auth === 'capability') {
        const auth = checkCapabilityAuth(request);
        if (auth === 'unconfigured') {
          return serviceUnavailable('Capability surface not configured');
        }
        if (auth === 'unauthorized') return unauthorized();
        actingUser = request.headers.get('x-acting-user');
        if (!actingUser) {
          return NextResponse.json(
            { error: 'X-Acting-User header is required' },
            { status: 400 },
          );
        }
      }

      let body = undefined as B;
      if (config.schema) {
        const raw = await request.json().catch(() => null);
        const parsed = config.schema.safeParse(raw);
        if (!parsed.success) return badRequest(parsed.error);
        body = parsed.data;
      }

      const params = routeArgs ? await routeArgs.params : ({} as P);

      return await config.handler({ request, params, body, session, actingUser });
    } catch (err) {
      if (isNamed(err, 'NotFoundError')) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (isNamed(err, 'ConflictError')) {
        // A conflict often has a LIST behind it ("these three checks are still
        // outstanding"). An error class may attach that as `details`, which is
        // passed through so the UI can show the list rather than one sentence
        // that makes the user go hunting. Omitted entirely when absent, so the
        // common shape stays `{ error }`.
        const details = (err as { details?: unknown }).details;
        return NextResponse.json(
          details === undefined ? { error: err.message } : { error: err.message, details },
          { status: 409 },
        );
      }
      if (isNamed(err, 'UnavailableError')) {
        // Misconfigured server dependency — log it too, since it needs an ops fix.
        logger.error(`[${config.tag}]`, err);
        return serviceUnavailable(err.message);
      }
      logger.error(`[${config.tag}]`, err);
      return serverError();
    }
  };
}
