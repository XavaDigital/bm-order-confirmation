ALTER TABLE "confirmation"."garment_sizing" ADD COLUMN "custom_values" jsonb;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_types" ADD COLUMN "sizing_columns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."garments" ADD COLUMN "sizing_columns" jsonb DEFAULT '[]'::jsonb NOT NULL;