ALTER TABLE "confirmation"."staff_users" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."staff_users" ADD COLUMN "invite_token_hash" text;--> statement-breakpoint
ALTER TABLE "confirmation"."staff_users" ADD COLUMN "invite_token_expires_at" timestamp with time zone;