# Automatic Order Email Generator — Implementation Plan

**Status:** Phases 1–4 implemented (2026-08-05). Full suite green (`npm run typecheck`, `npm run lint`, targeted `vitest run` for `service.integration.test.ts` / `email.test.ts` / `xlsx.test.ts`). Open Questions below are unchanged — `resolveProductionRecipients` still only returns the supplier, by design.

**Origin:** feature request "Automatic order email generator" (design note screenshot, transcribed 2026-08-05 — not yet in `PROJECT_BRIEF.md`). It asks for: once all required actions/checks have been performed on an order, a one-click button that prepares and sends an email to the production team, containing a PO spreadsheet, images of each garment, required font files, and other supporting docs (e.g. size charts) — sent from the portal, without touching an email client.

A codebase check before this plan was written found **most of this already built**, under a different name: the "Send to supplier" flow (`sendPurchaseOrder`, `src/server/purchase-orders/service.ts:686-789`). This plan scopes only the gap between that flow and what was asked for, and reuses everything already there.

---

## 0. What was requested, and what's already true today

| # | Ask | Status | Where |
|---|---|---|---|
| 1 | Gate the send on "all required actions/checks" being done | ✅ Already built | `po_send` workflow gate (`GATE_CATALOG`, `src/server/workflow/gates.ts:37-44`), enforced in `sendPurchaseOrder` before rendering (`service.ts:718-723`). Admin-only override, requires a reason, audited as `workflow.gate_overridden`. |
| 2 | One-click send from the portal, no email client | ✅ Already built | "Send to supplier" button (`PoDetailView.tsx:463-466`) → `POST /api/admin/purchase-orders/[id]/send` → real SMTP send via `sendSupplierPoEmail` (`src/lib/email.ts:613`). |
| 3 | PO document attached | ⚠️ Partial — PDF only | `renderPdf` produces a PDF with garment images embedded (`service.ts:727-744`). XLSX generation exists (`src/server/purchase-orders/xlsx.ts`) but is download-only, never attached to the send. **This plan wires it in — Phase 1.** |
| 4 | Images of each garment | ⚠️ Partial — embedded, not separate files | Garment mock-ups ride inside the PDF only. **This plan adds them as standalone attachments — Phase 1.** |
| 5 | Font files | ✅ Already built | `collectSnapshotAttachments` (`service.ts:653-684`) attaches every snapshot asset with a `storageKey` (fonts, design files) as a real file. |
| 6 | Supporting docs / size charts | ✅ Already built | Same function attaches every garment's linked size chart, deduped across garments. |
| 7 | Sent to "the production team" | ❓ Undefined concept | No "production team" recipient exists anywhere in the codebase. Every send goes to `po.supplier.email` — one recipient, scoped to that PO's own supplier. **Deliberately left open — see Decisions below.** |

So the real scope of this plan is: **attach the XLSX and per-garment images to the existing send**, and **make the recipient swappable without a rewrite**, in case "production team" turns out to mean something other than the supplier. Everything else in the request — gating, one-click send, fonts, size charts — is done.

---

## Decisions locked for this plan (resolved 2026-08-05)

Three product questions came up while scoping this; answers below shape the plan. Flip one and only the affected phase changes, not the whole plan.

- **Recipient — left open on purpose.** The supplier is the only known recipient today; nothing in the codebase or `PROJECT_BRIEF.md` names a separate "production team" contact. Rather than guess at a shape, Phase 2 introduces a single recipient-resolution seam so the send targets it, not `po.supplier.email` directly. Behavior is unchanged (still the supplier) until someone decides what a "production team" recipient actually is — at which point it's a one-function change, not a service rewrite.
- **Flow — one-click send**, same as today. No new compose/preview screen. "Prepare the order email" is read as "assemble the attachments and send," matching the existing button's behavior.
- **Attachments — additive.** The PDF stays (it's the human-readable document of record, and the one the supplier portal links to); the XLSX and per-garment images are added alongside it, not instead of it.

---

## Design Summary

- **No schema changes for the attachment upgrade.** Every input already lives on `PoSnapshot` — `PoSnapshotImage[]` per garment (full storage key + thumbnail + caption, `schema.ts:1040-1046`), `PoSnapshotAsset[]` (fonts/design), `PoSnapshotSizeChart[]` (charts). `buildPoWorkbook` (`xlsx.ts`) already reads the identical snapshot the PDF and attachments read, so a regenerated workbook for a given revision matches what's sent — same reproducibility guarantee the file's own header comment already claims for the PDF.
- **Extend `collectSnapshotAttachments`, don't replace it.** It already has a "best-effort, skip unreadable, log a warning" contract (`service.ts:648-651`) — new attachment types follow that exact pattern instead of inventing a second failure mode.
- **Full-resolution images, not thumbnails**, as the default email attachment — `storageKey`, not `thumbnailStorageKey`. The factory needs to print/cut from these; the thumbnail exists for the admin UI grid, not production.
- **A size budget matters here in a way it didn't before.** Fonts and size charts are typically KBs; a PO with a dozen garments each carrying several full-res mock-ups can plausibly reach multi-tens-of-MB, and delivery here goes through Mailgun SMTP (`email.ts:5`), which caps message size around 25MB. Phase 1.3 adds a total-size guard: if the full attachment set would exceed budget, images fall back to thumbnails (still useful, and better than a silently bounced send) with a note added to the email body — see Open Question 3 before treating this as final.
- **Recipient resolution is a pure function, not a schema change.** `resolveProductionRecipients(po)` returns recipients from data that already exists (`po.supplier.email` / `contactPerson`). This is intentionally the ONLY new seam for the "production team" question — whichever shape gets decided later (a supplier-level production contact field, a per-order override, a company-wide inbox) plugs in here without touching `sendPurchaseOrder`'s attachment-building or gate logic.

---

## Phase 1 — Attach the XLSX and per-garment images to the send

**Goal:** the email a recipient gets today gains two attachment types; nothing else about the send changes.

### 1.1 Reuse `buildPoWorkbook` in the send path

`src/server/purchase-orders/service.ts`, inside `sendPurchaseOrder` (~line 727, alongside the existing `renderPdf` call):

```ts
import { buildPoWorkbook, poXlsxFilename } from './xlsx';

// ...
const xlsx = await buildPoWorkbook({
  poNumber: po.poNumber,
  revisionNumber: latest.revisionNumber,
  revisionReason: latest.reason,
  createdAt: latest.createdAt.toISOString(),
  expectedShipDate: po.expectedShipDate,
  notes: po.notes,
  supplier: {
    name: po.supplier.name,
    contactPerson: po.supplier.contactPerson,
    email: po.supplier.email,
    phone: po.supplier.phone,
  },
  snapshot: latest.snapshot, // UNSIGNED — see note below
});
```

Reads the **unsigned** `latest.snapshot`, not the `signPoSnapshotMedia(...)` copy built for the PDF — the workbook only lists image captions/filenames as text (`xlsx.ts:185-197`), it never embeds bytes, so it needs no signed URLs. Keep the two snapshot reads distinct (don't share one signed copy between PDF and workbook) so a future signing change made for the PDF can't silently affect the workbook.

### 1.2 Add per-garment images to `collectSnapshotAttachments`

`service.ts:653-684` — add a third loop alongside the existing assets/charts ones:

```ts
for (const garment of snapshot.garments) {
  let n = 0;
  for (const image of garment.images ?? []) {
    if (!image.storageKey || wanted.has(image.storageKey)) continue;
    n += 1;
    const ext = image.storageKey.split('.').pop() ?? 'bin';
    const caption = image.caption?.trim();
    const base = caption ? `${garment.name}-${caption}` : `${garment.name}-${n}`;
    wanted.set(image.storageKey, `${base}.${ext}`);
  }
}
```

Dedupe stays keyed on `storageKey` (matches the existing assets/charts loops), and the per-garment counter (`n`) avoids two uncaptioned images on the same garment colliding on one filename.

### 1.3 Size budget guard

Add near the top of `service.ts`:

```ts
const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024; // headroom under Mailgun's ~25MB cap
```

After `collectSnapshotAttachments` resolves and before `sendSupplierPoEmail` is called: sum `content.length` across the PDF, the XLSX, and the collected attachments. If over budget, re-run just the image portion of collection using `image.thumbnailStorageKey ?? image.storageKey` instead of `image.storageKey`, and pass a `sizeReduced: true` flag into `sendSupplierPoEmail` so it adds one line to the email body ("Full-resolution images were too large to attach — reduced-size copies are included."). Log a warning either way so an oversized send is visible in ops rather than only inferred from a bounce.

### 1.4 Wire attachments through `sendSupplierPoEmail`

`src/lib/email.ts:613-679` — extend `SendSupplierPoEmailParams` with `xlsx: Buffer` and fold it into the existing `attachments` array (the PDF is already hard-coded as entry 1; XLSX becomes entry 2, ahead of `extraAttachments`):

```ts
attachments: [
  { filename: `${poNumber}${amended ? `-rev${revisionNumber}` : ''}.pdf`, content: params.pdf, contentType: 'application/pdf' },
  {
    filename: poXlsxFilename(poNumber, revisionNumber),
    content: params.xlsx,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  ...(params.extraAttachments ?? []),
],
```

### 1.5 Tests

- `src/server/purchase-orders/service.integration.test.ts` — extend the existing send test's assertions: the mock email call should now receive an `xlsx` buffer and `extraAttachments` entries for each garment image's storage key (mirroring the existing font/chart assertions in the same test).
- `xlsx.test.ts` needs no change — `buildPoWorkbook` itself isn't touched, only its caller.
- New test for the size-budget fallback: stub attachment sizes to exceed `MAX_EMAIL_ATTACHMENT_BYTES` and assert `getFileBuffer` is called with thumbnail keys, not full-res keys, for the image set.

---

## Phase 2 — Recipient resolution seam

**Goal:** decouple "who this sends to" from "how the email is built," so the open "production team" question can be answered later without touching Phase 1's work.

### 2.1 Extract `resolveProductionRecipients`

New function in `service.ts`, called where `supplierEmail` is currently read directly (~line 709):

```ts
interface ProductionRecipient {
  to: string;
  toName: string;
}

/**
 * Who the PO send actually goes to. Today this is always the PO's own
 * supplier — there is no other recipient concept in this codebase yet. Kept
 * as its own function so a later decision (a distinct production-team
 * contact, a cc, a company-wide inbox) is a change here, not a rewrite of
 * sendPurchaseOrder's gate/attachment/status logic.
 */
function resolveProductionRecipients(po: {
  supplier: { email: string | null; contactPerson: string | null; name: string };
}): ProductionRecipient[] {
  if (!po.supplier.email) return [];
  return [{ to: po.supplier.email, toName: po.supplier.contactPerson ?? po.supplier.name }];
}
```

`sendPurchaseOrder` calls this once, guards on an empty array the same way it guards on `!supplierEmail` today (`ConflictError('Supplier has no email address')` becomes `ConflictError('No production recipient configured')` or similar), and sends to each entry returned — exactly one today, since the function always returns 0 or 1.

### 2.2 Do not build the "production team" schema yet

Deliberately deferred — see Open Question 1. Whichever shape gets picked (a `productionContactEmail` column on `suppliers`, a per-order override, or a single company-wide address via `src/lib/env.ts`) is a small, additive change that only touches `resolveProductionRecipients`'s body. Building it speculatively risks guessing wrong and shipping a migration that has to be walked back — against the "migrations are additive" convention in `CLAUDE.md`.

---

## Phase 3 — Admin UI

**Goal:** the "Send to supplier" button's behavior changes (more attachments); make that visible without adding new screens.

- `sendPurchaseOrder`'s return payload (`service.ts:769-774`) gains an `attachmentSummary: { images: number, fonts: number, sizeCharts: number, sizeReduced: boolean }` so the UI doesn't have to re-derive counts.
- `PoDetailView.tsx:326-343` (`sendToSupplier`) — update the success message to reflect the fuller attachment set, e.g. `Purchase order emailed to ${res.to} (PDF, spreadsheet, ${res.attachmentSummary.images} images, fonts & size charts)`, and surface a warning toast if `sizeReduced` is true.
- No new modal/preview screen — matches the one-click decision above.

---

## Phase 4 — Docs

- `CLAUDE.md`, the `sendPurchaseOrder` bullet under "Key architectural seams" — update to mention the XLSX and image attachments alongside the existing font/size-chart mention, so the next reader doesn't have to diff the code to find out this changed.
- This plan file — flip the Status line to "v1 implemented" with a date once Phases 1–3 land and `npm test && npm run typecheck && npm run lint && npm run build` are green, matching the convention set in `SUPPLIER_PORTAL_PLAN.md`.

---

## Open Questions (left for a product decision, not a build gap)

1. **Is "the production team" the supplier, or someone else?** If it's a separate internal/external contact, what identifies them — a field on `suppliers`, a field on the order, or a single company-wide address? This determines the entire shape of Phase 2.2's eventual schema change. Until answered, sends keep going to the supplier and Phase 2's seam absorbs whichever answer comes later.
2. **Should a non-supplier "production team" recipient also get the supplier portal link** (`portalUrl` in `sendSupplierPoEmail`)? That portal is scoped to the supplier's own comment/status-update permissions (`SUPPLIER_ALLOWED_STATUSES`) — appropriate for a supplier, not necessarily for an internal recipient. If a second recipient type is added later without addressing this, it needs its own call on whether to include the link.
3. **Does the size-budget fallback (Phase 1.3) need to be visible to the recipient, or is a log line enough?** Silently downgrading a factory's cut images to thumbnails is a bigger deal than the existing "skip one unreadable attachment" precedent in `collectSnapshotAttachments` — that precedent covers a single missing file, not a systematic quality downgrade of every image in the send. Worth a product call on whether this should instead **fail the send** with an actionable error so staff intervene (e.g. split into a follow-up email, or trim images) rather than ship reduced-quality files without anyone deciding to. Current plan assumes "ship reduced quality with a note" is safer than "block the send," but that assumption should be confirmed before Phase 1.3 ships, not after.
