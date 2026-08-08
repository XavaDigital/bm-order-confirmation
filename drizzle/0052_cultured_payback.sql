-- Short titles with the explanation underneath (David, 2026-08-08: "an
-- abbreviated title with a longer explanation underneath … will make the list
-- more scannable"). Same shape `workflow_stage_tasks` already uses.
ALTER TABLE "confirmation"."po_checklist_items" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint

-- Re-word the seeded checks: the sentence that WAS the title becomes the
-- explanation, and the title shrinks to the thing being checked.
--
-- Each update is guarded on the row still carrying its seeded label, so a check
-- anyone has already re-worded is left exactly as they wrote it — this list is
-- config, not code. Re-running changes nothing.
UPDATE "confirmation"."po_checklist_items" SET
  "label" = seed.label, "description" = seed.description
FROM (VALUES
  ('At least one design file attached',
   'Design file',
   'At least one design file is attached to this purchase order.'),
  ('Design file includes colours',
   'Colours on the design',
   'The design file shows the colours the factory has to match.'),
  ('Colour book specified',
   'Colour book',
   'A factory colour book is chosen, so the colours mean the same thing at both ends.'),
  ('Checked whether any fonts need to be uploaded',
   'Fonts',
   'Any fonts the artwork needs are attached. Ticks itself when a font file is uploaded; tick it by hand when the job needs none.'),
  ('Customer has confirmed the current version',
   'Customer confirmation',
   'The customer has agreed to the order as it stands now, not an earlier version of it.'),
  ('Every garment has an image',
   'Garment images',
   'Every garment on this purchase order has at least one image the factory can look at.'),
  ('Every garment has a size chart',
   'Size charts',
   'Every garment has a size chart for the factory to cut to.'),
  ('Every garment has a fabric selected',
   'Fabrics',
   'Every garment has its fabric chosen.'),
  ('Every garment has all required options answered',
   'Garment options',
   'Every required option — cord colour, button colour and the like — has an answer.'),
  ('Required shipping date specified',
   'Shipping date',
   'The date the factory has to ship by is set.'),
  ('Customer deadline date specified',
   'Customer deadline',
   'The date the customer needs the order by is set.')
) AS seed(old_label, label, description)
WHERE "confirmation"."po_checklist_items"."label" = seed.old_label;
