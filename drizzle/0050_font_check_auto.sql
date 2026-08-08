-- "Check if font files need to be uploaded" answers itself once a font file is
-- attached (David, 2026-08-08).
--
-- Matched on the auto_rule being unset AND the label still being the seeded one
-- from 0041: the checklist is CONFIG, so if someone has already reworded this
-- check or wired it to something else, that is their decision and this leaves
-- it alone. Re-running changes nothing.
--
-- A job needing no fonts still satisfies the check by hand — satisfaction is
-- "auto rule holds OR someone ticked it", and "we looked, there are none" is a
-- judgement a person makes.
UPDATE "confirmation"."po_checklist_items"
SET "auto_rule" = 'font_file_attached'
WHERE "auto_rule" IS NULL
  AND "label" = 'Checked whether any fonts need to be uploaded';
