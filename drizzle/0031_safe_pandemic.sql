CREATE TABLE "confirmation"."acknowledgement_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acknowledgement_settings_key_unique" UNIQUE("key")
);--> statement-breakpoint
-- Data backfill (hand-edited, 0014/0019 pattern): seed the nine
-- acknowledgments that previously lived in code (AcknowledgmentPanel), so
-- the customer page keeps working from the first deploy. Titles are new
-- (David, 2026-08-03); bodies are the shipped wording verbatim.
INSERT INTO "confirmation"."acknowledgement_settings" ("key", "title", "body", "sort_order") VALUES
('color_accuracy', 'Colour accuracy', 'I understand that colours may not print exactly as they appear on the mock-ups or on my screen. Screens display colour using light (RGB) while printing uses inks/dyes (CMYK and material differences), so some variation is expected.', 0),
('color_matching', 'Colour matching', 'If I am highly concerned about exact colour matching, I understand I must request a colour book or send a physical sample for matching before production.', 1),
('mockup_correct', 'Mock-ups are correct', 'I confirm the mock-up(s) shown are correct.', 2),
('sizing_correct', 'Sizing, names and numbers', 'I confirm the sizing, names, and numbers are correct.', 3),
('size_charts_used', 'Size charts used', 'I confirm I used the provided size charts (not my own or legacy charts), because factory size standards differ from other brands.', 4),
('no_refunds', 'Refund policy', 'I understand that orders that are incorrect due to information I provided cannot be refunded. BeastMode takes responsibility only for manufacturing errors on our part.', 5),
('womens_unisex_sizing', 'Women''s and unisex sizing', 'I acknowledge the difference between women''s and unisex sizing and have accounted for it in my specifications.', 6),
('payment_terms', 'Payment terms', 'I agree to the payment terms and conditions associated with this order.', 7),
('authorised', 'Authority to confirm', 'I confirm that I am authorised to approve and confirm this order on behalf of my organisation.', 8);
