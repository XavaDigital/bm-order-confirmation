-- Idempotent by hand (2026-08-06): these objects already exist in
-- production — they were pushed to the database outside the pipeline,
-- so the generated DDL would fail on "already exists" and block every
-- later migration. Guarded so it applies cleanly to a fresh database
-- and no-ops against the one that already has them.
CREATE TABLE IF NOT EXISTS "confirmation"."workflow_status_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"trigger_status" text NOT NULL,
	"note" text NOT NULL,
	"created_by_staff_user_id" uuid NOT NULL,
	"fired_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "confirmation"."workflow_status_reminders" ADD CONSTRAINT "workflow_status_reminders_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_status_reminders_entity_idx" ON "confirmation"."workflow_status_reminders" USING btree ("entity_type","entity_id") WHERE "confirmation"."workflow_status_reminders"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_status_reminders_creator_idx" ON "confirmation"."workflow_status_reminders" USING btree ("created_by_staff_user_id","resolved_at");