CREATE TABLE "confirmation"."order_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"garment_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"notes" text,
	"include_on_po" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "source_order_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "reprint_reason" text;--> statement-breakpoint
ALTER TABLE "confirmation"."order_assets" ADD CONSTRAINT "order_assets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."order_assets" ADD CONSTRAINT "order_assets_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "confirmation"."garments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."order_assets" ADD CONSTRAINT "order_assets_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_assets_order_idx" ON "confirmation"."order_assets" USING btree ("order_id","sort_order");--> statement-breakpoint
CREATE INDEX "order_assets_garment_idx" ON "confirmation"."order_assets" USING btree ("garment_id");--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD CONSTRAINT "orders_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "confirmation"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_source_order_idx" ON "confirmation"."orders" USING btree ("source_order_id") WHERE "confirmation"."orders"."source_order_id" is not null;