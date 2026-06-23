# Order Confirmation Portal — Project Brief

> **Audience:** Developer(s) picking up this project, possibly with the assistance of Claude.
> **Status:** Greenfield. Nothing built yet.
> **Last updated:** 2026-06-23

---

## 1. Overview

We sell custom-manufactured garments (sports kits / uniforms with names, numbers, mock-ups, and sizing). Before an order goes to production, the customer must review and **confirm** the order details so we are protected against costly mistakes and so the customer has a clear record of what they approved.

This app has two sides:

1. **Customer-facing order confirmation page** (the "front end") — a unique, hard-to-guess link sent to a customer. They open it, review every detail of their order (mock-ups, sizing, fabrics, dates, shipping), tick a set of acknowledgment checkboxes, optionally fill in additional info (shipping address, signature), and finalize the order.
2. **Internal sales/admin portal** (the "back end / admin") — where our sales team logs in, creates an order, enters customer info, uploads mock-up images and sizing charts, sets dates and the order value, and generates the shareable customer link.

When a customer finalizes, we want to record the **order value** so we can fire a **Google Ads conversion**.

> **Strategic direction (read §15 first):** this app is the first piece of a larger **sales platform**. Eventually salespeople will quote → build the order → push it here for customer confirmation → send to production, all in one system. The standalone admin portal we build now is a **stand-in for that future platform**. Design every boundary so this confirmation flow can later be driven by an external order source with minimal rework. See **§15 — Future Platform Integration**.

### Primary goals
- Reduce production errors and disputes by getting explicit, recorded customer sign-off.
- Give sales a fast workflow to spin up a confirmation link.
- Capture conversion value for Google Ads when the customer confirms.

### Non-goals
- **No public discoverability / SEO.** The app should be *un*-discoverable. No sitemap, `robots.txt` should disallow all, `X-Robots-Tag: noindex`, no public index pages, no linking from our marketing site.
- Not a general e-commerce store or payment processor (we link out to an invoice; we don't take card payments here).

---

## 2. Tech Stack (agreed)

| Layer | Choice | Notes |
|---|---|---|
| Database | **PostgreSQL** | |
| Backend API | **Node.js + Express** | REST API. TypeScript strongly recommended. |
| DB hosting | **Supabase (Postgres)** likely | Gives managed Postgres + Storage + (optionally) auth/edge. Not final. |
| Email | **Mailgun** likely | For sending the magic link + password to customers. |
| Frontend | **React** | See decision note below re: Vite vs Next.js. |
| Component library | **Ant Design (antd)** | Team preference. Has a strong theming/token system (ConfigProvider) for a BeastMode theme + built-in dark/light algorithms. |
| Auth (staff) | Email + password sessions (JWT or server session) | Internal users only. |
| Auth (customer) | **Magic link token** (unguessable). Optional short confirmation code, off by default. | No account needed. Link alone is sufficient; not Fort Knox by design. |
| File storage | Object storage (S3-compatible) recommended | mock-ups, sizing charts, signatures, size-chart PDFs. Supabase Storage is a natural fit if DB is on Supabase. |

### Decision — Next.js (App Router) ✅
We're going with **Next.js (App Router)**. Rationale: server-side control of the noindex headers, route-level auth/middleware for the token-gated customer page, image handling, and one deployable unit. antd works with Next via its App Router registry (`@ant-design/nextjs-registry`) for SSR styles.

**Architecture:** a single **Next.js app**. Backend logic lives in Next **Route Handlers** (`app/api/*`) — this satisfies the "Node.js + Express-style API" requirement without standing up a separate Express service. (If a standalone Express service is ever needed, the API layer is isolated enough to extract later.)

**Hosting note:** Next.js runs fine as a **standalone Node server** (`output: 'standalone'`) in a container — which is exactly what **AWS App Runner** wants. Keep it host-agnostic (a plain Dockerfile, env-var config) so App Runner / Render / Fly / a VM are all viable. Avoid hard Vercel-only features.

---

## 3. User Roles

1. **Staff / Sales (authenticated)** — create & manage orders, upload assets, generate links, view confirmation status.
2. **Admin (authenticated, elevated)** — everything sales can do, plus manage staff users, manage the library of reusable size charts, and configure settings (Google Ads conversion config, acknowledgment text, etc.).
3. **Customer (unauthenticated, token-gated)** — view a single order via magic link, fill in allowed fields, confirm, and finalize. Cannot see other orders or any admin surface.

---

## 4. Core User Flows

### 4.1 Sales creates an order
1. Log into admin portal.
2. **Create order** → enter customer name, email, contact details, **club name** (internal reference only).
3. Add one or more **garments/line items**. For each garment:
   - Mock-up image(s) — multiple uploads allowed.
   - Sizing chart data (sizes, names, numbers, per-garment notes).
   - Planned **fabrics** list.
   - Per-garment **order notes** (e.g. "Chinese collar", "internal stitching").
   - Link(s) to relevant **size chart reference(s)** from our chart library.
4. Set order-level fields: **expected shipping date**, **deadline date** (customer's required-by date), **order value**, **invoice link**, general **order notes**, shipping address handling mode.
5. **Generate shareable link** → system creates a token; sales copies/sends the link (and access password if used) to the customer.

### 4.2 Customer confirms an order
1. Opens magic link (and enters access password if configured).
2. Reviews all order details: mock-ups, sizing, fabrics, dates, notes, order value, invoice link.
3. Handles **shipping address**: pre-filled / enters their own / "will provide later".
4. Raises concerns on fabrics or details if any (optional comments).
5. Ticks all **required acknowledgment checkboxes** (§5).
6. Optionally **signs** (draw signature or upload signature image).
7. **Finalizes** → status changes to Confirmed; timestamp + acknowledgments + IP recorded; **Google Ads conversion fires** with the order value.

### 4.3 Sales tracks status
- Dashboard list of orders with statuses: `Draft → Sent → Viewed → Confirmed` (and maybe `Changes Requested`).
- See exactly which acknowledgments were ticked, when, and any customer-entered data.

---

## 5. Acknowledgment Checkboxes (customer must confirm)

These are the legally/operationally important confirmations. Each should be a required checkbox (unless noted), with explanatory copy. **The exact wording should be reviewed by the business/legal owner — the text below is a starting draft.**

1. **Color accuracy** — *"I understand that colors may not print exactly as they appear on the mock-ups or on my screen. Screens display color using light (RGB) while printing uses inks/dyes (CMYK and material differences), so some variation is expected."*
2. **Color matching escalation** — *"If I am highly concerned about exact color matching, I understand I must request a color book or send a physical sample for matching before production."* (Could be a checkbox + a "Request color book / sample" action.)
3. **Mock-up correct** — *"I confirm the mock-up(s) shown are correct."*
4. **Sizing/names/numbers correct** — *"I confirm the sizing, names, and numbers are correct."*
5. **Used our size charts** — *"I confirm I used the provided size charts (not my own/legacy charts), because factory size standards differ from other brands."*
6. **No refunds for customer error** — *"I understand that orders that are incorrect due to information I provided cannot be refunded. [Company] takes responsibility only for manufacturing errors on our part."*
7. **Women's vs unisex sizing** — *"I acknowledge the difference between women's and unisex sizing and have accounted for it in my specifications."*

Store each acknowledgment individually (which version of the text, ticked true/false, timestamp) so we have an auditable record — not just one global "I agree."

---

## 6. Data Model (first-pass schema)

PostgreSQL. Use UUIDs for primary keys (especially for anything exposed in URLs). Below is a starting point — refine during implementation.

```
staff_users
  id (uuid, pk)
  email (unique)
  password_hash
  name
  role            -- 'sales' | 'admin'
  created_at, updated_at

orders
  id (uuid, pk)
  order_number        -- human-friendly, sequential/unique
  source              -- 'internal_admin' | 'platform'  (who created it; default 'internal_admin' now)
  external_ref        -- nullable; the order/quote ID in the future sales platform (unique when present)
  customer_name
  customer_email
  customer_contact    -- phone/other
  club_name           -- displayed on the order page AND used internally (not required by the conversion)
  order_value_amount  -- numeric(12,2)
  order_value_currency
  invoice_url
  expected_ship_date  -- date
  deadline_date       -- date
  general_notes       -- text
  shipping_mode       -- 'prefilled' | 'customer_entered' | 'later'
  shipping_address    -- jsonb or text (nullable)
  status              -- 'draft' | 'sent' | 'viewed' | 'confirmed' | 'changes_requested'
  created_by          -- fk staff_users
  created_at, updated_at
  confirmed_at        -- nullable

order_access            -- one (or more) per order for the magic link
  id (uuid, pk)
  order_id (fk)
  token_hash            -- store HASH of token, not raw token
  access_code_hash      -- nullable; only set if the optional confirmation code is enabled for this order
  expires_at            -- nullable
  last_viewed_at
  created_at

garments               -- line items
  id (uuid, pk)
  order_id (fk)
  name                 -- e.g. "Home Jersey"
  fabrics              -- text[] or jsonb list
  notes                -- per-garment notes
  sort_order
  created_at, updated_at

garment_sizing          -- sizing rows per garment
  id (uuid, pk)
  garment_id (fk)
  size                 -- e.g. "M", "XL"
  player_name          -- nullable
  player_number        -- nullable
  notes
  sort_order

mockup_images
  id (uuid, pk)
  garment_id (fk)      -- (or order_id if mock-ups can be order-level)
  file_url / storage_key
  caption
  sort_order
  created_at

size_charts             -- reusable library of OUR reference charts
  id (uuid, pk)
  name                 -- e.g. "Adult Unisex Jersey", "Women's Cut"
  file_url / storage_key
  description
  created_at, updated_at

garment_size_chart_links  -- link a garment to one or more reference charts
  garment_id (fk)
  size_chart_id (fk)

acknowledgments
  id (uuid, pk)
  order_id (fk)
  ack_key              -- 'color_accuracy' | 'color_matching' | 'mockup_correct' | ...
  ack_text_version     -- which version of the copy was shown
  accepted (bool)
  accepted_at
  created_at

confirmations           -- final sign-off snapshot
  id (uuid, pk)
  order_id (fk)
  signature_type       -- 'drawn' | 'uploaded' | 'none'
  signature_url / storage_key
  confirmed_snapshot   -- jsonb: IMMUTABLE copy of the order as shown at confirmation
                       --   (garments, sizing, fabrics, notes, dates, value, AND the
                       --    NAME of each linked size chart). Live records may change or
                       --    disappear later; this snapshot is the record of what was agreed.
  confirmed_at
  ip_address
  user_agent

conversion_events       -- for Google Ads tracking / audit
  id (uuid, pk)
  order_id (fk)
  value_amount, value_currency
  fired_at
  status               -- 'pending' | 'sent' | 'failed'
  provider_response    -- jsonb

domain_events           -- outbox for platform integration (see §15)
  id (uuid, pk)
  aggregate_type       -- 'order'
  aggregate_id         -- order id
  event_type           -- 'order.confirmed' | 'order.viewed' | 'order.changes_requested'
  payload              -- jsonb (the order contract snapshot)
  created_at
  delivered_at         -- nullable; for webhook/subscriber delivery
  status               -- 'pending' | 'delivered' | 'failed'
-- Google Ads conversion + (future) production hand-off are just CONSUMERS of order.confirmed.
```

---

## 7. Authentication & Security

### Customer link (magic link — keep it simple, not Fort Knox)
- Generate a **cryptographically random token** (e.g. 32 bytes, URL-safe base64). The link is `https://app.example.com/o/<token>`. **The link alone is sufficient to view and confirm the order.**
- **Store only a hash** of the token in the DB (`token_hash`). Look up by hashing the incoming token. This way a DB leak doesn't expose live links.
- **Optional confirmation code** (default OFF): a per-order toggle to require a short code in addition to the link, for the occasional sensitive order. Most orders won't use it. Code stored hashed if used.
- Tokens can expire and be revoked/regenerated by sales.
- Rate-limit token lookups; generic error for invalid/expired (don't reveal whether a token exists).
- Tokens **may expire** (`expires_at`) and can be **revoked/regenerated** by sales.
- Rate-limit token lookups to prevent brute forcing.
- The customer page exposes **only that one order**. No enumeration, no listing.

### Staff auth
- Email + password with strong hashing (argon2 or bcrypt).
- Session via HTTP-only secure cookie (or JWT with refresh). CSRF protection on state-changing routes.
- Role-based access control (`sales` vs `admin`).
- Consider 2FA for admin later.

### General security
- All traffic over HTTPS.
- **`noindex` everywhere:** `robots.txt` disallow all + `X-Robots-Tag: noindex, nofollow` header + `<meta name="robots" content="noindex">`.
- Validate & sanitize all uploads (type, size limits, virus scan optional). Serve uploads from a separate domain or via signed URLs.
- Don't leak whether a token exists (generic error for invalid/expired).
- Audit log of staff actions and customer confirmations.
- Store IP + user agent + timestamps on confirmation for dispute evidence.

---

## 8. File / Asset Handling

- **Mock-up images:** multiple per garment; common image formats; show as a gallery/lightbox on the customer page.
- **Sizing charts (per order):** the data entered by sales (sizes/names/numbers/notes) — this is structured data, rendered as a table on the customer page.
- **Reference size charts (library):** our standard charts (likely PDFs/images) that sales links to garments; customer can click to view/download. Managed in admin. **These are mutable** — they get updated and old files may disappear. So at **confirmation time we snapshot the size chart NAME** (and any shown details) into `confirmations.confirmed_snapshot`. The live link is for convenience during review; the snapshotted name is the durable record of what the customer agreed to.
- **Signatures:** either a drawn signature (canvas → PNG) or an uploaded image.
- Recommend **S3-compatible object storage** with **signed URLs**; keep buckets private. Store storage keys in DB, not public URLs.

---

## 9. Styling / "BeastMode" Aesthetic

**Reference:** https://beastmode.co.nz (our brand site). Pull the live palette/fonts/spacing from there.

- **Customer front end:** must be **BeastMode style**. This is the priority surface — it represents the brand to the customer at the moment of confirmation.
- **Admin back end:** normal functional layout with **dark mode + light mode**. BeastMode styling preferred but not critical.

### BeastMode style characteristics (from the brand site)
- **Mood:** athletic, energetic, bold, confident, professional-yet-approachable. Sports teamwear brand.
- **Palette:** deep navy/charcoal dark sections with white type, high-contrast white content sections, and vibrant accent colors (reds, greens, blues, oranges) drawn from product imagery. Use a dark hero/navy as the dominant "brand" surface and white for content.
- **Typography:** modern geometric sans-serif. **Heavy use of UPPERCASE, bold headings** for impact (e.g. "CUSTOM DESIGNED TEAMWEAR"). Mixed case for body.
- **Layout:** large hero imagery, generous whitespace, clean grids, card-based testimonials, icon-driven sections.
- **Buttons/CTAs:** minimalist, clear, high-contrast.

> **Action for dev:** inspect https://beastmode.co.nz to extract exact hex values and the actual font family, then encode them as **antd theme tokens** via `ConfigProvider` (`colorPrimary`, fonts, border radius, etc.) and a set of CSS variables. Use antd's `theme.darkAlgorithm` / `defaultAlgorithm` for the admin dark/light toggle. Build a small `theme.ts` as the single source of truth.

We have Figma MCP tooling available — if a Figma design is later produced, it can be pulled directly into code.

---

## 10. Conversion Tracking (Google Ads)

- The **order value** is captured per order and used as the conversion value.
- On **customer finalize**, fire a Google Ads conversion with that value.
- **What we actually send Google:** the customer **email** (hashed) + **value** + **currency** + an **order ID** (for dedup). That's the whole payload. Club name etc. are not needed (sending them is harmless but pointless — leave them out).

### How attribution works when the ad click was months ago
Use **Enhanced Conversions for Leads** (the email-matching method), NOT GCLID.

- **GCLID method (avoid):** would require capturing the `gclid` on the marketing website *at ad-click time* and carrying it through the sale for months. Cross-system plumbing. Not worth it here.
- **Enhanced Conversions for Leads (use this):** at confirmation we send Google the **hashed customer email** + value. Google matches that email against the original ad-click identity **on Google's side**, even months later. We already collect the email, so nothing else is needed.

**Where does this happen? → Entirely in THIS app (or a Google Ads CSV upload). You do NOT need to touch the original marketing website, and nothing needs to be captured at click time.**

### Recommended setup (simplest first)
1. In **Google Ads**: create a Conversion action ("Order Confirmed") and **turn on Enhanced Conversions for Leads**. Get the **Conversion ID + label**.
2. **Client-side via GTM (easiest to start):** on the confirmation success page, the dev pushes a `dataLayer` event `order_confirmed` with `value`, `currency`, `transaction_id` (= order ID), and the customer `email`. GTM's Google Ads conversion tag (with Enhanced Conversions on) sends it. You wire the tag in the GTM UI; the dev just emits one event.
3. **Server-side later (recommended once live):** upload the conversion from our backend when status → confirmed, via the **Google Ads API (Enhanced Conversions for Leads)** — sending hashed email + value + order ID. Immune to ad-blockers; this becomes the source of truth. Record a `conversion_events` row either way.

> **Minimum you need to provide the developer:** the **Conversion ID + label** from step 1. Everything else (email + value) we already have.

- **Fire once** per order — idempotent. Use the order ID as `transaction_id` so Google dedupes, and guard server-side against re-firing on refresh/double-confirm.

---

## 11. Feature Checklist (acceptance criteria)

**Admin / Sales**
- [ ] Staff login (sales + admin roles).
- [ ] Create/edit/delete orders.
- [ ] Enter customer name, email, contact, club name.
- [ ] Add multiple garments per order.
- [ ] Upload multiple mock-up images per garment.
- [ ] Enter sizing chart data (sizes, names, numbers, per-garment notes).
- [ ] List planned fabrics per garment.
- [ ] Per-garment notes + general order notes.
- [ ] Manage reusable reference size-chart library (admin) and link charts to garments.
- [ ] Set expected ship date + deadline date.
- [ ] Set order value + currency + invoice link.
- [ ] Choose shipping mode (prefilled / customer-entered / later).
- [ ] Generate, copy, regenerate, and revoke customer link (+ optional access password).
- [ ] View order status + which acknowledgments were ticked + customer-entered data + signature.
- [ ] Dark/light mode.

**Customer page**
- [ ] Token (+ optional password) gated; no token = no access.
- [ ] View all mock-ups (gallery).
- [ ] View sizing table, fabrics, notes, dates, order value, invoice link.
- [ ] View/download linked reference size charts.
- [ ] All 7 acknowledgment checkboxes with explanatory copy.
- [ ] "Request color book / sample" action/flag.
- [ ] Shipping address: prefilled / enter own / provide later.
- [ ] Raise concerns / comments (fabrics or general).
- [ ] Signature: draw or upload.
- [ ] Finalize → records confirmation, fires conversion.
- [ ] BeastMode styling.
- [ ] noindex / not discoverable.

**System**
- [ ] Google Ads conversion fires once on confirm with order value.
- [ ] Audit record (timestamps, IP, UA, ack versions).

---

## 12. Suggested Build Phases

1. **Foundation** — repo, Next.js (App Router) app, Dockerfile (`output: 'standalone'`), Postgres schema + migrations, API route-handler skeleton, staff auth, antd theme scaffold, CI, noindex headers.
2. **Admin core** — order CRUD via an internal **`/api/orders`** service (the future platform's integration point — see §15), garments, sizing data, uploads (mock-ups), order fields, link generation. Admin UI consumes the same API.
3. **Customer page** — token-gated view, render all order data, acknowledgments, shipping, signature, finalize.
4. **Reference size-chart library** + linking to garments.
5. **Events + conversion tracking** — `order.confirmed` outbox event (`domain_events`); Google Ads conversion as the first consumer, idempotent firing, `conversion_events`.
6. **BeastMode theming** — apply front-end design; admin dark/light.
7. **Hardening** — rate limiting, audit log, signed URLs, security review, email sending of links.
8. **Nice-to-haves** — "changes requested" flow, email notifications to sales on confirm, PDF export of the confirmed order, 2FA.

---

## 13. Open Questions / Decisions Needed

### Resolved
- ✅ **BeastMode reference** — https://beastmode.co.nz (see §9).
- ✅ **Component library** — Ant Design (antd).
- ✅ **Customer auth** — magic-link token alone (optional confirmation code per order, default off). Keep simple.
- ✅ **Token storage** — store hashed, not raw.
- ✅ **Club name** — shown on order page + internal; not required by the conversion (can include or omit).
- ✅ **DB hosting** — likely Supabase (Postgres + Storage).
- ✅ **Email** — likely Mailgun.
- ✅ **Google Ads approach** — Enhanced Conversions for Leads (email-based); GTM client-side first, server-side later (see §10). Done in this app — no marketing-site work.
- ✅ **Framework** — **Next.js** (App Router).
- ✅ **App hosting (tentative)** — AWS **App Runner** for the app; Supabase for Postgres. Not locked, won't be decided soon — build host-agnostic.

### Still open
1. **Google Ads specifics** — create the conversion action and obtain the **Conversion ID + label**; turn on Enhanced Conversions for Leads.
2. **Final acknowledgment wording** — business/legal sign-off on the 7 checkbox texts.
3. **Currencies** — single (NZD?) or multiple?
4. **Mock-ups: order-level or garment-level?** (Schema currently garment-level — confirm.)
5. **Editing after confirm** — what happens if the customer wants changes? ("changes requested" flow.)
6. **Data retention / privacy** — how long do we keep customer data & signatures?

---

## 14. Notes for the Next Developer (and Claude)

- This repo is greenfield (`c:\Users\cirni\Desktop\code`). Initialize git, set up the monorepo or separate front/back repos as decided.
- Recommend **TypeScript** end-to-end and a shared types package for the order model.
- Use **migrations** (e.g. Prisma, Drizzle, or node-pg-migrate) from day one — don't hand-edit the DB.
- Keep the customer surface **minimal and locked down**; treat every customer input as untrusted.
- BeastMode reference is https://beastmode.co.nz — encode its palette/fonts as antd theme tokens (see §9).
- **Build for the future platform (see §15)** — keep order ingestion behind a clean API, the confirmation flow as a self-contained module, and emit an event on confirm. Don't hard-wire the admin UI as the only way an order can exist.
- Update this brief as decisions in §13 get resolved.

---

## 15. Future Platform Integration (design for this NOW)

**Where this is heading:** this confirmation app becomes a **module of a larger sales platform**. In that world, salespeople **quote → build the order → mark it ready → it appears here for the customer to confirm → on confirmation it's released to production**. The standalone admin portal we build today is a **temporary stand-in** for the platform's order-building UI. The customer confirmation experience is the part that endures.

The goal: when the platform arrives, we **swap the order *source*** without rewriting the confirmation flow, the data model, or the customer page.

### Design principles to follow now
1. **Order ingestion is an API, not just a UI.** Build order creation as a service/function with a clear input contract. The admin portal calls that same internal API the future platform will call. → *No business logic buried in admin React components; it lives behind the API.*
2. **Treat the order as a contract.** Stable, documented order shape (the §6 schema). Include `source` and `external_ref` so a platform-originated order can be linked back to its quote/order ID. Use UUIDs and avoid assumptions that "a human in our admin typed this."
3. **Confirmation flow is a bounded module.** The token-gated customer view + acknowledgments + signature + finalize should depend only on order data, not on *how* the order was created. Keep it cleanly separable (own routes, own service layer).
4. **Emit an event on confirmation.** When status → `confirmed`, publish a structured **`order.confirmed`** event (and ideally `order.viewed`, `changes_requested`) — via an outbox table + webhook now, so the future platform (and the production hand-off) can subscribe. The Google Ads conversion becomes just one consumer of that event.
5. **Don't become the source of truth for customers/products long-term.** Today this app owns the order. Later the platform will. Keep customer/garment data **importable and exportable** (clean JSON), and avoid duplicating reference data (e.g. size-chart library) in ways that would be painful to reconcile. The size-chart library may itself migrate to the platform — keep it loosely coupled.
6. **Auth designed to federate.** Staff auth should be replaceable with the platform's SSO later (e.g. keep an `auth provider` seam — don't scatter password logic everywhere). Customer magic-link auth stays as-is (it's customer-facing and orthogonal).
7. **Shared types / API-first.** A documented API schema (OpenAPI or shared TS types) for orders makes the platform integration a matter of "call this endpoint," not reverse-engineering.

### Concrete near-term implications
- Add an internal **`POST /api/orders`** (and update/get) that the admin UI consumes — this is the future platform's integration point. Protect it so it can later accept service-to-service auth (API key / OAuth client-credentials).
- Add `source` + `external_ref` to `orders` (done in §6).
- Add an **outbox / events** table and fire `order.confirmed` from one place.
- Keep the confirmation module's code in its own directory with a thin dependency on "an order object," so it can be lifted into the platform repo later.
- Document the order JSON contract early.

> **Net effect:** when the platform is ready, integration = the platform calls `POST /api/orders` (or we share a DB/schema), the customer confirms exactly as today, and the platform subscribes to `order.confirmed` to release production. Minimal rework.

### Decision: the database will eventually be SHARED with the platform ✅
The platform and this app will likely **share one Postgres database**. Implications for how we build now:
- **Treat the schema as a shared, public contract.** Namespace this app's tables under a dedicated **`confirmation` schema** (Postgres schema), not just `public`, so the platform's tables can coexist cleanly and ownership is obvious.
- **Migrations must be additive and coordinated.** Assume other services will read these tables. No destructive/renaming migrations without a deprecation path once shared.
- Keep the **`/api/orders` service seam anyway** — even with a shared DB, going through the service (not raw cross-table writes from the platform) keeps validation, token generation, and event emission in one place. The platform can either call the API or, if it writes directly later, reuse the same service module.
- `external_ref` still links a confirmation order to the platform's quote/order even within one DB.
