CREATE TABLE "confirmation"."po_supplier_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	CONSTRAINT "po_supplier_access_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "confirmation"."po_supplier_access" ADD CONSTRAINT "po_supplier_access_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "confirmation"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_supplier_access_po_idx" ON "confirmation"."po_supplier_access" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_supplier_access_one_active_uq" ON "confirmation"."po_supplier_access" USING btree ("purchase_order_id") WHERE "confirmation"."po_supplier_access"."revoked_at" is null;