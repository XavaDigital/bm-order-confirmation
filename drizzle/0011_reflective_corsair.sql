CREATE TABLE "confirmation"."garment_type_size_chart_links" (
	"garment_type_id" uuid NOT NULL,
	"size_chart_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation"."garment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"fabric_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sizes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."garments" ADD COLUMN "garment_type_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."garments" ADD COLUMN "selected_options" jsonb;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_type_size_chart_links" ADD CONSTRAINT "garment_type_size_chart_links_garment_type_id_garment_types_id_fk" FOREIGN KEY ("garment_type_id") REFERENCES "confirmation"."garment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_type_size_chart_links" ADD CONSTRAINT "garment_type_size_chart_links_size_chart_id_size_charts_id_fk" FOREIGN KEY ("size_chart_id") REFERENCES "confirmation"."size_charts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garment_type_size_chart_uq" ON "confirmation"."garment_type_size_chart_links" USING btree ("garment_type_id","size_chart_id");--> statement-breakpoint
CREATE INDEX "garment_types_active_idx" ON "confirmation"."garment_types" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "confirmation"."garments" ADD CONSTRAINT "garments_garment_type_id_garment_types_id_fk" FOREIGN KEY ("garment_type_id") REFERENCES "confirmation"."garment_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "garments_type_idx" ON "confirmation"."garments" USING btree ("garment_type_id");