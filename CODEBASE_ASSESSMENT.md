# Codebase Assessment — July 2026

A full-repo review covering refactoring and reusability opportunities, god components, technical debt, security findings, and feature suggestions. Focus: the failure modes that creep in when an app is built up incrementally, feature by feature — parallel slices that each re-invent shared plumbing, later features not adopting helpers extracted earlier, and planning docs drifting away from the tree.

All file/line references were verified against the tree at the time of writing.

**Relationship to existing docs:** this repo already tracks a lot of review output. `REFACTOR_CHECKLIST.md` (all 8 phases done), `IMPROVEMENT_ROADMAP.md` (phases 2–3 done), and `CODE_REVIEW_FINDINGS.md` (Round 1 done; **Round 2 entirely open**). This assessment does not restate Round 2 items in detail — see §9.1 for the ones still outstanding — and instead focuses on what is *new* or has emerged since.

---

## 1. Executive summary

The codebase is in good shape structurally: a clear service seam for orders, hashed tokens, an outbox, validated env, broad test coverage (~78% statements), and no `any` in production code. The security fundamentals are strong (see §6.4).

The dominant issue is **incremental-growth drift**: good shared abstractions exist (`api-fetch.ts`, `wrapEmailLayout`, `requireAdmin`, roster's factored token check) but each was extracted *after* some features shipped, and the features built before — or in parallel slices after — never migrated onto them. Concretely:

- `api-fetch.ts` is used by only 2 of ~12 views; the hand-rolled equivalent (`res.json().catch(() => ({}))` + `err instanceof Error` handling) appears **43× across 25 files**.
- `requireAdmin()` is used by only 5 of 57 API routes; the rest rely on middleware auth with **no role check**, including hard order deletion.
- The "load token → check revoked → check expiry" block is hand-rolled **6×** in the orders slice while roster already factored it.
- The roster feature slice duplicates the orders slice's patterns (token rotation, audit events, error signalling) with *different conventions* in each.
- Three customer views are ~85% copies of each other, including a size-chart preview modal copy-pasted verbatim 3×.
- Several planning docs are stale — items marked outstanding are actually built (forgot-password, Playwright specs), which will mislead future planning.

Highest-leverage moves, in order:
1. **Route wrappers** (`withAdminRoute` / `withCustomerRoute` / `withInternalRoute`) — deletes ~60% of every handler body, closes the role-check gap, and unifies error shapes. (§4.2)
2. **Migrate all views onto `api-fetch.ts`** + extract the shared customer-view primitives. (§3, §5)
3. **Fix the three verified medium-severity security findings** (role gate on order deletion, rate-limit header spoofing off-Vercel, unbounded signature payload). (§6)
4. **Split the 931-line orders service** into focused modules. (§4.1)

---

## 2. God components (frontend)

Two views already demonstrate the target pattern — `UsersView.tsx` and `ProfileView.tsx`: thin container, `api-fetch` helpers, extracted presentational sub-components. Refactor the rest to converge on that shape. Per-component guidance below; the shared modules they should extract into are catalogued in §5.

### 2.1 `src/app/o/[token]/view.tsx` — customer confirmation (738 lines, 12 useState)

The worst offender. It mixes: terminal-state routing (lines 228–252), three API submit flows (`handleConfirm` 254–298, `handleRequestChanges` 300–311, `handleRequestColorSample` 313–332), GTM conversion push, hero header markup (344–396), order summary, the garment rendering loop (447–539), the concerns/shipping/acks/signature form, validation alerts, the action button bar, and a size-chart preview modal (702–735).

**Decomposition:**
- `useOrderConfirmation(token, order)` hook owning the three submit flows and `{ submitting, result, changesRequested, sampleRequested }`; the component keeps only form-field state.
- Extract `<OrderHero>`, `<GarmentDetailCard>`, `<SizeChartPreviewModal>`, `<ConfirmationActions>`.
- Move the terminal panels (`AlreadyConfirmedPanel`, `SuccessPanel`, `ChangesRequestedPanel`, already local functions at 123–207) into their own file beside `StatusPage`.

**Bug found here:** lines 309–310 call `setChangesRequested` twice in a row — first with `order.orderNumber`, then `data.orderNumber`. The first call is dead code; delete it.

### 2.2 `src/app/admin/dashboard/DashboardView.tsx` (674 lines)

Mostly presentational but far too long, and it bypasses shared utilities: local `formatNZD`/`timeAgo`/`deadlineLabel` (118–144) belong in `src/lib/format.ts`, and its `STATUS_HEX` map (40–47) parallels `OrderStatusBadge`'s maps (see §5, item 9).

**Decomposition:** `<StatCardsRow>` (262–346), `<TrendChart>` / `<StatusPieChart>` (349–412), a generic `<OrderListCard title icon badge dataSource emptyText renderTrailing/>` to collapse the four near-identical Card+List panels (417–614), and `<FailedEventsCard>` (617–671) with `retryEvent` moved into a `useFailedEvents` hook.

### 2.3 `src/app/o/roster/[rosterToken]/view.tsx` (597) and `src/app/o/roster/member/[memberToken]/view.tsx` (401)

The member view is **~85% identical** to the shared-roster view minus the member picker and add-self form. Both duplicate the confirmation view's hero, `SectionHeading`, `cardStyle`, and preview modal (§5, items 1–4).

**Decomposition:** extract `<MemberPicker>` (314–357), `<AddSelfForm>` (367–421), `<GarmentSizeInput>` (456–542 ≈ member view 262–348), and a shared `useRosterSizes(token, roster)` hook. Once the shared primitives exist, the member view collapses to ~120 lines.

### 2.4 `src/app/admin/orders/[id]/OrderDetailView.tsx` (496 lines, 12 useState)

Six hand-rolled action fetches (`saveDetails`, `deleteOrder`, `resendLink`, `duplicateOrder`, `cancelOrder`, `resolveColorSample` — 136–262), each repeating the same try/parse/message boilerplate; five `err instanceof Error` handlers in one file.

**Decomposition:** a `useOrderActions(order)` hook built on `api-fetch`, centralising the `503 → "Email delivery not configured"` special-case (currently duplicated in 5 client files and 4 routes); extract `<OrderStatusAlerts>` (270–328), `<OrderDetailHeader>` (420–483), `<InternalNotesCard>` (330–345). The `shareLinkVersion` force-remount hack (117–120, 384) disappears once token state lives in the hook and is passed down as props.

### 2.5 `src/components/admin/orders/RosterPanel.tsx` (464 lines, 13 useState)

Load + six mutation fetches (79–247), all hand-rolled, plus per-row loading flags (`savingId`/`removingId`/`remindingId`/`copyingId`). Extract `useRosterMembers(orderId)` exposing granular pending ids, `<RosterMembersTable>` (252–424), `<AddMemberRow>` (425–453), and a shared `<MemberStatusTag submittedAt/>` (304–308, re-appears in the customer roster views).

### 2.6 `src/components/admin/orders/ShareLinkPanel.tsx` (407 lines)

Six fetches (59–167) plus a "copyable secret box" markup block that appears **twice verbatim** in the same file (link box 234–260 ≈ access-code box 359–377). Extract `<CopyableSecretBox>`, `<AccessCodeControl>` (327–404), `<LinkStateAlerts>` (171–224), and a `useShareLink(orderId)` hook.

### 2.7 Smaller cleanups

- `SizeChartsView.tsx` (364): extract the three modals; reuse the shared preview modal; centralise `.pdf` detection (§5, item 7).
- `OrdersView.tsx` (271): the filter/sort/paginate machine (50–120) is a natural `useOrderTable(searchParams)` hook; the debounce (70–73) should be a shared `useDebounced(value, ms)`.
- `ProfileView.tsx` (468): already good; optionally split `SetupFlow` (285–424) into its three steps.

---

## 3. The single biggest reusability win: adopt `api-fetch.ts` everywhere

`src/lib/api-fetch.ts` (`getJson/postJson/patchJson/deleteJson` + `ApiError`) exists and is exactly right — but only `UsersView` and `ProfileView` use it. Everywhere else:

- `err instanceof Error ? err.message : ...` — **43 occurrences across 25 files**
- `res.json().catch(() => ({}))` — **24 occurrences across 12 files**

**Recommendation:** make `ApiError` carry the HTTP status, fold the 503 email-not-configured message into one place, and migrate every mutation handler in `OrderDetailView`, `RosterPanel`, `ShareLinkPanel`, `RosterLinkPanel`, `SizeChartsView`, `DashboardView`, and the three customer views. This is mechanical, low-risk, and removes more duplicated code than any other single change on the client.

---

## 4. Server layer

### 4.1 `src/server/orders/service.ts` (931 lines) is a god service

It holds at least eight responsibilities: creation, admin list/read + query builders, staleness reporting, duplication, order-level writes, garment/sizing/mockup CRUD, token + access-code lifecycle, roster-lock/colour-sample flags — plus the shared error classes that roster imports (`roster/service.ts:17` imports `NotFoundError` *and* `computeAccessExpiry` from it, coupling the slices).

**Split, keeping everything under `src/server/orders/` to preserve the "only place orders are mutated" invariant:**

| New module | Contents |
|---|---|
| `orders/queries.ts` | `listOrders`, `listOrdersForExport`, `getOrderAdmin`, `getOrderById`, `buildOrdersWhere/OrderBy`, `normalizeSortOptions` |
| `orders/reports.ts` | `getStaleOrders` + `StaleOrder` (analytics read, not a write path) |
| `orders/garments.ts` | garment/sizing/mockup/size-chart CRUD (546–653) |
| `orders/access.ts` | `generateAccessToken`, `revokeAccessToken`, `setOrderAccessCode`, `clearOrderAccessCode`, `computeAccessExpiry`, `getOrderByToken` |
| `orders/lifecycle.ts` | `updateOrder`, `deleteOrder`, `cancelOrder`, `duplicateOrder`, `lockRoster`/`unlockRoster`, `resolveColorSampleRequest` |
| `src/server/errors.ts` | `NotFoundError`, `ConflictError`, `RosterFullError` (currently split across orders and roster services) |

Also: `duplicateOrder` (407–492) re-implements `createOrder`'s insert loop — share the internals. And three near-identical `coalesce(max(sort_order))+1` blocks (`addGarment` 547, `addMockupImage` 615, roster `writeMemberSizes` 393) should collapse into one `nextSortOrder()` helper.

**Dead contract field:** `createOrderSchema.requireAccessCode` (`contract.ts:65`) is never read by `createOrder` — access codes can only be set post-hoc. Either wire it up or remove it from the documented contract.

### 4.2 API routes: 57 handlers, no wrapper — introduce one

Every handler re-implements the same skeleton (parse → safeParse → try/catch → map `NotFoundError`/`ConflictError` → log → 500). Verified inconsistencies that a wrapper would eliminate:

- **Zod error shape drift:** most routes return `badRequest()` (`{ error: 'Invalid request', details }`, 400); `POST /api/orders` returns `{ error: 'validation failed' }` at **422**; `/api/o/request-changes` returns no `details` at all.
- **Error key drift:** some routes return `{ error, code }`, most only `{ error }`; `/api/orders` uses lowercase `'unauthorized'`, everything else `'Unauthorized'`.
- **String-error mapping** (`invalid_token`→404, `code_required`→403, `already_confirmed`→409, `roster_locked`…) is re-typed in 4+ customer routes.
- Copy-paste residue: `admin/orders/route.ts:3` imports `NotFoundError, ConflictError` but never uses them.

**Recommendation:** add `src/lib/route.ts` with:
- `withAdminRoute(handler, { role? })` — session/role gate (injecting `session`), central try/catch, typed-error → status mapping. Solves §6.1's role gap structurally rather than route-by-route.
- `withCustomerRoute({ rateLimitKey, schema }, handler)` — IP extraction, rate limit, body parse, safeParse, and one `mapDomainError()`.
- `withInternalRoute(handler)` — the `isInternalAuthorized || isCronAuthorized` gate.

This removes roughly 60–70% of each handler body and makes the auth story auditable in one file.

### 4.3 Token validation: one helper instead of six copies

The "load access row by hash → check revoked → check expiry" block is hand-rolled 5× in `orders/customer-service.ts` (26–34, 90–100, 187–197, 242–252, 309–319) plus a variant in `orders/service.ts:923–928`. Roster already factored it (`getActiveRosterAccess` / `getActiveMemberAccess`) but those two are copies of each other. All three access tables are structurally identical (`tokenHash`, `expiresAt`, `lastViewedAt`, `revokedAt` — schema.ts:139/186/207).

**Recommendation:** one generic `resolveActiveToken(table, rawToken)` in `src/server/access/token.ts`, used by all eight call sites. Similarly, the rotate-token pattern (generate → revoke actives for scope → insert hashed → emit event) is triplicated in `generateAccessToken` (orders/service.ts:677–711), `generateRosterToken` (roster/service.ts:303–333), `generateMemberToken` (364–395) — extract `rotateToken(tx, opts)`.

### 4.4 Unify error signalling between the slices

Admin services throw typed classes (`NotFoundError`/`ConflictError`); customer services throw bare `Error('invalid_token')` strings that routes compare with `err.message ===`. Roster's customer service wraps the strings in named thrower functions; orders' doesn't. Pick one convention: a small typed hierarchy (`InvalidTokenError`, `AlreadyConfirmedError`, `CodeRequiredError`, `RosterLockedError`, `MissingAckError(key)`) in `src/server/errors.ts`, mapped once by the route wrapper.

Similarly, encode a rule for `emitDomainEvent` (in-tx, state changes) vs `recordAuditEvent` (audit-only) — roster currently mixes them per-author (`recordAuditEvent` for member add/remove/import at roster/service.ts:94/127/290, `emitDomainEvent` for token ops at 325/345/387).

### 4.5 `src/lib/email.ts` (746 lines)

The layout helper exists and is mostly used — good. Remaining issues:
- Every one of the ~10 `sendX` functions repeats the same 4-line preamble (SMTP guard, `from`, `createTransport`, `sendMail`), and the thrown message drifts between two spellings (lines 172/232/284/618 vs 322/383/439/586). Extract `sendEmail({ to, toName, subject, html, text, cc? })`.
- `sendStaffConfirmationEmail` (438–485) bypasses `wrapEmailLayout` entirely — the one email that won't pick up shell changes.
- The `toLocaleString('en-NZ', ...)` block is copy-pasted at 444/519/562; use `formatDateLong` (already imported at line 10).
- The three roster emails (617/666/710) are near-identical bodies — one `sendRosterEmail(variant)`.

### 4.6 Outbox / event processor

Retry design is solid (backoff, dead-letter, optimistic status locks, admin redrive). Two correctness risks and one coupling issue:

1. **Concurrent runs execute handlers twice.** `processOutbox` selects a batch (processor.ts:110–124) without `FOR UPDATE SKIP LOCKED`; the optimistic lock only prevents double-*marking*, not double side-effects (double emails / double Ads conversions). The header comment (10–13) overstates the guard.
2. **Retry re-runs ALL handlers** (documented at processor.ts:16–21): if the staff email succeeds and Google Ads fails, retry re-sends the staff email. A `domain_event_deliveries` per-handler status table (or idempotency keys) fixes both this and CODE_REVIEW Round 2 §1.3.
3. **Inverted dependency:** `processor.ts` imports concretely from `@/server/conversions/google-ads` and `@/server/orders/notifications` (25–31), so the generic event layer depends on feature modules. A `registerHandler(eventType, fn)` API called from feature modules inverts this.

### 4.7 Schema / indexes

- `domain_events`: no index on `event_type`; `getStaleOrders` (service.ts:304–316) and `getChangesRequestedComment/Count` (outbox.ts:92–119) filter on it. Add composite `(aggregate_id, event_type)`. The processor's due-events scan would also benefit from `(status, next_attempt_at)`.
- `conversion_events.order_id` (schema.ts:341) — unindexed despite lookup by order in `fireGoogleAdsConversion`.
- `garment_sizing.roster_member_id` (256) — queried in `writeMemberSizes` but only `garment_idx` exists.
- **Enum-as-text drift:** `domainEvents.eventType` is `text` while the TS union `DomainEventType` (outbox.ts:22–48) is the de-facto enum — a typo'd event type is accepted silently. Same for `acknowledgments.ackKey`. Promote to pg enums or CHECK constraints, or at minimum derive validation from the TS union at the emit seam.

---

## 5. Cross-cutting duplication catalog (client)

Concrete copy-paste to extract into shared modules:

1. **Size-chart preview modal — verbatim 3×** (`o/[token]/view.tsx:702–735`, `o/roster/[rosterToken]/view.tsx:561–594`, `o/roster/member/[memberToken]/view.tsx:365–398`) plus a 4th variant in `SizeChartsView.tsx:309–341` → `src/components/customer/SizeChartPreviewModal.tsx`.
2. **`SectionHeading` — identical local component 3×** (view.tsx:93–118, rosterToken view:71–96, memberToken view:64–89).
3. **Customer hero header — 3×** (view.tsx:344–396, rosterToken:219–263, memberToken:156–200) → `<CustomerHero eyebrow title subtitle/>`.
4. **`cardStyle` literal — 3×** → `src/lib/theme.ts` or the shared card component.
5. **Size-chart tag list — 3×** (view.tsx:517–535, rosterToken:491–528, memberToken:297–334) → `<SizeChartTags charts onPreview/>`.
6. **Per-garment size-entry card — 2×** (rosterToken:456–542 ≈ memberToken:262–348) → `<GarmentSizeInput/>`.
7. **`.pdf` detection** scattered across 4 files → `isPdf(storageKey)` in `src/lib/size-chart.ts`.
8. **503 email-not-configured string** in 5 client files + 4 routes → into `api-fetch` / route wrapper.
9. **Status→color maps:** `OrderStatusBadge` (antd colors) vs `DashboardView:40–47` (hex). Deliberately split once, but the 6 statuses are now maintained in two places — export one `ORDER_STATUS` metadata map (label + antd color + hex).
10. **Member Submitted/Pending tag — 3×** → `<MemberStatusTag submittedAt/>`.
11. **Member draft form** (admin `RosterPanel:425–453` ≈ customer add-self `rosterToken:379–419`) → `<MemberDraftFields/>`.
12. **Date/currency helpers bypassed:** `DashboardView` local helpers, `OrderDetailView:285/298` inline `toLocaleString('en-NZ')`, `SuccessPanel:164–172` — all belong in `src/lib/format.ts`.

Suggested hooks: `useOrderActions`, `useShareLink`, `useRosterMembers`, `useRosterSizes`, `useOrderConfirmation`, `useOrderTable`, `useDebounced`, `useFailedEvents`.

---

## 6. Security

New, verified findings (not already tracked in CODE_REVIEW_FINDINGS.md). The three MEDIUMs are worth fixing before any other refactor work.

### 6.1 MED — Hard order deletion has no role gate

`DELETE /api/admin/orders/[id]` (route.ts:37–48) calls `deleteOrder(id)` with no `requireAdmin()` — any authenticated **sales** user can irreversibly hard-delete an order on a database intended to be shared with the future platform. This is inconsistent: user management, size-chart mutation, and event retry are all admin-gated. `cancel` is arguably also admin territory. Most other order routes being sales-accessible is plausibly intended (day-to-day order management), but deletion looks like an omission, not a decision.

**Fix:** `requireAdmin()` on DELETE (and decide explicitly for `cancel`); longer term the `withAdminRoute({ role })` wrapper (§4.2) makes the policy declarative. Also confirm `deleteOrder` emits an actor-attributed audit event — `updateOrder`/`cancelOrder` pass `actorEmail`, deletion appears not to.

### 6.2 MED — Rate-limit IP spoofable off-Vercel via `x-vercel-forwarded-for`

`getClientIp` (rate-limit.ts:133–134) trusts `x-vercel-forwarded-for` (leftmost value) before anything else. On Vercel that header is edge-controlled; on the explicitly-supported non-Vercel targets (App Runner, Render, Fly, ECS — see PROJECT_BRIEF) nothing strips a client-supplied copy, so an attacker fully bypasses the IP tier of every limiter. Endpoints whose *only* tier is IP (confirm, request-changes, request-color-sample) become unlimited; login/verify-code survive via their account/token tiers. This re-introduces the same class of bug fixed for `x-forwarded-for` in commit a9a0f51.

**Fix:** only honor the header when `process.env.VERCEL` is set; make the trusted-proxy header/hop configurable per deployment.

### 6.3 MED — Unbounded, unvalidated signature payload on public confirm

`signatureBase64` is `z.string().nullable().optional()` with no max length (`api/o/confirm/route.ts:19`); `confirmOrder` base64-decodes and uploads it as PNG with no size ceiling or content validation (customer-service.ts:347–352). A token holder can POST an arbitrarily large body (memory DoS) and store arbitrary bytes under an `image/png` key. `concerns` is correctly capped at 2000 — the asymmetry shows this was missed.

**Fix:** `.max(~3_000_000)`, require the `data:image/png;base64,` prefix, verify PNG magic bytes before upload.

### 6.4 LOW findings

- `getOrderForCustomer` returns the **full order row including staff-only `internalNotes`** (customer-service.ts:61–72); it doesn't leak only because the page whitelists fields (`o/[token]/page.tsx:102–120`). Roster paths strip at the service layer with regression tests; the main path should too.
- No Content-Security-Policy anywhere (next.config.mjs sets good headers otherwise). Start report-only with a nonce for the GTM inline script.
- Upload content-type trusted from client MIME, not sniffed (uploads.ts:34); mockup key uses the raw client extension, which can inject `/` into the S3 key (images/route.ts:28–30). Admin-only; sanitise extension to `[a-z0-9]+`.
- `/api/auth/login` and `/api/auth/logout` sit outside `/api/admin` so miss the Origin CSRF check (sameSite=lax mitigates).
- `POST /api/orders` (public ingestion) has no rate limit — the only unauthenticated-ish surface without one.
- Password policy is min-8 only; TOTP secrets stored plaintext (common, but consider encrypting at rest).

### 6.5 Done well (for balance)

32-byte peppered-hash tokens with in-transaction revocation on regenerate and generic 404s; bcrypt cost 12 with blind-verify anti-enumeration; timing-safe comparisons throughout; layered rate limiting with per-account/per-token tiers; sameSite-lax + httpOnly + Origin-check CSRF posture; explicit session TTL enforced at the seal; signed-URL-only storage; last-admin and self-modify guards; parameterized queries everywhere; no committed secrets; conditional-UPDATE guards against double-confirmation races; roster GET paths have dedicated no-leak regression tests.

---

## 7. Technical debt & hygiene

- **E2E specs exist but never run.** `e2e/` has six Playwright specs + config, but `.github/workflows/test.yml` doesn't reference them. Wire `test:e2e` into CI (or a nightly job) — golden-path flows are currently not gated on merge.
- **No coverage thresholds** in `vitest.config.ts` — coverage can silently regress from 78%.
- **Dependency placement:** `@types/bcryptjs`, `@types/nodemailer`, `@types/qrcode`, `@types/react-signature-canvas`, and `tsx` are in `dependencies`; move to `devDependencies` (the other `@types/*` already are — it's inconsistent).
- **ESLint is minimal:** bare `next/core-web-vitals`; no `@typescript-eslint` ruleset. Given zero `any` in prod code, adding `no-explicit-any` + import ordering is nearly free and locks in the current discipline.
- **tsconfig:** consider `noUncheckedIndexedAccess` (low priority; will surface some churn).
- Non-null assertions cluster in `src/server/conversions/google-ads.ts` (6) — worth a pass.
- `src/components/admin/orders/OrderPdf.tsx` has no direct test (covered only via the PDF route).
- `src/lib/theme.ts:7` carries the one real TODO (design tokens vs live site).

### 7.1 Documentation drift — update the tracking docs

The planning docs have fallen behind the tree, which will corrupt future prioritisation:
- `IMPROVEMENT_ROADMAP.md` 1.2 (forgot-password) is marked open but **built** (`api/auth/forgot-password`, `reset-password`, with tests).
- Roadmap 4.1 / `TESTING_CHECKLIST.md` §8 (Playwright) marked open but the specs **exist**.
- `CODE_REVIEW_FINDINGS.md` Round 2 is entirely unchecked; several items are genuinely still open (see §9.1) — worth re-triaging in one pass and closing what's done.

Consider collapsing the seven planning docs into two living ones (a roadmap and an open-findings list); the rest are historical and could move to `docs/archive/`.

---

## 8. Bugs found during review

| Where | Bug |
|---|---|
| `o/[token]/view.tsx:309–310` | Double `setChangesRequested` — first call (with `order.orderNumber`) is dead |
| `orders/contract.ts:65` | `requireAccessCode` accepted by the public API contract but never read by `createOrder` |
| `api/admin/orders/route.ts:14–15` | `limit`/`offset` unclamped (`Number(...?? 100)`) — a huge `limit` fetches the whole table (also tracked as CODE_REVIEW R2 §2.5) |
| `email.ts` | `sendStaffConfirmationEmail` skips the branded layout; SMTP error message drifts between two spellings |
| `processor.ts:10–13` | Header comment claims concurrent runs are "no-op"; only status-marking is guarded, handlers still double-execute |

---

## 9. Outstanding items already tracked elsewhere

### 9.1 CODE_REVIEW_FINDINGS.md Round 2 — verified still open
- §1.1 HTML injection into emails (no `escapeHtml`; customer-typed `comment` interpolated raw) — **the most important open item**, pairs naturally with the `sendEmail()` refactor in §4.5.
- §1.7 Deactivated/demoted staff retain access until cookie expiry (no per-request `isActive`/role re-check).
- §2.3 `invoiceUrl` accepts `javascript:` URLs (`z.string().url()` without protocol refinement).
- §2.5 Unclamped pagination + ILIKE wildcard escaping.
- §1.4 Cron GET returns 405 (moot if pg_cron POST is the settled mechanism — decide and close).

### 9.2 Deliberately deferred (fine to leave)
- `getStaleOrders` app-side aggregation (bounded today).
- Invite `setupUrl` returned in JSON (accepted trade-off).

---

## 10. Potential features

Beyond `IMPROVEMENT_ROADMAP.md` Phases 5–7 (which remain the backlog of record), this review suggests:

1. **Per-handler outbox delivery tracking** (§4.6) — a `domain_event_deliveries` table; prerequisite for adding more consumers safely (webhooks, CRM sync) without double-side-effects.
2. **Outbound webhooks for the platform** (PROJECT_BRIEF §15.4 / roadmap 6.1) — becomes straightforward once (1) lands; `order.confirmed` → platform endpoint.
3. **OpenAPI spec for `POST /api/orders`** (§15.7 / roadmap 6.2) — generate from the Zod contract (`zod-to-openapi`) so the doc can't drift; fixes the dead `requireAccessCode` field as a side effect.
4. **Admin activity feed** — `domain_events` already captures actor-attributed history; a simple filterable feed page (per order and global) is cheap and high-value for a shared sales tool.
5. **Roster completion nudges** — scheduled reminder to unsubmitted members N days before deadline (the outbox + reminder email machinery already exists).
6. **Order search upgrades** — the ILIKE search will degrade; `pg_trgm` index or tsvector column when volume warrants.
7. **Session revocation** — a `sessionVersion` column checked per request would close CODE_REVIEW §1.7 and enable "sign out everywhere".

---

## 11. Suggested sequencing

1. **Quick wins (hours):** security fixes §6.1–6.3; dead-code bug §8; dep placement; clamp pagination; wire e2e into CI; update stale docs.
2. **Route wrappers** (§4.2) + typed error hierarchy (§4.4) — do this *before* the service split so the split lands on clean seams.
3. **Client convergence:** migrate everything onto `api-fetch` (§3), then extract the customer-view shared primitives (§5 items 1–6) — collapses the three near-duplicate customer views.
4. **Service split** (§4.1) + `resolveActiveToken`/`rotateToken` (§4.3) + `sendEmail()` incl. HTML escaping (§4.5, R2 §1.1).
5. **Decompose the remaining god components** (§2) using the hooks pattern; `DashboardView` last (lowest risk).
6. **Outbox per-handler delivery + SKIP LOCKED** (§4.6), indexes (§4.7).

Each step is independently shippable and test-covered by the existing suite; run `npm run typecheck && npm test` per step, and lean on the integration tests to catch contract regressions.
