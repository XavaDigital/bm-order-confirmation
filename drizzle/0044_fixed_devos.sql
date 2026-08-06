CREATE TABLE "confirmation"."workflow_status_reminders" (
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
ALTER TABLE "confirmation"."workflow_status_reminders" ADD CONSTRAINT "workflow_status_reminders_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_status_reminders_entity_idx" ON "confirmation"."workflow_status_reminders" USING btree ("entity_type","entity_id") WHERE "confirmation"."workflow_status_reminders"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_status_reminders_creator_idx" ON "confirmation"."workflow_status_reminders" USING btree ("created_by_staff_user_id","resolved_at");