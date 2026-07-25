ALTER TABLE "confirmation"."garment_types" ADD COLUMN "fabric_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."garments" ADD COLUMN "selected_fabrics" jsonb;--> statement-breakpoint
ALTER TABLE "confirmation"."size_charts" ADD COLUMN "sizes" jsonb DEFAULT '[]'::jsonb NOT NULL;