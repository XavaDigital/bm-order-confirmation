-- Sidestep for workflow stage tasks (order board), merged from
-- workflow-stage-cluster. Renumbered from 0046 on merge: 0046_sharp_red_hulk
-- (the PO awaiting-approval flag) was already applied in production.
-- IF NOT EXISTS throughout because parts of this branch's schema have reached
-- production outside the deploy pipeline before (see 0042-0044).
ALTER TABLE "confirmation"."workflow_stage_tasks" ADD COLUMN IF NOT EXISTS "allow_sidestep" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."workflow_task_completions" ADD COLUMN IF NOT EXISTS "sidestepped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation"."workflow_task_completions" ADD COLUMN IF NOT EXISTS "sidestep_reason" text;--> statement-breakpoint
-- Hand-added: "Colour sample dispatched" (0020_lazy_spitfire.sql) is the
-- motivating case for sidestep — it only applies when the customer asked for
-- a colour sample.
UPDATE "confirmation"."workflow_stage_tasks" SET "allow_sidestep" = true WHERE "slug" = 'colour_sample_dispatched';
