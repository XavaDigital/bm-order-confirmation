ALTER TABLE "confirmation"."workflow_stage_tasks" ADD COLUMN "allow_sidestep" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."workflow_task_completions" ADD COLUMN "sidestepped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."workflow_task_completions" ADD COLUMN "sidestep_reason" text;--> statement-breakpoint
-- Hand-added: "Colour sample dispatched" (0020_lazy_spitfire.sql) is the
-- motivating case for sidestep — it only applies when the customer asked for
-- a colour sample.
UPDATE "confirmation"."workflow_stage_tasks" SET "allow_sidestep" = true WHERE "slug" = 'colour_sample_dispatched';