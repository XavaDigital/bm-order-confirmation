ALTER TYPE "confirmation"."po_status" ADD VALUE 'approved' BEFORE 'sent';--> statement-breakpoint
ALTER TYPE "confirmation"."po_status" ADD VALUE 'test_print' BEFORE 'in_production';--> statement-breakpoint
ALTER TYPE "confirmation"."po_status" ADD VALUE 'prod_layout' BEFORE 'in_production';--> statement-breakpoint
ALTER TYPE "confirmation"."po_status" ADD VALUE 'quality_control' BEFORE 'in_transit';--> statement-breakpoint
ALTER TABLE "confirmation"."shipment_purchase_orders" ADD COLUMN "contents_note" text;--> statement-breakpoint
ALTER TABLE "confirmation"."suppliers" ADD COLUMN "portal_password" text;--> statement-breakpoint
ALTER TABLE "confirmation"."suppliers" ADD COLUMN "po_seq" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-appended (drizzle-kit only generates DDL) — David's 2026-08-05 PO
-- production vocabulary.
--
-- One stage per new status so the board stays renderable (the default-stage
-- fallback needs at least one active stage per status — PROTECTED_STAGE_SLUGS
-- in src/server/workflow/stages.ts gains these slugs in the same commit).
-- status_key is a text column, so inserting alongside the enum ADD VALUEs in
-- one migration transaction is safe (the enum VALUES themselves are not used
-- here).
INSERT INTO "confirmation"."workflow_stages"
  ("board_key","slug","name","status_key","advances_to_status","sort_order","color","is_terminal","warn_after_hours","urgent_after_hours","default_confirmation_policy")
VALUES
  ('purchase_order','approved','Approved','approved',NULL,15,'#13c2c2',false,72,168,'any'),
  ('purchase_order','test_print','Test Print','test_print',NULL,42,'#eb2f96',false,72,144,'any'),
  ('purchase_order','prod_layout','Prod Layout','prod_layout',NULL,44,'#faad14',false,72,144,'any'),
  ('purchase_order','quality_control','Quality Control','quality_control',NULL,55,'#a0d911',false,48,96,'any')
ON CONFLICT ("board_key","slug") DO NOTHING;
--> statement-breakpoint

-- Relabel the surviving default stage names to the new vocabulary — but only
-- where they still carry the 0020 seed name, so a staff rename is never
-- clobbered (stages MAY be renamed; that is the supported customisation).
UPDATE "confirmation"."workflow_stages" SET "name"='Unconfirmed'  WHERE "board_key"='purchase_order' AND "slug"='sent'           AND "name"='Sent to Supplier';--> statement-breakpoint
UPDATE "confirmation"."workflow_stages" SET "name"='Design Prep'  WHERE "board_key"='purchase_order' AND "slug"='pre_production' AND "name"='Pre-production';--> statement-breakpoint
UPDATE "confirmation"."workflow_stages" SET "name"='Production'   WHERE "board_key"='purchase_order' AND "slug"='in_production'  AND "name"='In Production';--> statement-breakpoint
UPDATE "confirmation"."workflow_stages" SET "name"='Shipping'     WHERE "board_key"='purchase_order' AND "slug"='in_transit'     AND "name"='In Transit';
