ALTER TABLE "confirmation"."po_checklist_completions" ADD COLUMN "sidestepped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."po_checklist_completions" ADD COLUMN "sidestep_reason" text;--> statement-breakpoint
ALTER TABLE "confirmation"."po_checklist_items" ADD COLUMN "allow_sidestep" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-appended (David, 2026-08-06):
-- 1. The PO's REVIEW stage — the value stays `approved` (pg enum values cannot
--    be renamed), only the board stage's display name changes, and only where
--    it still carries the 0038 seed name (a staff rename is never clobbered).
UPDATE "confirmation"."workflow_stages" SET "name"='Review'
 WHERE "board_key"='purchase_order' AND "slug"='approved' AND "name"='Approved';
--> statement-breakpoint

-- 2. Which seeded checks may be sidestepped. The two judgement calls can be
--    acknowledged past with a stated reason; a missing DESIGN FILE cannot —
--    the factory has nothing to make without it.
UPDATE "confirmation"."po_checklist_items" SET "allow_sidestep"=true
 WHERE "label" IN ('Design file includes colours','Checked whether any fonts need to be uploaded');
--> statement-breakpoint

-- 3. Remake sits BEFORE Completed on the board (David, 2026-08-06): a remake
--    is work still in flight, so it belongs beside Received rather than past
--    the terminal column. Only where the column still carries its 0020 seed
--    position — a staff reorder is never clobbered.
UPDATE "confirmation"."workflow_stages" SET "sort_order"=75
 WHERE "board_key"='purchase_order' AND "slug"='remake' AND "sort_order"=90;
