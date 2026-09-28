-- reorder-invoice-generated-before-ready-for-delivery.sql
-- 2026-10-01 ("in Workflow Timeline after Repair Completed shift Invoice Generated after this
-- Ready for Delivery")
--
-- DbSeeder.cs's SeedAsync only runs ONCE, against a brand-new empty database (it early-returns if
-- any Dealer already exists) - so editing that file's stage order does NOT change an
-- already-provisioned database's real WorkflowStages rows. This script is the same kind of direct
-- Seq update redefine-workflow-stages-to-7-steps.sql already used for your live database, scoped
-- to just these two stages.
--
-- BEFORE running: this only touches the default template rows (DealerId IS NULL, per
-- DbSeeder.cs's own "DealerId = null => applies to all dealers" comment). If any dealer has its
-- own per-dealer override rows for these two stage keys, run the same two UPDATEs again with
-- `AND DealerId = '<that dealer's id>'` for those rows too - check first:
--   SELECT Id, DealerId, StageKey, Seq, IsTerminal FROM dbo.WorkflowStages
--   WHERE StageKey IN ('invoice_generated', 'ready_for_delivery') ORDER BY DealerId, Seq;
--
-- FLAGGED - same real-behavior caveat as DbSeeder.cs's own doc comment: Invoice Generated stays
-- the TERMINAL stage (IsTerminal is NOT changed by this script) - reaching it still closes the
-- job card immediately. After this reorder, Ready for Delivery sits AFTER the terminal stage, so
-- in normal use a job card is already closed by the time it would reach Ready for Delivery. This
-- was your explicit choice ("Keep Invoice Generated terminal, reorder anyway") over moving the
-- terminal flag to Ready for Delivery - just confirming the SQL matches that choice exactly.
--
-- Run inside a transaction so you can roll back if the before/after SELECTs don't look right.

BEGIN TRANSACTION;

-- 1) See current state first.
SELECT Id, DealerId, StageKey, Label, Seq, IsTerminal
FROM dbo.WorkflowStages
WHERE StageKey IN ('invoice_generated', 'ready_for_delivery')
ORDER BY DealerId, Seq;

-- 2) Swap the two Seq values for the default (DealerId IS NULL) template rows.
--    invoice_generated moves from 7 -> 6, ready_for_delivery moves from 6 -> 7.
--    Written as explicit WHERE Seq = <old value> guards (not just WHERE StageKey = ...) so this
--    is safe to re-run: if it's already been applied, neither UPDATE matches anything the second
--    time, instead of silently swapping them back and forth.
UPDATE dbo.WorkflowStages
SET Seq = 6
WHERE DealerId IS NULL AND StageKey = 'invoice_generated' AND Seq = 7;

UPDATE dbo.WorkflowStages
SET Seq = 7
WHERE DealerId IS NULL AND StageKey = 'ready_for_delivery' AND Seq = 6;

-- 3) Confirm the new state looks right before committing.
SELECT Id, DealerId, StageKey, Label, Seq, IsTerminal
FROM dbo.WorkflowStages
WHERE StageKey IN ('invoice_generated', 'ready_for_delivery')
ORDER BY DealerId, Seq;

-- Review the two SELECTs above. If they look correct, run:
--   COMMIT TRANSACTION;
-- If anything looks wrong, run:
--   ROLLBACK TRANSACTION;
-- (left uncommitted here deliberately - this script does not auto-commit)
