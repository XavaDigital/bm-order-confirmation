ALTER TABLE "confirmation"."staff_users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "confirmation"."staff_users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."staff_users" ADD COLUMN "totp_backup_codes" jsonb;