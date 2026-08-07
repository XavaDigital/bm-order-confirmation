-- "Someone skipped a check — go and look" (David, 2026-08-07).
--
-- A sidestep is a deliberate, reasoned decision that a pre-production check
-- will not be done. That decision is allowed, but the person who made it is not
-- necessarily the person who should confirm it was safe — so when the job
-- reaches Production carrying one, the admins are told and can go and check.
--
-- Guarded on the rule's NAME, not on the table being empty (the way 0045 was):
-- production already has the 0045 starter set, so an empty-table guard would
-- never fire here. Re-running is a no-op, and a rule someone has since renamed,
-- retargeted or switched off is left exactly as they left it.
INSERT INTO "confirmation"."automation_rules"
  ("name","trigger","trigger_config","action","action_config","is_active")
SELECT * FROM (VALUES
  (
    'Skipped check reached production — please confirm it is okay',
    'po_status_changed',
    '{"to":"in_production","sidestepped":"yes"}'::jsonb,
    'notify',
    '{"recipients":["admin"],"title":"A skipped check reached production — please confirm this job is okay"}'::jsonb,
    true
  )
) AS seed("name","trigger","trigger_config","action","action_config","is_active")
WHERE NOT EXISTS (
  SELECT 1 FROM "confirmation"."automation_rules"
  WHERE "name" = 'Skipped check reached production — please confirm it is okay'
);
