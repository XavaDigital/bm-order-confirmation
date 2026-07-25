CREATE TABLE "confirmation"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_email" text,
	"actor_staff_user_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
UPDATE "confirmation"."orders" SET "order_value_currency" = 'NZD' WHERE "order_value_currency" IS NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ALTER COLUMN "order_value_currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_size_chart_links" ADD CONSTRAINT "garment_size_chart_links_garment_id_size_chart_id_pk" PRIMARY KEY("garment_id","size_chart_id");--> statement-breakpoint
ALTER TABLE "confirmation"."garment_type_size_chart_links" ADD CONSTRAINT "garment_type_size_chart_links_garment_type_id_size_chart_id_pk" PRIMARY KEY("garment_type_id","size_chart_id");--> statement-breakpoint
ALTER TABLE "confirmation"."conversion_events" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_sizing" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_sizing" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."audit_events" ADD CONSTRAINT "audit_events_actor_staff_user_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_aggregate_idx" ON "confirmation"."audit_events" USING btree ("aggregate_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "confirmation"."audit_events" USING btree ("actor_email");--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_events_order_uq" ON "confirmation"."conversion_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_id_idx" ON "confirmation"."domain_events" USING btree ("aggregate_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "domain_events_outbox_idx" ON "confirmation"."domain_events" USING btree ("created_at") WHERE "confirmation"."domain_events"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "garment_sizing_roster_member_idx" ON "confirmation"."garment_sizing" USING btree ("roster_member_id");--> statement-breakpoint
UPDATE "confirmation"."order_access" oa SET "revoked_at" = now() WHERE oa."revoked_at" IS NULL AND EXISTS (SELECT 1 FROM "confirmation"."order_access" n WHERE n."order_id" = oa."order_id" AND n."revoked_at" IS NULL AND (n."created_at" > oa."created_at" OR (n."created_at" = oa."created_at" AND n."id" > oa."id")));--> statement-breakpoint
CREATE UNIQUE INDEX "order_access_one_active_uq" ON "confirmation"."order_access" USING btree ("order_id") WHERE "confirmation"."order_access"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "confirmation"."orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_deadline_idx" ON "confirmation"."orders" USING btree ("deadline_date");--> statement-breakpoint
CREATE INDEX "orders_created_by_idx" ON "confirmation"."orders" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "orders_color_sample_idx" ON "confirmation"."orders" USING btree ("color_sample_requested_at") WHERE "confirmation"."orders"."color_sample_requested_at" is not null;--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "confirmation"."rate_limits" USING btree ("window_start");--> statement-breakpoint
UPDATE "confirmation"."roster_access" ra SET "revoked_at" = now() WHERE ra."revoked_at" IS NULL AND EXISTS (SELECT 1 FROM "confirmation"."roster_access" n WHERE n."order_id" = ra."order_id" AND n."revoked_at" IS NULL AND (n."created_at" > ra."created_at" OR (n."created_at" = ra."created_at" AND n."id" > ra."id")));--> statement-breakpoint
CREATE UNIQUE INDEX "roster_access_one_active_uq" ON "confirmation"."roster_access" USING btree ("order_id") WHERE "confirmation"."roster_access"."revoked_at" is null;--> statement-breakpoint
UPDATE "confirmation"."roster_member_access" ma SET "revoked_at" = now() WHERE ma."revoked_at" IS NULL AND EXISTS (SELECT 1 FROM "confirmation"."roster_member_access" n WHERE n."roster_member_id" = ma."roster_member_id" AND n."revoked_at" IS NULL AND (n."created_at" > ma."created_at" OR (n."created_at" = ma."created_at" AND n."id" > ma."id")));--> statement-breakpoint
CREATE UNIQUE INDEX "roster_member_access_one_active_uq" ON "confirmation"."roster_member_access" USING btree ("roster_member_id") WHERE "confirmation"."roster_member_access"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "staff_users_invite_token_idx" ON "confirmation"."staff_users" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "staff_users_reset_token_idx" ON "confirmation"."staff_users" USING btree ("reset_token_hash");