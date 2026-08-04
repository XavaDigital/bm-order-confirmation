# Open findings & deferred work

The living list of known-open items (David, 2026-08-03: "keep a record of the
points that are still open"). Sources: the July 2026 codebase assessment
(`claude/codebase-review-refactor` branch), CODE_REVIEW_FINDINGS Round 2, and
the 2026-08-01→03 build sprint. Remove items when done; date additions.

## From the July assessment — still open

### Structural (worth a dedicated refactoring session)
- **Split `src/server/orders/service.ts`** (§4.1) — it was 931 lines at review
  time and has only grown (queries/reports/garments/access/lifecycle modules,
  shared `src/server/errors.ts`). Keep everything under `src/server/orders/`
  to preserve the only-place-orders-are-mutated invariant.
- **Per-handler outbox delivery tracking** (§4.6.2) — a retried event re-runs
  ALL its handlers, so a partial failure re-sends emails that already went.
  A `domain_event_deliveries` table (or idempotency keys per handler) fixes
  it; prerequisite for adding webhook/CRM consumers safely. (The 2026-08-03
  hub-timeline handler works around this by being best-effort — it would
  rather drop a row than risk duplicate emails.)
- **Decompose the god components** (§2): `o/[token]/view.tsx` and
  `OrderDetailView.tsx` are both LARGER than at review time (the 2026-08-03
  sprint added to each). Hooks pattern per the assessment; `DashboardView`
  last.
- **Handler registration for the outbox** (§4.6.3) — processor.ts still
  imports feature modules concretely.
- **Indexes** (§4.7): `domain_events (aggregate_id, event_type)` and
  `(status, next_attempt_at)`; `conversion_events.order_id`;
  `garment_sizing.roster_member_id`. Also enum-as-text drift on
  `domainEvents.eventType` (a typo'd emit is accepted silently).

### Smaller, discrete
- **`requireAccessCode` dead contract field** (`orders/contract.ts`) —
  accepted by the public API, never read by `createOrder`. Wire or remove
  (removal is a documented-contract change; coordinate with bm-sales' quote
  conversion caller).
- **No Content-Security-Policy** — start report-only with a nonce for the GTM
  inline script.
- **Upload content-type sniffing** — client MIME trusted on uploads; sanitise
  extensions to `[a-z0-9]+` (admin-only surface, low severity).
- **`getOrderForCustomer` returns `internalNotes`** — only the page-level
  field allowlist stops the leak; strip at the service layer like the roster
  paths do (which have regression tests).
- **`/api/auth/login`+`logout` outside the Origin CSRF check** (sameSite=lax
  mitigates).
- **`POST /api/orders` has no rate limit** — the only unauthenticated-ish
  surface without one.
- **Password policy min-8 only; TOTP secrets plaintext at rest.**
- **Playwright**: five specs exist in `e2e/` but CI never runs them, and
  CLAUDE.md wrongly says none exist. Wire `test:e2e` into CI (or nightly) and
  correct CLAUDE.md.
- **Coverage thresholds** absent from vitest config.
- **Doc drift** (§7.1): IMPROVEMENT_ROADMAP/TESTING_CHECKLIST mark built
  things as open; CODE_REVIEW_FINDINGS Round 2 needs a close-out pass
  (several items WERE closed 2026-08-03 — see below). Consider collapsing the
  planning docs into a roadmap + this file, archive the rest.

### Closed 2026-08-03 (for the record)
`186ad26`: x-vercel-forwarded-for now Vercel-only (§6.2); signature payload
bounded + shape-checked (§6.3); escapeHtml on all email user-content sites
(R2 §1.1); invoiceUrl http(s)-only (R2 §2.3); pagination clamped (R2 §2.5);
double-setChangesRequested dead code removed. Earlier, independently: route
wrapper (`defineRoute`), `resolveActiveToken`/`mintToken`, outbox SKIP
LOCKED, `sendEmail()` extraction, customer shared primitives, `ORDER_STATUS`
registry, per-request identity re-check (R2 §1.7).

## Product / build queue

- **Reconfirmation flow** (approved 2026-08-03): additive changes roll on
  with a "changed since confirmation" indicator; material changes optionally
  trigger a v2 snapshot reconfirmation (`confirmed → reconfirm_requested →
  confirmed`, one confirmations row per revision). NEXT MAJOR BUILD.
- **Dependency majors held deliberately** (merge = migration project, not a
  click): Next 15→16 (+eslint-config-next 16), zod 3→4, eslint 9→10,
  @types/node 22→26, @types/bcryptjs 3, drizzle-kit 0.31.
- **Fleet (from the coordination thread)**: shared-note push to the hub
  timeline awaits salesflow's confirmation of the visibility reading;
  contact→customer membership-attach awaits a hub-side `customerId` on
  `POST /contacts`; the asset-pull and create-from-email e2es await a human
  browser run.
- **Old roster surfaces**: the token-based shared/member link pages still
  serve pre-redesign links; retire them once outstanding links have aged out.

## Operational

- Migrations 0030–0036 pending prod as of 2026-08-04 14:00 NZT — one
  `npm run deploy` applies them in order. (0035 adds
  `order_access.token_plain`; confirmation links generated before it is
  live cannot display their URL until regenerated. 0036 adds
  `order_notes.kind` — order notes vs comments.)
- Cloud Build deploy-on-push: GitHub App installed (2026-08-04),
  `cloudbuild.yaml` in repo; one-time setup runbook in
  CLOUD_BUILD_SETUP.md needs a live `gcloud auth login` session.
- gcloud daily-reauth: verdict due after ~16h from the 2026-08-03 14:00
  login; if it recurs, the fix is the Cloud Build deploy-on-push pipeline
  (see memory).
