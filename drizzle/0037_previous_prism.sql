CREATE TABLE "confirmation"."garment_name_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"garment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"player_number" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."garments" ADD COLUMN "name_list_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."garments" ADD COLUMN "name_list_rows" integer;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_name_list_entries" ADD CONSTRAINT "garment_name_list_entries_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "confirmation"."garments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "garment_name_list_entries_garment_idx" ON "confirmation"."garment_name_list_entries" USING btree ("garment_id");