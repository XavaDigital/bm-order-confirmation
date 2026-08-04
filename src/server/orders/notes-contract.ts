import { z } from 'zod';
import { isNoteEmpty } from '@/lib/rich-text';

/**
 * Zod shapes for the note thread on an order (and on one of its garments).
 *
 * The client sends HTML from the editor. It is NOT trusted here — the service
 * sanitises it before storing (see `sanitizeNoteHtml`). Validation's job at this
 * layer is only size and emptiness.
 *
 * Emptiness is checked on the SANITISED text, not the raw string: `<p><br></p>`
 * is what an emptied contenteditable posts, and a payload made entirely of
 * markup we strip would otherwise pass a `.min(1)` and store as a blank note.
 */
const noteBody = z
  .string()
  .max(20_000, 'Note is too long')
  .refine((html) => !isNoteEmpty(html), { message: 'Note is empty' });

export const createOrderNoteSchema = z.object({
  body: noteBody,
  /**
   * Attach the note to one garment of this order. Omitted/null = a note on the
   * order as a whole. The service checks the garment actually belongs to the
   * order, so this cannot be used to write into another order's thread.
   */
  garmentId: z.string().uuid().nullish(),
  /** Opt this note into the supplier portal thread. Defaults to 'internal'. */
  visibility: z.enum(['internal', 'shared']).optional(),
  /**
   * 'note' = an order note — a finalisation point ("sleeves 1cm shorter"),
   * David's 2026-08-04 distinction. Defaults to 'comment', the discussion
   * thread.
   */
  kind: z.enum(['comment', 'note']).optional(),
});

export const updateOrderNoteSchema = z.object({
  body: noteBody,
});

export type CreateOrderNoteInput = z.infer<typeof createOrderNoteSchema>;
export type UpdateOrderNoteInput = z.infer<typeof updateOrderNoteSchema>;
