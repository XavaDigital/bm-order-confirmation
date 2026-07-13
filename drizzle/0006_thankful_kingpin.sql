CREATE TABLE "confirmation"."roster_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_access_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "confirmation"."roster_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"name" text NOT NULL,
	"player_number" text,
	"email" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."garment_sizing" ADD COLUMN "roster_member_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "roster_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confirmation"."roster_access" ADD CONSTRAINT "roster_access_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."roster_members" ADD CONSTRAINT "roster_members_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_access_order_idx" ON "confirmation"."roster_access" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "roster_members_order_idx" ON "confirmation"."roster_members" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "confirmation"."garment_sizing" ADD CONSTRAINT "garment_sizing_roster_member_id_roster_members_id_fk" FOREIGN KEY ("roster_member_id") REFERENCES "confirmation"."roster_members"("id") ON DELETE cascade ON UPDATE no action;