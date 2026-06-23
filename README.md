# BeastMode Order Confirmation

Customer-facing order confirmation portal + internal sales admin. First module of
the BeastMode sales platform. **Full scope, decisions, and build phases live in
[PROJECT_BRIEF.md](./PROJECT_BRIEF.md) — read that first.**

## Stack

- **Next.js (App Router)** + **TypeScript** — one deployable; API via route handlers.
- **Ant Design (antd)** — theming via `ConfigProvider` (BeastMode tokens in `src/lib/theme.ts`).
- **PostgreSQL** via **Drizzle ORM** — tables namespaced under the `confirmation` schema.
- Host-agnostic container (`output: 'standalone'`) — targets **AWS App Runner**, runs anywhere.

## Project layout

```
src/
  app/
    layout.tsx            root layout (antd registry + providers + noindex)
    page.tsx              admin landing (stub)
    robots.ts             disallow all (not discoverable)
    o/[token]/page.tsx    customer confirmation page (token-gated, BeastMode dark) — stub
    api/
      orders/route.ts     POST (create) + GET (list)  ← integration seam (BRIEF §15)
      orders/[id]/route.ts GET one
      health/route.ts     liveness probe
  db/
    schema.ts             full schema (BRIEF §6), under the `confirmation` pg schema
    index.ts              drizzle client (+ Transaction type)
  server/
    orders/contract.ts    zod ORDER CONTRACT — the documented create-order input
    orders/service.ts     createOrder / getOrderByToken / list  ← all order writes go here
    events/outbox.ts      domain_events outbox (order.confirmed etc.)
  lib/
    env.ts                validated env access
    theme.ts              BeastMode antd tokens (light + dark)
    tokens.ts             magic-link token gen + SHA-256 hashing
    api-auth.ts           internal x-api-key guard (stub for service-to-service auth)
  middleware.ts           X-Robots-Tag noindex on every response
```

## Getting started

1. **Install** (Node 20+):
   ```bash
   npm install
   ```
   > If npm errors with "config prefix cannot be changed from project config", it's a
   > global vs project `.npmrc` conflict on this machine — resolve your npm prefix, then retry.

2. **Configure env**: copy `.env.example` → `.env.local` and fill in `DATABASE_URL`
   (Supabase Postgres), `TOKEN_PEPPER`, and `INTERNAL_API_KEY`.

3. **Create the schema** (generates SQL from `src/db/schema.ts`, then applies it):
   ```bash
   npm run db:generate
   npm run db:migrate
   ```
   The generated migration includes `CREATE SCHEMA "confirmation"`.

4. **Run**:
   ```bash
   npm run dev
   ```
   - Admin stub: http://localhost:3000
   - Customer page: http://localhost:3000/o/<token> (get a token by creating an order)

## Creating a test order (the integration seam)

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "content-type: application/json" \
  -H "x-api-key: $INTERNAL_API_KEY" \
  -d '{
    "customer": { "name": "Acme FC", "email": "buyer@example.com", "clubName": "Acme FC" },
    "orderValue": { "amount": 1499.00, "currency": "NZD" },
    "garments": [{ "name": "Home Jersey", "fabrics": ["Polyester mesh"] }]
  }'
```

The response includes a one-time `token` + `url` — open the `url` to see the customer page.

## Docker / deploy

```bash
docker build -t bm-order-confirmation .
docker run -p 3000:3000 --env-file .env.local bm-order-confirmation
```
Point AWS App Runner (or any container host) at the image. Health check: `GET /health` →
served by `/api/health` (wire the App Runner health path to `/api/health`).

## Conventions

- **Never write order rows outside `src/server/orders/service.ts`** — it's the seam the
  future platform integrates through (BRIEF §15).
- **State changes emit a `domain_events` row in-transaction** (BRIEF §15).
- **Migrations are additive** once the DB is shared with the platform (BRIEF §15).
- Treat all customer input as untrusted; keep the customer surface minimal.
