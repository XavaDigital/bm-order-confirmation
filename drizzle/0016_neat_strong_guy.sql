CREATE TYPE "confirmation"."po_status" AS ENUM('draft', 'sent', 'confirmed', 'pre_production', 'in_production', 'in_transit', 'received', 'completed', 'remake', 'cancelled');--> statement-breakpoint
CREATE TYPE "confirmation"."shipment_status" AS ENUM('pending', 'in_transit', 'delivered', 'delayed', 'exception', 'cancelled');--> statement-breakpoint
CREATE TABLE "confirmation"."purchase_order_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"reason" text,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "confirmation"."po_status" DEFAULT 'draft' NOT NULL,
	"current_revision_number" integer DEFAULT 1 NOT NULL,
	"deadline_date" date,
	"expected_ship_date" date,
	"actual_ship_date" date,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "confirmation"."shipment_purchase_orders" (
	"shipment_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	CONSTRAINT "shipment_purchase_orders_shipment_id_purchase_order_id_pk" PRIMARY KEY("shipment_id","purchase_order_id")
);
--> statement-breakpoint
CREATE TABLE "confirmation"."shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"nickname" text,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"box_count" integer,
	"piece_count" integer,
	"shipping_cost" numeric(12, 2),
	"shipping_cost_currency" text DEFAULT 'USD' NOT NULL,
	"eta_date" date,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"status" "confirmation"."shipment_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"supplier_code" text,
	"contact_person" text,
	"email" text,
	"phone" text,
	"website" text,
	"address" jsonb,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minimum_order_quantity" integer,
	"lead_time_weeks" integer,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "confirmation"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD CONSTRAINT "purchase_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "confirmation"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."shipment_purchase_orders" ADD CONSTRAINT "shipment_purchase_orders_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "confirmation"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."shipment_purchase_orders" ADD CONSTRAINT "shipment_purchase_orders_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "confirmation"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."shipments" ADD CONSTRAINT "shipments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "confirmation"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."shipments" ADD CONSTRAINT "shipments_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "po_revisions_po_rev_uq" ON "confirmation"."purchase_order_revisions" USING btree ("po_id","revision_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_order_idx" ON "confirmation"."purchase_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "confirmation"."purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "confirmation"."purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipment_pos_po_idx" ON "confirmation"."shipment_purchase_orders" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "shipments_supplier_idx" ON "confirmation"."shipments" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "confirmation"."shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "suppliers_active_idx" ON "confirmation"."suppliers" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_code_uq" ON "confirmation"."suppliers" USING btree ("supplier_code") WHERE "confirmation"."suppliers"."supplier_code" is not null;