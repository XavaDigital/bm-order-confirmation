-- Re-confirmation (David, 2026-08-07): an order edited after the customer
-- agreed to it can be put back in front of them, and each agreement keeps its
-- own immutable snapshot.
--
-- NOTE the DROP CONSTRAINT. Migrations here are additive by rule, and this is
-- the one exception the feature cannot avoid: `confirmations` allowed one row
-- per order, and the record of what was originally signed must survive a second
-- agreement rather than be overwritten. No data is lost — the unique is
-- replaced by (order_id, revision), and every existing row is revision 1 by
-- default. IF EXISTS / IF NOT EXISTS throughout, as with 0042-0044 and 0047,
-- because this schema has reached production outside the pipeline before.
ALTER TABLE "confirmation"."confirmations" DROP CONSTRAINT IF EXISTS "confirmations_order_id_unique";--> statement-breakpoint
ALTER TABLE "confirmation"."confirmations" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN IF NOT EXISTS "reconfirm_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN IF NOT EXISTS "reconfirm_requested_by" text;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN IF NOT EXISTS "reconfirm_requested_note" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "confirmations_order_revision_uq" ON "confirmation"."confirmations" USING btree ("order_id","revision");--> statement-breakpoint

-- Hand-added: the hold on production. David chose to block sending rather than
-- only warn, through the EXISTING pre-send checklist so it appears beside the
-- other checks and can be sidestepped with a reason — a customer who goes quiet
-- on holiday must not be able to stall a job with no way forward.
-- `auto_rule` is evaluated in checklist-service.ts; this item is never ticked
-- by hand, it answers itself.
INSERT INTO "confirmation"."po_checklist_items" ("label","auto_rule","allow_sidestep","sort_order")
SELECT * FROM (VALUES
  ('Customer has confirmed the current version', 'customer_confirmed_current_version', true, 50)
) AS seed("label","auto_rule","allow_sidestep","sort_order")
WHERE NOT EXISTS (
  SELECT 1 FROM "confirmation"."po_checklist_items"
  WHERE "auto_rule" = 'customer_confirmed_current_version'
);
