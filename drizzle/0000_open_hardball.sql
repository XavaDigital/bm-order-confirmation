CREATE SCHEMA "confirmation";
--> statement-breakpoint
CREATE TYPE "confirmation"."conversion_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "confirmation"."event_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "confirmation"."order_source" AS ENUM('internal_admin', 'platform');--> statement-breakpoint
CREATE TYPE "confirmation"."order_status" AS ENUM('draft', 'sent', 'viewed', 'confirmed', 'changes_requested');--> statement-breakpoint
CREATE TYPE "confirmation"."shipping_mode" AS ENUM('prefilled', 'customer_entered', 'later');--> statement-breakpoint
CREATE TYPE "confirmation"."signature_type" AS ENUM('drawn', 'uploaded', 'none');--> statement-breakpoint
CREATE TYPE "confirmation"."staff_role" AS ENUM('sales', 'admin');--> statement-breakpoint
CREATE TABLE "confirmation"."acknowledgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"ack_key" text NOT NULL,
	"ack_text_version" text NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"signature_type" "confirmation"."signature_type" DEFAULT 'none' NOT NULL,
	"signature_storage_key" text,
	"confirmed_snapshot" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	CONSTRAINT "confirmations_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "confirmation"."conversion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"value_amount" numeric(12, 2),
	"value_currency" text,
	"fired_at" timestamp with time zone,
	"status" "confirmation"."conversion_status" DEFAULT 'pending' NOT NULL,
	"provider_response" jsonb
);
--> statement-breakpoint
CREATE TABLE "confirmation"."domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "confirmation"."event_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "confirmation"."garment_size_chart_links" (
	"garment_id" uuid NOT NULL,
	"size_chart_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."garment_sizing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"garment_id" uuid NOT NULL,
	"size" text,
	"player_name" text,
	"player_number" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."garments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fabrics" jsonb,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."mockup_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"garment_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."order_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"access_code_hash" text,
	"expires_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_access_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "confirmation"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"source" "confirmation"."order_source" DEFAULT 'internal_admin' NOT NULL,
	"external_ref" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_contact" text,
	"club_name" text,
	"order_value_amount" numeric(12, 2),
	"order_value_currency" text DEFAULT 'NZD',
	"invoice_url" text,
	"expected_ship_date" date,
	"deadline_date" date,
	"general_notes" text,
	"shipping_mode" "confirmation"."shipping_mode" DEFAULT 'prefilled' NOT NULL,
	"shipping_address" jsonb,
	"status" "confirmation"."order_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "confirmation"."size_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"storage_key" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "confirmation"."staff_role" DEFAULT 'sales' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "confirmation"."acknowledgments" ADD CONSTRAINT "acknowledgments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."confirmations" ADD CONSTRAINT "confirmations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."conversion_events" ADD CONSTRAINT "conversion_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_size_chart_links" ADD CONSTRAINT "garment_size_chart_links_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "confirmation"."garments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_size_chart_links" ADD CONSTRAINT "garment_size_chart_links_size_chart_id_size_charts_id_fk" FOREIGN KEY ("size_chart_id") REFERENCES "confirmation"."size_charts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_sizing" ADD CONSTRAINT "garment_sizing_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "confirmation"."garments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."garments" ADD CONSTRAINT "garments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."mockup_images" ADD CONSTRAINT "mockup_images_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "confirmation"."garments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."order_access" ADD CONSTRAINT "order_access_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD CONSTRAINT "orders_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ack_order_key_uq" ON "confirmation"."acknowledgments" USING btree ("order_id","ack_key");--> statement-breakpoint
CREATE INDEX "domain_events_status_idx" ON "confirmation"."domain_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_idx" ON "confirmation"."domain_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "garment_size_chart_uq" ON "confirmation"."garment_size_chart_links" USING btree ("garment_id","size_chart_id");--> statement-breakpoint
CREATE INDEX "garment_sizing_garment_idx" ON "confirmation"."garment_sizing" USING btree ("garment_id");--> statement-breakpoint
CREATE INDEX "garments_order_idx" ON "confirmation"."garments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "mockup_images_garment_idx" ON "confirmation"."mockup_images" USING btree ("garment_id");--> statement-breakpoint
CREATE INDEX "order_access_order_idx" ON "confirmation"."order_access" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_external_ref_uq" ON "confirmation"."orders" USING btree ("external_ref") WHERE "confirmation"."orders"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "confirmation"."orders" USING btree ("status");