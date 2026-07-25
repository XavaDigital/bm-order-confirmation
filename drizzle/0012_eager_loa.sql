CREATE TABLE "confirmation"."order_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_kind" text NOT NULL,
	"author_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "hub_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "hub_customer_name" text;--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD CONSTRAINT "order_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "confirmation"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_notes_order_idx" ON "confirmation"."order_notes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_hub_customer_idx" ON "confirmation"."orders" USING btree ("hub_customer_id");