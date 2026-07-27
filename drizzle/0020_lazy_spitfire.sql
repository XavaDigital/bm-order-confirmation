CREATE TABLE "confirmation"."assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "confirmation"."workflow_stage_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_blocking" boolean DEFAULT true NOT NULL,
	"confirmation_policy" text,
	"gate_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status_key" text NOT NULL,
	"advances_to_status" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"warn_after_hours" integer,
	"urgent_after_hours" integer,
	"default_confirmation_policy" text DEFAULT 'any' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."workflow_task_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"confirmed_by_staff_user_id" uuid,
	"confirmed_by_email" text,
	"note" text,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "workflow_stage_slug" text;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "stage_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD COLUMN "workflow_stage_slug" text;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD COLUMN "stage_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confirmation"."assignments" ADD CONSTRAINT "assignments_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."assignments" ADD CONSTRAINT "assignments_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."workflow_stage_tasks" ADD CONSTRAINT "workflow_stage_tasks_stage_id_workflow_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "confirmation"."workflow_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."workflow_task_completions" ADD CONSTRAINT "workflow_task_completions_task_id_workflow_stage_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "confirmation"."workflow_stage_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."workflow_task_completions" ADD CONSTRAINT "workflow_task_completions_confirmed_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("confirmed_by_staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_unique_uq" ON "confirmation"."assignments" USING btree ("staff_user_id","entity_type","entity_id","role");--> statement-breakpoint
CREATE INDEX "assignments_entity_idx" ON "confirmation"."assignments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "assignments_user_idx" ON "confirmation"."assignments" USING btree ("staff_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stage_tasks_stage_slug_uq" ON "confirmation"."workflow_stage_tasks" USING btree ("stage_id","slug");--> statement-breakpoint
CREATE INDEX "workflow_stage_tasks_stage_sort_idx" ON "confirmation"."workflow_stage_tasks" USING btree ("stage_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_board_slug_uq" ON "confirmation"."workflow_stages" USING btree ("board_key","slug");--> statement-breakpoint
CREATE INDEX "workflow_stages_board_sort_idx" ON "confirmation"."workflow_stages" USING btree ("board_key","sort_order");--> statement-breakpoint
CREATE INDEX "workflow_stages_status_idx" ON "confirmation"."workflow_stages" USING btree ("board_key","status_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_task_completions_user_uq" ON "confirmation"."workflow_task_completions" USING btree ("task_id","entity_type","entity_id","confirmed_by_staff_user_id") WHERE "confirmation"."workflow_task_completions"."confirmed_by_staff_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_task_completions_system_uq" ON "confirmation"."workflow_task_completions" USING btree ("task_id","entity_type","entity_id") WHERE "confirmation"."workflow_task_completions"."confirmed_by_staff_user_id" is null;--> statement-breakpoint
CREATE INDEX "workflow_task_completions_entity_idx" ON "confirmation"."workflow_task_completions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "orders_stage_idx" ON "confirmation"."orders" USING btree ("workflow_stage_slug","stage_entered_at") WHERE "confirmation"."orders"."workflow_stage_slug" is not null;--> statement-breakpoint
CREATE INDEX "purchase_orders_stage_idx" ON "confirmation"."purchase_orders" USING btree ("workflow_stage_slug","stage_entered_at") WHERE "confirmation"."purchase_orders"."workflow_stage_slug" is not null;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-appended seeds (drizzle-kit only generates DDL).
--
-- Every status gets at least one stage, so a board is always renderable from
-- stages alone and no backfill of existing rows is needed: the read path
-- resolves a null/unknown slug to the first active stage in the row's status
-- group.
--
-- ON CONFLICT DO NOTHING throughout, because the PGlite test harness replays
-- every migration on each run and this must be idempotent.
--
-- The one-per-status stages are PROTECTED (see PROTECTED_STAGE_SLUGS in
-- src/server/workflow/stages.ts): renameable and recolourable, never
-- deactivatable, because the default-stage fallback depends on one existing.
-- ---------------------------------------------------------------------------

-- Order board: one stage per order_status, plus the pre-production expansion
-- inside the `confirmed` group. Sort orders are spaced by 10 so a stage can be
-- inserted between two others without renumbering.
INSERT INTO "confirmation"."workflow_stages"
  ("board_key","slug","name","status_key","advances_to_status","sort_order","color","is_terminal","warn_after_hours","urgent_after_hours","default_confirmation_policy")
VALUES
  ('order','draft','Draft','draft',NULL,10,'#8c8c8c',false,NULL,NULL,'any'),
  ('order','sent','Sent','sent',NULL,20,'#1677ff',false,72,168,'any'),
  ('order','viewed','Viewed','viewed',NULL,30,'#faad14',false,48,120,'any'),
  ('order','changes_requested','Changes Requested','changes_requested',NULL,40,'#ff4d4f',false,24,72,'any'),
  -- `confirmed` is one status with several stages: the customer has signed off
  -- and the job now walks through pre-production. These all sit under
  -- 'confirmed', so advances_to_status stays NULL — moving between them is a
  -- pure stage move with no status transition.
  ('order','confirmed','Confirmed','confirmed',NULL,50,'#52c41a',false,NULL,NULL,'any'),
  ('order','artwork','Artwork','confirmed',NULL,60,'#6366f1',false,48,96,'any'),
  ('order','digitising','Digitising / Strike-off','confirmed',NULL,70,'#818cf8',false,72,144,'any'),
  ('order','fabric_confirmation','Fabric Confirmation','confirmed',NULL,80,'#a5b4fc',false,48,96,'any'),
  ('order','sizing_locked','Sizing Locked','confirmed',NULL,90,'#34d399',false,48,96,'any'),
  ('order','ready_for_production','Ready for Production','confirmed',NULL,100,'#10b981',false,NULL,NULL,'any'),
  ('order','cancelled','Cancelled','cancelled',NULL,200,'#595959',true,NULL,NULL,'any')
ON CONFLICT ("board_key","slug") DO NOTHING;
--> statement-breakpoint

-- Purchase-order board: one stage per po_status and nothing more. This stays the
-- supplier-facing machine; the pre-production checklist lives on the ORDER.
INSERT INTO "confirmation"."workflow_stages"
  ("board_key","slug","name","status_key","advances_to_status","sort_order","color","is_terminal","warn_after_hours","urgent_after_hours","default_confirmation_policy")
VALUES
  ('purchase_order','draft','Draft','draft',NULL,10,'#8c8c8c',false,24,72,'any'),
  ('purchase_order','sent','Sent to Supplier','sent',NULL,20,'#1677ff',false,72,168,'any'),
  ('purchase_order','confirmed','Supplier Confirmed','confirmed',NULL,30,'#13c2c2',false,72,168,'any'),
  ('purchase_order','pre_production','Pre-production','pre_production',NULL,40,'#6366f1',false,120,240,'any'),
  ('purchase_order','in_production','In Production','in_production',NULL,50,'#722ed1',false,336,504,'any'),
  ('purchase_order','in_transit','In Transit','in_transit',NULL,60,'#faad14',false,240,480,'any'),
  ('purchase_order','received','Received','received',NULL,70,'#52c41a',false,NULL,NULL,'any'),
  ('purchase_order','completed','Completed','completed',NULL,80,'#389e0d',true,NULL,NULL,'any'),
  ('purchase_order','remake','Remake','remake',NULL,90,'#ff4d4f',false,72,168,'any'),
  ('purchase_order','cancelled','Cancelled','cancelled',NULL,200,'#595959',true,NULL,NULL,'any')
ON CONFLICT ("board_key","slug") DO NOTHING;
--> statement-breakpoint

-- Pre-production checklist on the order board. Blocking by default (the
-- sequential majority), with ONE deliberately non-blocking example: a dispatched
-- colour sample follows the job without holding the chain, but still carries the
-- po_send gate so it cannot be ignored when the PO goes out.
--
-- gate_keys is what gives a task teeth: a gate is "every active task carrying
-- this key is satisfied", evaluated against the ORDER's checklist.
INSERT INTO "confirmation"."workflow_stage_tasks"
  ("stage_id","slug","name","description","is_blocking","gate_keys","sort_order")
SELECT s."id", v."slug", v."name", v."description", v."is_blocking", v."gate_keys"::jsonb, v."sort_order"
FROM (VALUES
  ('artwork','artwork_approved','Artwork approved','Final artwork signed off internally.',true,'["po_send"]',10),
  ('digitising','strike_off_approved','Strike-off / digitising approved','Embroidery digitising or print strike-off checked.',true,'["po_send"]',10),
  ('fabric_confirmation','fabric_confirmed','Fabric confirmed','Fabric and colourway confirmed as available.',true,'["po_send"]',10),
  ('sizing_locked','sizing_confirmed','Sizing confirmed','Roster/sizing final — no further size changes expected.',true,'["po_send"]',10),
  ('confirmed','colour_sample_dispatched','Colour sample dispatched','Only when the customer asked for a colour book or sample. Non-blocking: the job continues, but the PO gate still checks it.',false,'["po_send"]',20)
) AS v("stage_slug","slug","name","description","is_blocking","gate_keys","sort_order")
JOIN "confirmation"."workflow_stages" s
  ON s."board_key" = 'order' AND s."slug" = v."stage_slug"
ON CONFLICT ("stage_id","slug") DO NOTHING;
