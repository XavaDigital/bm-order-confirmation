ALTER TABLE "confirmation"."purchase_orders" ADD COLUMN "awaiting_approval_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD COLUMN "awaiting_approval_by" text;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD COLUMN "awaiting_approval_note" text;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD COLUMN "awaiting_approval_status" text;