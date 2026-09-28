-- reorder-invoice-generated-before-ready-for-delivery-v2.sql
-- 2026-10-01 - SUPERSEDES reorder-invoice-generated-before-ready-for-delivery.sql (v1)
--
-- WHY v1 DID NOTHING ("still shown why?"): v1 was written against the Seq values in
-- DbSeeder.cs's object-initializer code (invoice_generated=7, ready_for_delivery=6), because that
-- was the only source available at the time. Your own `SELECT * FROM WorkflowStages ORDER BY Seq
-- ASC` just now proved the REAL live table is different - it has an extra ACTIVE stage DbSeeder.cs
-- never mentions ("estimate_created", Seq=5, Active=1, added 2026-09-03 per its own CreatedAt),
-- which pushes everything below it up by one. In your live table today:
--   repair_completed    Seq=6
--   ready_for_delivery  Seq=7  Active=1
--   invoice_generated   Seq=8  Active=1  IsTerminal=1
-- v1's guarded UPDATEs (`... AND Seq = 7` for invoice_generated, `... AND Seq = 6` for
-- ready_for_delivery) never matched a single row against these real values, so both UPDATEs were
-- silent no-ops - which is exactly why the screenshot still showed the old order. This script
-- uses the REAL current values (8 and 7) instead.
--
-- FACT, not previously known: your WorkflowStages table also has ColorHex and CreatedAt columns
-- that weren't visible from DbSeeder.cs alone (it never sets ColorHex, and CreatedAt is presumably
-- a default). Flagging this because it's relevant to the Workflow Stages admin CRUD feature - see
-- separate note in chat.
--
-- Same safety pattern as v1: wrapped in a transaction, does not auto-commit, keyed on the OLD Seq
-- value so re-running it after it's already applied is a no-op rather than swapping back and
-- forth. Only touches DealerId IS NULL (global template) rows - see v1's header comment for the
-- per-dealer-override caveat, still applicable.

BEGIN TRANSACTION;

-- 1) Current state - all active stages, in order, so you can see exactly what's about to change.
SELECT Id, DealerId, StageKey, Label, Seq, Icon, Active, IsTerminal
FROM dbo.WorkflowStages
WHERE DealerId IS NULL AND Active = 1
ORDER BY Seq;

-- 2) Swap the two Seq values using the REAL current values (8 and 7, not v1's assumed 7 and 6).
UPDATE dbo.WorkflowStages
SET Seq = 7
WHERE DealerId IS NULL AND StageKey = 'invoice_generated' AND Seq = 8;

UPDATE dbo.WorkflowStages
SET Seq = 8
WHERE DealerId IS NULL AND StageKey = 'ready_for_delivery' AND Seq = 7;

-- 3) Confirm before committing - invoice_generated should now read Seq=7, ready_for_delivery Seq=8.
SELECT Id, DealerId, StageKey, Label, Seq, Icon, Active, IsTerminal
FROM dbo.WorkflowStages
WHERE DealerId IS NULL AND Active = 1
ORDER BY Seq;

-- Review the two SELECTs above. If they look correct, run:
--   COMMIT TRANSACTION;
-- If anything looks wrong, run:
--   ROLLBACK TRANSACTION;
-- (left uncommitted here deliberately - this script does not auto-commit)
