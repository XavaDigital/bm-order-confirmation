-- Outbox processor scheduler — roadmap 3.2.
--
-- Decision: Supabase pg_cron + pg_net, not Vercel Cron or an external cron
-- service. The app is deliberately host-agnostic (PROJECT_BRIEF.md §2 — AWS
-- App Runner is the tentative app host, but "not locked"); the one fixed part
-- of the stack is the Postgres database on Supabase. Scheduling from inside
-- Supabase means the cron job's lifetime is tied to the DB, not to whichever
-- compute host the app happens to run on this month, and it needs no
-- app-host-specific config (no vercel.json, no host's own cron product).
--
-- One-time setup, run in the Supabase SQL Editor against the PRODUCTION
-- project (Database → Extensions: enable `pg_cron` and `pg_net` first):
--
--   1. Replace <APP_BASE_URL> below with the deployed app's APP_BASE_URL
--      env var value (e.g. https://orders.beastmode.example.com).
--   2. Replace <INTERNAL_API_KEY> with the deployed app's INTERNAL_API_KEY
--      env var value.
--   3. Run this whole file once in the SQL Editor.
--
-- This only needs to be run again if the job is dropped or the app URL / key
-- rotates. It is idempotent — cron.schedule() on an existing job name updates
-- it in place.

select cron.schedule(
  'process-outbox',
  '* * * * *', -- every minute; the processor itself batches (BATCH_SIZE=20 per run)
  $$
  select net.http_post(
    url := '<APP_BASE_URL>/api/internal/process-outbox',
    headers := jsonb_build_object('x-api-key', '<INTERNAL_API_KEY>'),
    body := '{}'::jsonb
  );
  $$
);

-- Verify it's running:
--   select * from cron.job_run_details order by start_time desc limit 10;
--
-- Remove it (e.g. before switching mechanisms):
--   select cron.unschedule('process-outbox');
