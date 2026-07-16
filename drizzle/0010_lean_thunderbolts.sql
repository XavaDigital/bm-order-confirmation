ALTER TYPE "confirmation"."event_status" ADD VALUE 'dead';--> statement-breakpoint
CREATE TABLE "confirmation"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation"."domain_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."domain_events" ADD COLUMN "next_attempt_at" timestamp with time zone;