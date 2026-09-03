-- Adds Customer.PasswordHash (nvarchar(300), nullable), PasswordResetTokenHash (nvarchar(100),
-- nullable) and PasswordResetExpiresAt (datetime2, nullable) - needed for the new customer
-- password login (POST /api/portal/login), which runs alongside the existing OTP portal login
-- rather than replacing it. Same shape as Users.PasswordHash/PasswordResetTokenHash/
-- PasswordResetExpiresAt.
--
-- NOTE (2026-09-03): this migration is now applied AUTOMATICALLY on every backend startup, in
-- every environment - see the "SELF-HEALING COLUMN MIGRATIONS" block in Program.cs. You do not
-- need to run this script by hand against production; it's kept here only as human-readable
-- documentation of what changed and why (same as add-customer-state-column.sql and
-- add-part-suggestion-columns.sql, both now also self-healing). Safe to run manually too, if
-- you'd rather apply it ahead of a deploy/restart - each ALTER is guarded by an existence check.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordHash')
BEGIN
    ALTER TABLE [dbo].[Customers] ADD [PasswordHash] nvarchar(300) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordResetTokenHash')
BEGIN
    ALTER TABLE [dbo].[Customers] ADD [PasswordResetTokenHash] nvarchar(100) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordResetExpiresAt')
BEGIN
    ALTER TABLE [dbo].[Customers] ADD [PasswordResetExpiresAt] datetime2 NULL;
END
