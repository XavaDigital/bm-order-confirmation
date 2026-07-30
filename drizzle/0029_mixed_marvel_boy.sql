ALTER TABLE "confirmation"."orders" ADD COLUMN "hub_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "hub_contact_name" text;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "hub_order_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "design_project_ref" uuid;