-- Starter automation rules (David, 2026-08-06). Seeded ONLY into an empty
-- table, so this never disturbs a set someone has already built — and a
-- re-run is a no-op.
--
-- The notify rules make David's approval hand-offs visible: the factory
-- uploads their work for a phase, and the team is told rather than having to
-- notice. The one status-moving rule ships PAUSED — an automation that moves
-- a purchase order should be switched on deliberately, after its sentence has
-- been read on the Automations screen, not arrive already driving.
INSERT INTO "confirmation"."automation_rules"
  ("name","trigger","trigger_config","action","action_config","is_active")
SELECT * FROM (VALUES
  (
    'Layout uploaded — ready for our approval',
    'po_file_uploaded',
    '{"category":"Layout"}'::jsonb,
    'notify',
    '{"recipients":["po_creator","admin"],"title":"A layout was uploaded for approval"}'::jsonb,
    true
  ),
  (
    'Test print uploaded — ready for our approval',
    'po_file_uploaded',
    '{"category":"Test print"}'::jsonb,
    'notify',
    '{"recipients":["po_creator","admin"],"title":"A test print was uploaded for approval"}'::jsonb,
    true
  ),
  (
    'Production layout uploaded — ready for our approval',
    'po_file_uploaded',
    '{"category":"Production layout"}'::jsonb,
    'notify',
    '{"recipients":["po_creator","admin"],"title":"A production layout was uploaded for approval"}'::jsonb,
    true
  ),
  (
    'Pre-send checklist complete — the PO can go',
    'po_checklist_complete',
    '{}'::jsonb,
    'notify',
    '{"recipients":["po_creator","admin"],"title":"Every pre-send check is done — this purchase order can be sent"}'::jsonb,
    true
  ),
  (
    'Shipped — tell the supplier we have it in hand',
    'po_status_changed',
    '{"to":"in_transit"}'::jsonb,
    'notify',
    '{"recipients":["po_creator","supplier"],"title":"Shipping confirmed — thank you, we will confirm receipt on arrival"}'::jsonb,
    true
  ),
  (
    '(paused) Checklist complete — move the PO to Review',
    'po_checklist_complete',
    '{}'::jsonb,
    'set_status',
    '{"status":"approved"}'::jsonb,
    false
  )
) AS seed("name","trigger","trigger_config","action","action_config","is_active")
WHERE NOT EXISTS (SELECT 1 FROM "confirmation"."automation_rules");
