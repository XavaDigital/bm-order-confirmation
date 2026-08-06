CREATE TABLE "confirmation"."po_checklist_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"checked_by_email" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."po_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"auto_rule" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."size_charts" ADD COLUMN "kind" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."po_checklist_completions" ADD CONSTRAINT "po_checklist_completions_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "confirmation"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."po_checklist_completions" ADD CONSTRAINT "po_checklist_completions_item_id_po_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "confirmation"."po_checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "po_checklist_completions_po_item_uq" ON "confirmation"."po_checklist_completions" USING btree ("po_id","item_id");--> statement-breakpoint
CREATE INDEX "po_checklist_items_active_idx" ON "confirmation"."po_checklist_items" USING btree ("is_active","sort_order");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-appended seed: David's four example checks (2026-08-06). Items are
-- config — staff can rename/deactivate/add from the admin; these are the
-- starting set. statement-breakpoint discipline per the 0038 lesson.
INSERT INTO "confirmation"."po_checklist_items" ("label","auto_rule","sort_order")
VALUES
  ('At least one design file attached','design_file_attached',10),
  ('Design file includes colours',NULL,20),
  ('Colour book specified','color_book_set',30),
  ('Checked whether any fonts need to be uploaded',NULL,40);
