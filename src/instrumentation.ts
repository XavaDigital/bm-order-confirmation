import type { Instrumentation } from 'next';

export async function register() {
  const { logger } = await import('@/lib/logger');
  logger.info('server starting', { runtime: process.env.NEXT_RUNTIME });
}

/**
 * Catches errors Next's own pipeline surfaces (Server Components, Route
 * Handlers, Server Actions) that never reach a route's own try/catch —
 * e.g. a render-time throw. Routes should still catch and log their own
 * errors via src/lib/logger.ts; this is the backstop for what they miss.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { logger } = await import('@/lib/logger');
  logger.error('unhandled request error', err, {
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routeType: context.routeType,
  });
};
