/* 2026-11-26 - Login check for users who say "invalid email or password" with the correct password.
   READS ONLY. Changes nothing. Never shows a password or a password hash.
   Part A runs in the JobCardScanner database (dealer / workshop login accounts).
   Part B runs in the ERP database that holds dbo.AspNetUsers (the one BaplDmsService reads, "BAPLDMSvad").
   Put the e-mails of the users who complained in the list at the top of each part. */
SET NOCOUNT ON;

/* ===================== PART A - JobCardScanner database ===================== */
DECLARE @ids TABLE (LoginId NVARCHAR(200));
INSERT INTO @ids VALUES (N'amit.kumar@bgauss.com'), (N'piyush.jain@bgauss.com');   -- add the others here

/* A1. What does the DMS hold for each complaining user?  (one row per match) */
SELECT i.LoginId,
       u.Id, u.Email, CASE u.AuthType WHEN 1 THEN 'Local' WHEN 0 THEN 'AzureAd' END AS AuthType, u.Role, u.Active, u.MustChangePassword, u.LastLoginAt,
       CASE WHEN u.PasswordHash IS NULL THEN 'NO HASH'
            WHEN u.PasswordHash LIKE '[0-9]%.%.%' THEN 'hash ok' ELSE 'hash BAD FORMAT' END AS PasswordHashState,
       CASE WHEN u.Email <> LTRIM(RTRIM(u.Email)) THEN 'SPACE IN STORED EMAIL' ELSE '' END AS EmailSpaceCheck,
       CASE WHEN u.DealerId IS NULL THEN 'no dealer' ELSE 'dealer set' END AS DealerState
FROM @ids i
LEFT JOIN dbo.Users u ON LTRIM(RTRIM(LOWER(u.Email))) = LTRIM(RTRIM(LOWER(i.LoginId)))
ORDER BY i.LoginId;
/* How to read A1:
   - no row (Id is NULL)            -> no local account; the login then depends on the ERP check (Part B).
   - Active = 0                     -> the account is switched off. Before 26.11.2026 this showed as "Invalid email or password"; now it says "deactivated".
   - AuthType <> Local              -> a Microsoft (Azure AD) account; must use the "Staff (Microsoft)" tab.
   - hash BAD FORMAT / NO HASH      -> the local password can never match; reset it (Admin > Users > Edit > Password).
   - SPACE IN STORED EMAIL          -> the stored e-mail has a space; fixed by the 26.11.2026 code, or trim it in the table.
   - LastLoginAt long ago           -> never signed in since the change.  */

/* A2. Accounts that can never log in as typed (whole table) */
SELECT COUNT(*) AS LocalUsers,
       SUM(CASE WHEN Active = 0 THEN 1 ELSE 0 END) AS Inactive,
       SUM(CASE WHEN PasswordHash IS NULL THEN 1 ELSE 0 END) AS NoHash,
       SUM(CASE WHEN PasswordHash IS NOT NULL AND PasswordHash NOT LIKE '[0-9]%.%.%' THEN 1 ELSE 0 END) AS BadHashFormat,
       SUM(CASE WHEN Email <> LTRIM(RTRIM(Email)) THEN 1 ELSE 0 END) AS EmailWithSpace
FROM dbo.Users WHERE AuthType = 1;   -- 1 = Local (enum UserAuthType: AzureAd = 0, Local = 1)

/* A3. The same e-mail twice (case / space differences) - the login picks one of them */
SELECT LTRIM(RTRIM(LOWER(Email))) AS EmailKey, COUNT(*) AS Rows_
FROM dbo.Users GROUP BY LTRIM(RTRIM(LOWER(Email))) HAVING COUNT(*) > 1;

/* A4. Locations / Work Area of the complaining users (Delhi = CUS0288...) - only to see whether the Work Area column is empty or damaged */
SELECT u.Email, u.Active, u.WorkLocationCodes, ISJSON(u.WorkLocationCodes) AS WorkAreaIsJson
FROM @ids i JOIN dbo.Users u ON LTRIM(RTRIM(LOWER(u.Email))) = LTRIM(RTRIM(LOWER(i.LoginId)));

/* ===================== PART B - ERP database (dbo.AspNetUsers) - run separately in that database ===================== */
/*
DECLARE @ids2 TABLE (LoginId NVARCHAR(200));
INSERT INTO @ids2 VALUES (N'amit.kumar@bgauss.com'), (N'piyush.jain@bgauss.com');

SELECT i.LoginId, a.Id, a.Email, a.UserName, a.DealerCode,
       CASE WHEN a.PasswordHash IS NULL OR a.PasswordHash = '' THEN 'NO PASSWORD' ELSE 'password set' END AS PasswordState,
       a.LockoutEnabled, a.LockoutEnd, a.AccessFailedCount, a.EmailConfirmed
FROM @ids2 i
LEFT JOIN dbo.AspNetUsers a ON a.NormalizedEmail = UPPER(LTRIM(RTRIM(i.LoginId))) OR a.NormalizedUserName = UPPER(LTRIM(RTRIM(i.LoginId)));
-- no row           -> the person has no ERP login; only a local DMS account can work for them.
-- NO PASSWORD      -> the ERP login has no password; it can never pass.
-- DealerCode empty -> the DMS cannot decide which dealer the user belongs to (they get a "not linked to a dealer" message).
*/
