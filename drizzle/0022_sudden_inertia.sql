CREATE TABLE "confirmation"."workflow_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."workflow_reminders" ADD CONSTRAINT "workflow_reminders_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_reminders_live_uq" ON "confirmation"."workflow_reminders" USING btree ("entity_type","entity_id","staff_user_id","kind") WHERE "confirmation"."workflow_reminders"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_reminders_due_idx" ON "confirmation"."workflow_reminders" USING btree ("due_at") WHERE "confirmation"."workflow_reminders"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_reminders_user_idx" ON "confirmation"."workflow_reminders" USING btree ("staff_user_id","due_at");