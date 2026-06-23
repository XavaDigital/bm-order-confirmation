# BeastMode Order Confirmation Portal — Implementation Plan

> **Based on:** `PROJECT_BRIEF.md` (last updated 2026-06-23) + scaffolded codebase audit.  
> **Status of Phase 1:** Complete. This plan covers Phases 2–8.

---

## Current State (Phase 1 — Done)

The foundation scaffold is in place. The following is already working:

| Concern | What exists |
|---|---|
| Next.js 15 App Router + TypeScript | `src/app/`, `tsconfig.json` |
| Database schema (12 tables, 7 enums) | `src/db/schema.ts` |
| Drizzle ORM + migrations pipeline | `drizzle.config.ts`, `npm run db:*` |
| Magic-link token generation + SHA-256 hashing | `src/lib/tokens.ts` |
| Order ingestion API (`POST /api/orders`) | `src/app/api/orders/route.ts` |
| Order service layer (createOrder, getOrderByToken) | `src/server/orders/service.ts` |
| Domain events outbox (order.viewed, order.confirmed) | `src/server/events/outbox.ts` |
| Customer token-gated route scaffold (`/o/[token]`) | `src/app/o/[token]/page.tsx` |
| BeastMode antd theme tokens (dark/light) | `src/lib/theme.ts` |
| Service-to-service API key auth | `src/lib/api-auth.ts` |
| `noindex` enforcement (middleware, metadata, robots.ts) | `src/middleware.ts`, `src/app/robots.ts` |
| Docker build (standalone output, multi-stage) | `Dockerfile` |
| Health probe | `src/app/api/health/route.ts` |
| Environment validation (Zod) | `src/lib/env.ts` |

---

## Architecture Principles (Non-negotiable)

1. **Order writes go through `src/server/orders/service.ts` only.** No business logic in route handlers or React components.
2. **Domain events are emitted in-transaction.** Every status change writes to `confirmation.domain_events` in the same DB transaction. No event can be silently lost.
3. **Token hashes only in DB.** Never persist raw tokens. Use `hashToken()` from `src/lib/tokens.ts`.
4. **Customer surface has zero enumeration.** `/o/[token]` returns a generic 404 for any invalid/expired/revoked state — no distinction.
5. **Schema is a shared contract.** Migrations must be additive once the DB is shared with the future platform. No destructive renames.
6. **API-first.** The admin UI must consume `POST /api/orders` — no internal shortcuts from UI components directly to service functions for order creation.

---

## Phase 2 — Staff Auth + Admin Shell

**Goal:** Sales/admin staff can log in, manage sessions, and navigate a functional admin layout.

### 2.1 Dependencies

```bash
npm install argon2 jose iron-session @types/iron-session
# or: npm install bcryptjs jsonwebtoken
```

Use **argon2** for password hashing (secure, modern). Use **iron-session** (encrypted, signed cookie, no DB needed for session store) or a JWT stored in an HTTP-only cookie.

Recommended: **iron-session** — simplest, works well with App Router Server Actions / Route Handlers.

### 2.2 Database changes

Migration needed — add to `src/db/schema.ts`:

- `staff_users` table already defined in schema. Confirm it is migrated: run `npm run db:generate && npm run db:migrate`.
- Add a seed script `src/db/seed.ts` that creates the first admin user (reads creds from env `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`). Never commit credentials.

### 2.3 Files to create/modify

| File | Action |
|---|---|
| `src/lib/session.ts` | iron-session config; `getSession()` helper; `SessionData` type |
| `src/lib/password.ts` | `hashPassword(plain)` + `verifyPassword(plain, hash)` using argon2 |
| `src/server/auth/service.ts` | `loginStaff(email, password)` — look up user, verify hash, return user or throw |
| `src/app/api/auth/login/route.ts` | `POST /api/auth/login` — calls auth service, sets session cookie |
| `src/app/api/auth/logout/route.ts` | `POST /api/auth/logout` — destroys session cookie |
| `src/app/api/auth/me/route.ts` | `GET /api/auth/me` — returns current session user (for client-side auth state) |
| `src/middleware.ts` | Extend: protect `/admin/**` routes — redirect to `/login` if no valid session |
| `src/app/login/page.tsx` | Login form (antd Form, email + password, BeastMode-adjacent style) |
| `src/app/login/actions.ts` | Server Action for form submit (calls login API, sets cookie, redirects) |
| `src/app/(admin)/layout.tsx` | Route group layout: sidebar nav, header, user menu (sales name + logout), dark/light mode toggle |
| `src/app/(admin)/dashboard/page.tsx` | Placeholder dashboard (phase 2 stub) |
| `src/db/seed.ts` | Seed script for first admin user |

### 2.4 Middleware logic

```
src/middleware.ts — request routing matrix
  /o/[token]  → public (no auth, token-gated in page.tsx)
  /api/health → public
  /api/orders → service-to-service (x-api-key, already done)
  /api/auth/* → public (login/logout)
  /login      → public (redirect to /admin/dashboard if already logged in)
  /admin/**   → require valid session cookie → redirect /login if not
  /api/admin/**  → require valid session → return 401 JSON if not
  everything else → 404 or redirect
```

### 2.5 Admin layout components

- `src/components/admin/AppShell.tsx` — antd `Layout` with Sider (nav links), Header (user info + dark/light toggle), Content area
- `src/components/admin/ThemeToggle.tsx` — client component; stores preference in `localStorage`; sets `theme.darkAlgorithm` or `theme.defaultAlgorithm` on `ConfigProvider`
- `src/components/admin/UserMenu.tsx` — antd `Dropdown` with user name + logout action

### 2.6 Acceptance criteria

- [ ] `POST /api/auth/login` with valid credentials sets session cookie and returns 200.
- [ ] Navigating to `/admin/dashboard` without a session redirects to `/login`.
- [ ] After login, user is redirected to `/admin/dashboard`.
- [ ] `POST /api/auth/logout` clears session and redirects to `/login`.
- [ ] Admin layout renders with navigation sidebar.
- [ ] Dark/light toggle persists across page refreshes.

---

## Phase 3 — Admin Order Management (CRUD)

**Goal:** Sales staff can create, view, edit, and manage orders; upload mock-ups; enter garment + sizing data; generate customer links.

### 3.1 API routes

All under `src/app/api/admin/` — these require staff session (middleware enforces).

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/orders` | GET | List orders (paginated, filterable by status) |
| `/api/admin/orders` | POST | Create order (delegates to existing `createOrder` service) |
| `/api/admin/orders/[id]` | GET | Get single order with all garments, sizing, images |
| `/api/admin/orders/[id]` | PATCH | Update order fields |
| `/api/admin/orders/[id]` | DELETE | Soft-delete or hard-delete (only draft orders) |
| `/api/admin/orders/[id]/garments` | POST | Add garment |
| `/api/admin/orders/[id]/garments/[garmentId]` | PATCH | Update garment |
| `/api/admin/orders/[id]/garments/[garmentId]` | DELETE | Remove garment |
| `/api/admin/orders/[id]/garments/[garmentId]/sizing` | POST | Add/replace sizing rows (bulk) |
| `/api/admin/orders/[id]/garments/[garmentId]/images` | POST | Upload mock-up image |
| `/api/admin/orders/[id]/garments/[garmentId]/images/[imgId]` | DELETE | Remove mock-up |
| `/api/admin/orders/[id]/token` | POST | Generate / regenerate token |
| `/api/admin/orders/[id]/token` | DELETE | Revoke token |

Extend `src/server/orders/service.ts` with:
- `getOrderAdmin(id)` — full hydration for admin view
- `updateOrder(id, patch)` — field-level update
- `deleteOrder(id)` — guard: only draft status
- `addGarment(orderId, data)`, `updateGarment(garmentId, data)`, `deleteGarment(garmentId)`
- `upsertSizingRows(garmentId, rows[])` — replaces all rows for garment in one transaction
- `generateAccessToken(orderId)` — wraps existing token logic, sets `order.status = 'sent'`
- `revokeAccessToken(orderId)` — marks token revoked (or deletes it)

### 3.2 File / upload handling

Add `src/lib/storage.ts`:
- Wrapper around S3-compatible SDK (use `@aws-sdk/client-s3` — works with Supabase Storage and AWS S3).
- `uploadFile(key, buffer, mimeType)` → returns storage key.
- `getSignedUrl(key, expiresInSeconds)` → temporary access URL.
- `deleteFile(key)`.

Environment variables to add to `src/lib/env.ts`:
```
STORAGE_ENDPOINT   # Supabase Storage URL or AWS endpoint
STORAGE_BUCKET     # Bucket name
STORAGE_REGION     # e.g. ap-southeast-2
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
```

Upload route (`/api/admin/orders/[id]/garments/[garmentId]/images`):
- Accept `multipart/form-data`.
- Validate: image types only (jpeg, png, webp, gif), max 10 MB.
- Generate a namespaced storage key: `mockups/{orderId}/{garmentId}/{nanoid()}.{ext}`.
- Store key + caption in `mockup_images` table.
- Return signed URL for immediate display in admin UI.

### 3.3 Admin UI pages

| Page | Route | Notes |
|---|---|---|
| Order list | `/admin/orders` | antd Table, status badge, search/filter, "New Order" button |
| New order | `/admin/orders/new` | Multi-step form or single long form |
| Order detail / edit | `/admin/orders/[id]` | Tabbed: Details / Garments / Share Link |
| Garment editor | Inline in order detail | Accordion per garment: mock-up uploader, sizing table, fabrics, notes, chart links |
| Share link panel | Tab in order detail | Show generated URL, copy button, revoke/regenerate, optional code toggle |

Key components to build under `src/components/admin/orders/`:

- `OrderForm.tsx` — antd Form for order-level fields (customer info, dates, value, notes, shipping mode, invoice URL)
- `GarmentAccordion.tsx` — antd Collapse, one panel per garment
- `MockupUploader.tsx` — antd Upload (dragger), preview grid, delete, reorder
- `SizingTable.tsx` — editable antd Table (inline editing for size/name/number/notes rows); "Add row" / "Remove row"
- `FabricsList.tsx` — antd Select (tags mode) or simple input list
- `SizeChartLinker.tsx` — multi-select from size_charts library
- `ShareLinkPanel.tsx` — display link, copy-to-clipboard (antd message), regenerate/revoke controls
- `OrderStatusBadge.tsx` — colored antd Tag per status

### 3.4 Order list dashboard

`/admin/orders` must show:
- Order number, customer name, club name, status badge, value, created date, last activity.
- Filter by status (pill tabs or dropdown).
- Search by customer name / order number.
- Clicking a row → order detail.
- "Create order" CTA.

### 3.5 Acceptance criteria

- [ ] Create an order with 2 garments, sizing rows, and mock-up images via admin UI.
- [ ] Order appears in the list with correct status.
- [ ] Edit order fields and save — changes persist.
- [ ] Upload mock-up image — appears in admin gallery.
- [ ] Delete a garment — removed from order.
- [ ] Generate customer link — URL copied to clipboard.
- [ ] Revoke and regenerate link — old token no longer works (verify by visiting old URL → 404).
- [ ] Order list filters by status correctly.

---

## Phase 4 — Customer Confirmation Page (Full)

**Goal:** The complete, branded customer-facing flow from link access to finalization.

### 4.1 Token gate + optional access code

In `src/app/o/[token]/page.tsx` (Server Component):
1. Hash incoming token → look up `order_access` by `token_hash`.
2. If not found / expired / revoked → `notFound()`.
3. If `access_code_hash` is set on this access row → render `AccessCodeGate` (client component) before showing order.
4. On first view: emit `order.viewed` domain event + update `order_access.last_viewed_at` + set `orders.status = 'viewed'` (if not already confirmed).

`AccessCodeGate` client component:
- Simple input + submit.
- POST to `/api/o/verify-code` with token + code → server validates hash, sets a short-lived session cookie (`access_verified:{token}`).
- On success, reloads the page (now passes gate).

### 4.2 Page layout (BeastMode style)

`src/app/o/[token]/view.tsx` — main client component (dark BeastMode theme via `ConfigProvider`):

```
┌─────────────────────────────────────────┐
│  BEASTMODE logo + "Order Confirmation"  │  ← Hero header (navy bg, white text)
│  Club: {club_name}  Order: {order_num}  │
├─────────────────────────────────────────┤
│  ORDER SUMMARY                          │  ← antd Descriptions card
│  Customer, dates, value, invoice link   │
├─────────────────────────────────────────┤
│  GARMENTS  (one section per garment)    │
│   ├─ Mock-up gallery (antd Image.Group) │
│   ├─ Fabrics list                       │
│   ├─ Sizing table (read-only)           │
│   ├─ Garment notes                      │
│   └─ Reference size charts (links)      │
├─────────────────────────────────────────┤
│  CONCERNS / COMMENTS  (optional text)   │
├─────────────────────────────────────────┤
│  SHIPPING ADDRESS                       │  ← depends on shipping_mode
├─────────────────────────────────────────┤
│  ACKNOWLEDGMENTS  (7 checkboxes)        │
├─────────────────────────────────────────┤
│  SIGNATURE  (draw or upload)            │
├─────────────────────────────────────────┤
│  [CONFIRM ORDER]  button                │
└─────────────────────────────────────────┘
```

### 4.3 Component breakdown

| Component | Location | Notes |
|---|---|---|
| `MockupGallery.tsx` | `src/components/customer/` | antd `Image.PreviewGroup` + `Image` grid; fetch signed URLs server-side |
| `SizingTableReadOnly.tsx` | `src/components/customer/` | antd Table, read-only, responsive |
| `AcknowledgmentPanel.tsx` | `src/components/customer/` | 7 antd Checkbox items, all required; tracks which are ticked |
| `ShippingAddressField.tsx` | `src/components/customer/` | Conditional: show prefilled address / form inputs / "will provide later" |
| `SignaturePad.tsx` | `src/components/customer/` | Two tabs: Draw (canvas, `react-signature-canvas`) or Upload (antd Upload); exports PNG blob |
| `ConfirmButton.tsx` | `src/components/customer/` | Disabled until all acks checked; shows antd Popconfirm before submitting |
| `ColorBookRequest.tsx` | `src/components/customer/` | "Request color book / sample" — sets a flag on acknowledgment row 2 |

### 4.4 Finalize API route

`POST /api/o/confirm` — public (token from request body, validated server-side):

1. Hash token → load `order_access` → verify not expired/revoked.
2. Load order — verify status is not already `confirmed` (idempotency guard).
3. Validate all 7 acknowledgments are present in request body.
4. Begin transaction:
   a. Write `acknowledgments` rows (ack_key, ack_text_version, accepted=true, accepted_at=now).
   b. If shipping mode is `customer_entered`, upsert `orders.shipping_address`.
   c. Save concerns/comments to `orders.general_notes` (append or a separate `customer_notes` field — decide at implementation).
   d. If signature provided: upload to storage (`signatures/{orderId}/{uuid}.png`); record type + key in `confirmations`.
   e. Write `confirmations` row with `confirmed_snapshot` JSONB (snapshot of order as seen — garments, sizing, fabrics, notes, dates, value, size chart NAMES).
   f. Write `conversion_events` row (status=`pending`, value, currency).
   g. Emit `order.confirmed` domain event to `domain_events`.
   h. Set `orders.status = 'confirmed'`, `orders.confirmed_at = now()`.
   i. Update `order_access.last_viewed_at`.
5. Commit.
6. After commit: attempt async Google Ads conversion fire (Phase 5). Do NOT block response on this.
7. Return `{ success: true }` → client shows success state.

**`confirmed_snapshot` JSONB structure:**
```json
{
  "order_number": "BM-0001",
  "customer_name": "...",
  "club_name": "...",
  "order_value_amount": "1500.00",
  "order_value_currency": "NZD",
  "expected_ship_date": "2026-09-01",
  "deadline_date": "2026-08-15",
  "invoice_url": "...",
  "general_notes": "...",
  "garments": [
    {
      "name": "Home Jersey",
      "fabrics": ["Polyester", "Mesh"],
      "notes": "Chinese collar",
      "sizing": [
        { "size": "M", "player_name": "Smith", "player_number": "7", "notes": "" }
      ],
      "size_chart_names": ["Adult Unisex Jersey"],
      "mockup_image_captions": ["Front view", "Back view"]
    }
  ],
  "shipping_address": { ... } | null
}
```

### 4.5 Success state

After `POST /api/o/confirm` returns:
- Replace page content with a full-screen success panel (BeastMode style).
- "Order Confirmed" heading, order number, timestamp.
- If GTM is wired (Phase 5): push `dataLayer` event here.
- No further edits possible. Token link now shows "This order has been confirmed" if revisited.

### 4.6 Acceptance criteria

- [ ] Visiting `/o/{invalid-token}` returns a generic 404 page (no detail about why).
- [ ] Visiting `/o/{valid-token}` shows all order data: mock-ups, sizing, fabrics, dates, value, invoice link.
- [ ] All 7 acknowledgment checkboxes are visible with correct text; Confirm button is disabled until all are ticked.
- [ ] Signature pad: can draw a signature (canvas); can upload an image; can skip (if business allows — confirm with brief §13 Q5).
- [ ] Clicking Confirm → success state shown; `orders.status` = `confirmed` in DB.
- [ ] `acknowledgments` rows written with correct `ack_key` and `ack_text_version`.
- [ ] `confirmations.confirmed_snapshot` contains a complete, immutable copy of the order state.
- [ ] `confirmations.ip_address` and `user_agent` recorded.
- [ ] Revisiting the link after confirmation shows "already confirmed" (not the form again).
- [ ] Page is noindex (verify with browser devtools — check response headers and `<meta>`).

---

## Phase 5 — Reference Size-Chart Library

**Goal:** Admins can maintain a reusable library of reference size charts (PDFs/images). Sales can link charts to garments. Customers can view/download them.

### 5.1 API routes (admin-only)

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/size-charts` | GET | List all size charts |
| `/api/admin/size-charts` | POST | Upload + create (multipart) |
| `/api/admin/size-charts/[id]` | PATCH | Update name/description |
| `/api/admin/size-charts/[id]` | DELETE | Remove (admin role only; warn if linked to garments) |

Service: `src/server/size-charts/service.ts`
- `createSizeChart(name, description, file)` — upload to storage → insert row.
- `listSizeCharts()` — returns all with signed URLs.
- `deleteSizeChart(id)` — check for garment links; warn but allow removal.

### 5.2 Garment linking

Already in schema (`garment_size_chart_links`). Wire in garment update endpoint:
- `PATCH /api/admin/orders/[id]/garments/[garmentId]` accepts `sizeChartIds: string[]`.
- Service upserts links (delete old, insert new, in transaction).

### 5.3 Admin UI

`/admin/size-charts` — page with:
- Table of charts (name, description, file type, upload date).
- Upload new chart (antd Upload + name/description form).
- Delete with confirmation.

In garment editor: `SizeChartLinker.tsx` — antd `Select` (multiple) populated from `/api/admin/size-charts`.

### 5.4 Customer page

On customer page, each garment shows linked charts as:
- Name + icon (PDF or image).
- Clicking opens a signed URL in a new tab (or modal for images).
- Signed URLs are generated server-side at page render time (short TTL, e.g. 1 hour).

At confirmation time, `confirmed_snapshot` records `size_chart_names` (names only — not URLs, which expire).

### 5.5 Acceptance criteria

- [ ] Admin can upload a PDF size chart, give it a name, and it appears in the library.
- [ ] Sales can link one or more charts to a garment.
- [ ] Customer page shows linked chart names with working download links.
- [ ] After deletion of a chart from the library, `confirmed_snapshot` for past orders still has the chart name (snapshot is immutable).

---

## Phase 6 — Google Ads Conversion + Domain Events

**Goal:** Fire a Google Ads Enhanced Conversion for Leads exactly once per confirmed order, idempotently. Domain events outbox enables this as a consumer pattern.

### 6.1 GTM client-side (first, easiest)

In the customer page success state (`view.tsx` after confirm):

```tsx
// Push to dataLayer after confirmation
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'order_confirmed',
  transaction_id: order.id,      // dedup key for Google
  value: order.orderValueAmount, // numeric
  currency: order.orderValueCurrency,
  email: order.customerEmail,    // GTM's Enhanced Conversions will hash this
});
```

GTM is configured in Google Tag Manager (external) — dev does not configure the tag itself, only emits the event. Requires `GTM_ID` env var in `src/lib/env.ts` and a `<Script>` tag in the layout.

Add to `src/app/layout.tsx` (guarded by `GTM_ID` env var):
```tsx
{process.env.NEXT_PUBLIC_GTM_ID && (
  <Script id="gtm" strategy="afterInteractive">
    {`(function(w,d,s,l,i){...})(window,document,'script','dataLayer','${process.env.NEXT_PUBLIC_GTM_ID}');`}
  </Script>
)}
```

Expose `NEXT_PUBLIC_GTM_ID` (public, client-safe).

### 6.2 Server-side conversion (recommended once GTM is verified)

Create `src/server/conversions/service.ts`:
- `fireGoogleAdsConversion(orderId)`:
  1. Load `conversion_events` row for order — if status=`sent`, return (idempotent).
  2. Hash customer email with SHA-256 (normalized: lowercase, trimmed).
  3. Call Google Ads API Enhanced Conversions for Leads endpoint.
  4. On success: update `conversion_events.status = 'sent'`, store `provider_response`.
  5. On failure: update `conversion_events.status = 'failed'`, store error response, log.

This is called **after commit** in the confirm route (fire-and-forget with error logging). A background retry job (cron or queue) can pick up `failed` rows.

Environment variables:
```
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CLIENT_ID        # OAuth2 client
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REFRESH_TOKEN
GOOGLE_ADS_CUSTOMER_ID
GOOGLE_ADS_CONVERSION_ID
GOOGLE_ADS_CONVERSION_LABEL
```

Add all to `src/lib/env.ts` (optional — skip if not set, use GTM path only).

### 6.3 Domain events outbox (already scaffolded)

`src/server/events/outbox.ts` emits to `confirmation.domain_events`. No additional work for the outbox itself — it's in place.

The conversion service is a **consumer** of the `order.confirmed` event conceptually, but in Phase 6 it's called directly from the confirm route. A proper outbox processor can be added in Phase 8 hardening.

### 6.4 Acceptance criteria

- [ ] After customer confirms, `conversion_events` row exists with correct `value_amount` and `value_currency`.
- [ ] `dataLayer` event `order_confirmed` is pushed on the success page (verify via GTM Preview or browser console).
- [ ] Confirming the same order twice does not create a second `conversion_events` row (idempotency guard in service).
- [ ] `domain_events` row with type `order.confirmed` exists after confirmation.

---

## Phase 7 — BeastMode Theming (Full Polish)

**Goal:** Customer-facing pages fully match the BeastMode brand. Admin has a polished dark/light toggle.

### 7.1 Brand extraction

Before starting UI work: visit `https://beastmode.co.nz` and extract:
- Exact hex values for primary palette (navy, accent red/green/orange, text colors).
- Font family names (inspect `font-family` in devtools).
- Border radii, spacing scale.

Encode in `src/lib/theme.ts` (already exists — finalize values):

```ts
export const beastmodeTokens = {
  colorPrimary: '#E4002B',          // confirm from site
  colorBgBase: '#0B1622',           // navy dark
  fontFamily: '"Bebas Neue", "Inter", sans-serif', // confirm from site
  borderRadius: 4,
  // etc.
};
```

Use antd's `ConfigProvider` with:
- `theme.darkAlgorithm` for customer page and admin dark mode.
- `theme.defaultAlgorithm` for admin light mode.

### 7.2 Customer page styling

Priority surface — full BeastMode treatment:
- Navy hero header with BeastMode logo (SVG/PNG asset in `public/`).
- Section headings in UPPERCASE bold.
- High-contrast white content cards on dark background.
- antd `Button` type=`primary` in brand red.
- Acknowledgment checkboxes styled with brand accent.
- Signature pad canvas: dark border, white draw area.
- Success state: full-bleed navy with large "CONFIRMED" heading and checkmark icon.

### 7.3 Admin styling

- Default light algorithm.
- Dark mode toggle in header saves to `localStorage`.
- `ThemeToggle.tsx` component updates `ConfigProvider` dynamically.
- Consistent spacing using antd's spacing tokens.

### 7.4 Global CSS

In `src/app/globals.css`:
- CSS variables mirroring antd tokens (for any non-antd elements).
- Font import (`@import` or `next/font/google`).
- Base reset / focus rings.

### 7.5 Acceptance criteria

- [ ] Customer page: navy header with BeastMode logo, uppercase headings, brand-red primary button.
- [ ] Admin page: clean functional layout, toggles between light and dark mode, preference persists.
- [ ] No unstyled flash on SSR (antd registry in `layout.tsx` is in place).
- [ ] Fonts load correctly (no fallback flash).

---

## Phase 8 — Hardening, Security, and Operational Readiness

**Goal:** Production-safe. Rate limited, audited, signed URLs, email sending, security review done.

### 8.1 Rate limiting

Add `src/middleware.ts` rate limiting for:
- `/o/[token]` token lookups — max 20 req/min per IP (prevent token brute-force).
- `/api/o/confirm` — max 5 req/min per IP.
- `/api/auth/login` — max 10 req/min per IP.

Use an in-memory store for single-instance deployments or Redis for multi-instance. For App Runner (single container initially), `lru-cache`-based in-memory limiter is acceptable to start.

Library: `src/lib/rate-limit.ts` wrapping a simple sliding window counter.

### 8.2 Signed URLs for all stored assets

- Mock-up images, size chart files, and signatures must **never** be served with public URLs.
- Storage bucket must be private.
- All file access goes through `storage.getSignedUrl(key, ttl)`.
- In admin UI: sign URLs at request time (short TTL: 4 hours).
- On customer page: sign URLs at server render time (1 hour TTL — sufficient for a review session).
- If a customer bookmarks a signed URL, it will expire — that is expected and acceptable.

### 8.3 Upload validation

In every file upload handler:
- Validate `Content-Type` against an allowlist.
- Enforce max size (mock-ups: 10 MB; size charts: 20 MB; signatures: 5 MB).
- Reject files with mismatched magic bytes vs. claimed MIME type. Use `file-type` npm package.
- Consider ClamAV scan for signatures/PDFs (nice-to-have, not blocking).

### 8.4 Audit log

Create `src/server/audit/service.ts`:
- `logStaffAction(staffId, action, entityType, entityId, metadata)` — insert to an `audit_log` table.

Add `audit_log` table to schema:
```
audit_log
  id (uuid, pk)
  staff_id (fk, nullable — null for customer actions)
  action        -- 'order.created' | 'order.updated' | 'token.generated' | 'token.revoked' | 'order.deleted' | etc.
  entity_type   -- 'order' | 'garment' | 'size_chart' | etc.
  entity_id     -- uuid of the entity
  metadata      -- jsonb (changed fields, previous values, etc.)
  ip_address
  created_at
```

Log in every service write operation. Keep it async (fire-and-forget) — don't let audit failure block business operations.

### 8.5 Email — sending magic links

Wire Mailgun (`src/lib/email.ts`):
- `sendMagicLink(to, { customerName, confirmationUrl, orderNumber, accessCode? })`.
- HTML email template (minimal, on-brand; plain-text fallback).
- Triggered from admin "Send Link" action in Share Link panel.

The admin UI "Send to customer" button:
- Calls `POST /api/admin/orders/[id]/send-link`.
- Server sends email via Mailgun, records `orders.status = 'sent'` if currently `draft`.

Environment variables: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAIL_FROM` (already in `.env.example`).

### 8.6 CSRF protection

For admin state-changing routes (PATCH, DELETE, POST that aren't file uploads):
- iron-session includes a CSRF token approach, or use the `double-submit cookie` pattern.
- Alternatively, since the admin uses same-origin API calls (not cross-origin), the `SameSite=Strict` cookie alone provides CSRF protection for XHR/fetch. Document this decision.

### 8.7 Security headers

Add to `next.config.mjs`:
```js
headers: [
  {
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      // X-Robots-Tag is already set in middleware.ts
    ],
  },
]
```

### 8.8 Acceptance criteria

- [ ] Hitting `/o/{token}` 25 times in a minute from same IP returns 429.
- [ ] Mock-up images are served via signed URLs (not public storage URLs).
- [ ] Uploading a non-image file to the mock-up endpoint returns 400.
- [ ] Every admin write action appears in `audit_log`.
- [ ] Admin "Send Link" button sends a Mailgun email to customer with correct URL.
- [ ] Security headers present on all responses (check with Mozilla Observatory or `curl -I`).

---

## Phase 9 — Nice-to-Haves (Post-MVP)

Implement after the above phases are complete and working in production.

### 9.1 "Changes Requested" flow

- Customer sees a "Request Changes" button alongside (or instead of) Confirm.
- Submitting opens a free-text comment form: what needs to change.
- Server: sets `orders.status = 'changes_requested'`; emits `order.changes_requested` domain event.
- Admin sees the request in the order detail; can update and send a new link (or the same link if not revoked).

### 9.2 Email notifications to sales on confirm

- When `order.confirmed` event fires, send an email to the order's `created_by` staff member.
- "Your customer {name} has confirmed order {number}."
- Reuse `src/lib/email.ts`.
- Wire as a second consumer of `order.confirmed` domain event.

### 9.3 PDF export of confirmed order

- Admin can download a PDF summary of a confirmed order (for internal records / dispute resolution).
- Include: customer info, garments, sizing table, acknowledgments with timestamps, signature image.
- Library: `@react-pdf/renderer` or `puppeteer` (headless Chrome) to render the existing customer page and capture.

### 9.4 Two-factor authentication (admin)

- TOTP-based 2FA for admin role accounts.
- Library: `otplib`.
- Add `totp_secret` (encrypted) to `staff_users`.
- Required at login for admin role; optional for sales.

### 9.5 Outbox processor (background job)

- A periodic job (cron-like, or triggered by webhook) processes `domain_events` rows with `status = 'pending'`.
- Calls registered handlers (Google Ads conversion, email notification, future platform webhook).
- Marks rows `delivered` or `failed`.
- Removes dependency on synchronous post-commit fire for conversions.

---

## Open Questions (from PROJECT_BRIEF §13)

These must be resolved before or during development — flag them to the business owner:

| # | Question | Blocks |
|---|---|---|
| 1 | Google Ads Conversion ID + label (and Enhanced Conversions enabled)? | Phase 6 |
| 2 | Final wording sign-off for all 7 acknowledgment checkboxes? | Phase 4 |
| 3 | Single currency (NZD) or multi-currency? | Phase 3 (order form) |
| 4 | Mock-up images: garment-level or order-level? (Schema is garment-level) | Phase 3 |
| 5 | What happens if the customer wants changes after confirming? ("changes_requested" flow) | Phase 4 or 9.1 |
| 6 | Data retention policy — how long to keep customer data & signatures? | Phase 8 (soft-delete / TTL) |
| 7 | GTM ID (for client-side conversion — needed for Phase 6 GTM path) | Phase 6 |

---

## Dependency Map

```
Phase 1 (done)
  └─→ Phase 2 (staff auth + admin shell)
        └─→ Phase 3 (admin order CRUD)
              ├─→ Phase 4 (customer confirmation page) — can start once order creation works
              ├─→ Phase 5 (size chart library) — independent after Phase 3
              └─→ Phase 6 (conversion tracking) — needs Phase 4 finalize route
                    └─→ Phase 7 (theming) — can run in parallel from Phase 4 onward
Phase 8 (hardening) — can start incrementally from Phase 3 onward (rate limiting, headers)
Phase 9 (nice-to-haves) — after Phase 8
```

---

## Environment Variables Reference

Full list. Add all to `.env.local` locally and to hosting secrets in production.

```bash
# Database
DATABASE_URL=                      # postgresql://... (Supabase or self-hosted)

# Application
APP_BASE_URL=http://localhost:3000  # Public URL for customer links
TOKEN_PEPPER=                       # 32+ random hex bytes (secret mixed into token hash)
INTERNAL_API_KEY=                   # Shared secret for /api/orders (service-to-service)

# Session
SESSION_SECRET=                     # 32+ random bytes for iron-session cookie encryption

# Storage (S3-compatible)
STORAGE_ENDPOINT=                   # e.g. https://<project>.supabase.co/storage/v1/s3
STORAGE_BUCKET=bm-order-assets
STORAGE_REGION=ap-southeast-2
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=

# Email (Mailgun)
MAILGUN_API_KEY=
MAILGUN_DOMAIN=                     # e.g. mg.beastmode.co.nz
MAIL_FROM=orders@beastmode.co.nz

# Google Ads (Phase 6)
NEXT_PUBLIC_GTM_ID=                 # GTM container ID (public, client-safe)
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_CONVERSION_ID=
GOOGLE_ADS_CONVERSION_LABEL=

# Seeding (never commit values)
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
```

---

## File / Folder Conventions

```
src/
  app/
    (admin)/             # Route group — admin-only, session-protected
      layout.tsx         # Admin shell (sidebar, header, theme provider)
      dashboard/
      orders/
      size-charts/
    api/
      admin/             # Protected: requires staff session
        orders/
        size-charts/
      auth/              # Public (login/logout/me)
      o/                 # Public (customer token verify + confirm)
        verify-code/
        confirm/
    login/               # Public login page
    o/[token]/           # Customer confirmation page (public, token-gated)
  components/
    admin/               # Admin-only UI components
    customer/            # Customer-page UI components
    shared/              # Used in both
  db/
    index.ts             # Drizzle client
    schema.ts            # All table definitions
    seed.ts              # Dev seed script
  lib/
    api-auth.ts          # Service-to-service auth (existing)
    email.ts             # Mailgun wrapper
    env.ts               # Zod env validation (extend as vars are added)
    password.ts          # argon2 hash/verify
    rate-limit.ts        # Sliding window rate limiter
    session.ts           # iron-session config + helpers
    storage.ts           # S3-compatible storage wrapper
    theme.ts             # antd theme tokens (existing)
    tokens.ts            # Magic-link token utils (existing)
  server/
    audit/service.ts     # Audit log writer
    auth/service.ts      # loginStaff, etc.
    conversions/service.ts  # Google Ads conversion fire
    events/outbox.ts     # Domain event emission (existing)
    orders/
      contract.ts        # Zod schema for order API contract (existing)
      service.ts         # All order business logic (existing, extend here)
    size-charts/service.ts
  middleware.ts           # Route protection + noindex headers (existing, extend)
```

---

## Key npm Packages to Add

| Package | Phase | Purpose |
|---|---|---|
| `argon2` | 2 | Password hashing |
| `iron-session` | 2 | Session cookie (HTTP-only, encrypted) |
| `@aws-sdk/client-s3` | 3 | S3-compatible file storage |
| `@aws-sdk/s3-request-presigner` | 3 | Signed URL generation |
| `file-type` | 3 | MIME type validation from magic bytes |
| `react-signature-canvas` | 4 | Signature draw pad (canvas) |
| `form-data` | 6 | Multipart for Mailgun API calls |
| `google-ads-api` | 6 | Server-side Google Ads Enhanced Conversions |
| `otplib` | 9.4 | TOTP 2FA |
| `@react-pdf/renderer` | 9.3 | PDF generation |

---

*Last updated: 2026-06-23. Update this document as open questions in §13 of PROJECT_BRIEF.md are resolved.*
