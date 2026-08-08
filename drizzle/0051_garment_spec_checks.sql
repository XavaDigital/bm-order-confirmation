-- Six more pre-production checks (David, 2026-08-08): a factory cannot work
-- without a picture, a size chart, a fabric and an answer to every required
-- option — nor can production plan without the two dates.
--
-- NOT sidesteppable, on David's explicit ruling ("all six must actually be
-- done"): unlike the colour sample, none of these has a legitimate "does not
-- apply" case. `allow_sidestep` therefore stays false, which is the default.
--
-- All six answer themselves (auto_rule) — there is nothing to tick by hand,
-- and a check about data should never disagree with the data. The PO-wide line
-- is what blocks the send; WHICH garment is missing what appears in that
-- garment's own box on the purchase order screen, from the same evaluation.
--
-- Guarded per row on auto_rule, so a re-run inserts nothing and a check
-- someone has already reworded or deactivated is left alone.
INSERT INTO "confirmation"."po_checklist_items" ("label","auto_rule","allow_sidestep","sort_order")
SELECT seed.* FROM (VALUES
  ('Every garment has an image', 'garment_images_all', false, 60),
  ('Every garment has a size chart', 'garment_size_charts_all', false, 70),
  ('Every garment has a fabric selected', 'garment_fabrics_all', false, 80),
  ('Every garment has all required options answered', 'garment_required_options_all', false, 90),
  ('Required shipping date specified', 'expected_ship_date_set', false, 100),
  ('Customer deadline date specified', 'customer_deadline_set', false, 110)
) AS seed("label","auto_rule","allow_sidestep","sort_order")
WHERE NOT EXISTS (
  SELECT 1 FROM "confirmation"."po_checklist_items" existing
  WHERE existing."auto_rule" = seed."auto_rule"
);
