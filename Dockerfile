# Host-agnostic container for the Next.js standalone server (PROJECT_BRIEF.md §2).
# Targets AWS App Runner but runs anywhere that takes a container.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone output bundles only what the server needs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The migration journal, for the startup check in src/server/db/startup-check.ts.
# Standalone tracing cannot see this: it is read with readFileSync at runtime,
# not imported, so nothing in the module graph points at it. Without this COPY
# the check finds no journal, reports "unknown", and starts anyway — which is
# exactly what it did on revision 00011, silently protecting nothing.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
