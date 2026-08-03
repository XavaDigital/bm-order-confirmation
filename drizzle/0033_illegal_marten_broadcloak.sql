CREATE TABLE "confirmation"."roster_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "roster_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "roster_password" text;--> statement-breakpoint
ALTER TABLE "confirmation"."roster_members" ADD COLUMN "guest_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."roster_guests" ADD CONSTRAINT "roster_guests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_guests_order_idx" ON "confirmation"."roster_guests" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_guests_order_email_uq" ON "confirmation"."roster_guests" USING btree ("order_id","email");--> statement-breakpoint
ALTER TABLE "confirmation"."roster_members" ADD CONSTRAINT "roster_members_guest_id_roster_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "confirmation"."roster_guests"("id") ON DELETE set null ON UPDATE no action;