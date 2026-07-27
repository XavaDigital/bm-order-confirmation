ALTER TABLE "confirmation"."order_notes" ADD COLUMN "garment_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD COLUMN "body_html" text;--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD COLUMN "author_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD CONSTRAINT "order_notes_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "confirmation"."garments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD CONSTRAINT "order_notes_author_staff_user_id_staff_users_id_fk" FOREIGN KEY ("author_staff_user_id") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_notes_garment_idx" ON "confirmation"."order_notes" USING btree ("garment_id","created_at") WHERE "confirmation"."order_notes"."garment_id" is not null;--> statement-breakpoint
-- Hand-added backfill (drizzle-kit only generates schema DDL).
-- `updated_at` was added with DEFAULT now(), so every pre-existing note would
-- have updated_at > created_at and render as "(edited)" in the thread. Notes
-- written before this migration were never edited, so square the two.
UPDATE "confirmation"."order_notes" SET "updated_at" = "created_at";
