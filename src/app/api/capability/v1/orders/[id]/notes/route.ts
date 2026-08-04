import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addOrderNote, listOrderNotes } from '@/server/orders/notes-service';
import type { OrderNoteDto } from '@/server/orders/notes-service';
import { buildOrderNoteEnvelope } from '@/server/hub/timeline';
import { defineRoute } from '@/lib/route-handler';
import { resolveActingUserLabel } from '@/server/identity/client';

/**
 * The §3 envelope for a live (non-deleted) note DTO, from THE note-envelope
 * serializer (FLEET_STANDARD_ANNOTATIONS §7) — the same function the outbox
 * push feeds, so this surface and the push cannot drift apart in shape.
 */
function noteEnvelope(orderId: string, n: OrderNoteDto) {
  return buildOrderNoteEnvelope(orderId, {
    id: n.id,
    body: n.body,
    kind: n.kind,
    authorKind: n.authorKind,
    authorLabel: n.authorLabel,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    deletedAt: null, // this surface only serves live rows — absence IS the tombstone
  });
}

const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

/**
 * Email Flow adds an ORDER NOTE — a finalisation point ("sleeves 1cm shorter",
 * "numbers inside the hem"), David's 2026-08-04 distinction — not a thread
 * comment. Same guard as the sibling capability route.
 */
export const POST = defineRoute<{ id: string }, typeof noteSchema._type>({
  auth: 'capability',
  tag: 'capability/orders/[id]/notes POST',
  schema: noteSchema,
  handler: async ({ params, body, actingUser }) => {
    const note = await addOrderNote(params.id, {
      body: body.body,
      kind: 'note',
      authorKind: 'email_flow',
      // X-Acting-User is an identity-service UUID, which read as a wall of hex
      // in the note thread. Resolve it to a person when the identity seam is
      // configured; fall back to the raw id when it is not, which is the same
      // behaviour as before.
      authorLabel: await resolveActingUserLabel(actingUser!),
    });
    // `envelope` rides additively: the hub's write-through caches the OWNER's
    // response (FLEET_STANDARD_ANNOTATIONS §5.2), and this is the canonical
    // shape it caches. Existing readers of the flat DTO fields are untouched.
    return NextResponse.json({ ...note, envelope: noteEnvelope(params.id, note) }, { status: 201 });
  },
});

/**
 * Email Flow reads the order notes — the current live list, not the lossy
 * timeline echo. Comments (the discussion thread) are deliberately not on
 * this surface yet (David, 2026-08-04: "could come later").
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'capability',
  // The hub's read-repair engine calls this without a human actor
  // (FLEET_STANDARD_ANNOTATIONS §6); the brokered relay still forwards
  // X-Acting-User when a person is behind the read.
  actingUserOptional: true,
  tag: 'capability/orders/[id]/notes GET',
  handler: async ({ params }) => {
    const notes = await listOrderNotes(params.id, 'all', { kind: 'note' });
    return NextResponse.json({
      items: notes
        // Full state of the FLEET-VISIBLE subset (FLEET_STANDARD_ANNOTATIONS
        // §2/§9): deleted rows are absent (absence = tombstone to diff-apply),
        // and supplier-authored rows never leave the app — today no supplier
        // path writes kind 'note', but the boundary belongs here, not in that
        // assumption.
        .filter((n) => !n.deleted && n.authorKind !== 'supplier')
        .map((n) => ({
          id: n.id,
          body: n.body,
          authorLabel: n.authorLabel,
          authorKind: n.authorKind,
          createdAt: n.createdAt,
          // Additive per §11: the flat fields stay for existing readers
          // (Email Flow's panel); the envelope is what the hub's read-repair
          // diff-applies, from the same serializer as the push (§7).
          envelope: noteEnvelope(params.id, n),
        })),
    });
  },
});
