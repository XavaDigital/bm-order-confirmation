-- Production-order detail: per-line quantity, and font/design files that know
-- what they are for and can be uploaded as well as linked.
--
-- Additive. Dropping NOT NULL on order_assets.url relaxes a constraint rather
-- than removing anything, and is what makes room for an uploaded file, which
-- has a storage key instead of an external URL.
--
-- garment_sizing.quantity defaults to 1 so every existing row backfills to its
-- current meaning: before this column, one row was one garment.
ALTER TABLE "confirmation"."order_assets" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."garment_sizing" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."order_assets" ADD COLUMN "usage" text;--> statement-breakpoint
ALTER TABLE "confirmation"."order_assets" ADD COLUMN "storage_key" text;--> statement-breakpoint

-- Hand-added: drizzle-kit does not emit check constraints, so this is not in
-- the generated diff and must not be removed by a later regeneration.
-- An asset is a link OR an upload; a row that is neither is unreachable, and
-- one that is both has two sources of truth for the same file.
ALTER TABLE "confirmation"."order_assets"
  ADD CONSTRAINT "order_assets_url_xor_storage_key"
  CHECK (("url" IS NOT NULL) <> ("storage_key" IS NOT NULL));--> statement-breakpoint

-- Quantity is a count of garments to make: zero or negative is not a thing the
-- factory can act on, and would quietly corrupt every size total.
ALTER TABLE "confirmation"."garment_sizing"
  ADD CONSTRAINT "garment_sizing_quantity_positive" CHECK ("quantity" >= 1);
