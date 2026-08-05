CREATE TABLE "confirmation"."po_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"category" text,
	"uploaded_by_kind" text NOT NULL,
	"uploaded_by_label" text,
	"status_at_upload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "confirmation"."supplier_color_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD COLUMN "po_file_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."orders" ADD COLUMN "names_uppercase" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD COLUMN "color_book_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD COLUMN "color_book_name" text;--> statement-breakpoint
ALTER TABLE "confirmation"."po_files" ADD CONSTRAINT "po_files_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "confirmation"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."supplier_color_books" ADD CONSTRAINT "supplier_color_books_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "confirmation"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."supplier_color_books" ADD CONSTRAINT "supplier_color_books_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "confirmation"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_files_po_idx" ON "confirmation"."po_files" USING btree ("po_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_color_books_supplier_idx" ON "confirmation"."supplier_color_books" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_color_books_supplier_name_uq" ON "confirmation"."supplier_color_books" USING btree ("supplier_id","name");--> statement-breakpoint
ALTER TABLE "confirmation"."order_notes" ADD CONSTRAINT "order_notes_po_file_id_po_files_id_fk" FOREIGN KEY ("po_file_id") REFERENCES "confirmation"."po_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation"."purchase_orders" ADD CONSTRAINT "purchase_orders_color_book_id_supplier_color_books_id_fk" FOREIGN KEY ("color_book_id") REFERENCES "confirmation"."supplier_color_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_notes_po_file_idx" ON "confirmation"."order_notes" USING btree ("po_file_id","created_at") WHERE "confirmation"."order_notes"."po_file_id" is not null;