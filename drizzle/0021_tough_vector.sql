CREATE TABLE "confirmation"."inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"entity_type" text,
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"email_subject" text,
	"email_html" text,
	"email_sent_at" timestamp with time zone,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."notification_event_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."notification_recipient_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"role_key" text,
	"staff_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."inbox_items" ADD CONSTRAINT "inbox_items_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_items_unread_idx" ON "confirmation"."inbox_items" USING btree ("staff_user_id","created_at") WHERE "confirmation"."inbox_items"."read_at" is null;--> statement-breakpoint
CREATE INDEX "inbox_items_pending_email_idx" ON "confirmation"."inbox_items" USING btree ("email_attempts") WHERE "confirmation"."inbox_items"."email_subject" is not null and "confirmation"."inbox_items"."email_sent_at" is null;--> statement-breakpoint
CREATE INDEX "inbox_items_entity_idx" ON "confirmation"."inbox_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_claim_uq" ON "confirmation"."notification_deliveries" USING btree ("event_key","dedupe_key","staff_user_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_settings_key_uq" ON "confirmation"."notification_event_settings" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "notification_recipient_rules_event_idx" ON "confirmation"."notification_recipient_rules" USING btree ("event_key");