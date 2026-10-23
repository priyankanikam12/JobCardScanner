-- 17.10.2026 - READ-ONLY checks (SELECT only, nothing is changed) for what the Securepoint test of 14-16.10.2026 may have left in the live JobCardScanner database.
-- The report says test data was "reverted or flagged for removal" - verify, do not assume. Run in SSMS on the JobCardScanner database; review each result; delete only what you confirm is test data.
-- Table / column names follow this project's own startup SQL; if a column name differs on your server the query says so - adjust it.
USE [JobCardScanner];
GO
-- DMS-01 / DMS-05: every corporate-level login. Anyone you do not recognise, or created 14-16.10.2026, must be disabled and investigated.
SELECT * FROM dbo.Users WHERE CAST([Role] AS nvarchar(40)) IN (N'SystemAdmin', N'CorporateAdmin');
GO
-- DMS-10: workflow stages injected from a low-privilege login (look for unknown StageKey / Label, newest first).
SELECT TOP 30 * FROM dbo.WorkflowStages ORDER BY CreatedAt DESC;
GO
-- DMS-09: entries added to the company-wide service catalogue and battery-warranty schemes.
SELECT TOP 30 * FROM dbo.ServiceMenuMasters ORDER BY CreatedAt DESC;
SELECT TOP 30 * FROM dbo.ExtendedBatteryWarrantySchemes ORDER BY CreatedAt DESC;
GO
-- DMS-08: bill lines with a negative or absurd price / quantity / GST.
SELECT TOP 100 * FROM dbo.RepairBillDocItems WHERE Rate < 0 OR Qty <= 0 OR Qty > 10000 OR Rate > 10000000 OR CgstPct > 20 OR SgstPct > 20 OR IgstPct > 40;
GO
-- DMS-08: job-card suggestion lines with a negative or absurd rate / quantity.
SELECT TOP 100 * FROM dbo.JobCardLabourSuggestions WHERE RateAtSuggestion < 0 OR Quantity <= 0 OR Quantity > 10000;
SELECT TOP 100 * FROM dbo.JobCardPartSuggestions   WHERE Mrp < 0 OR Quantity <= 0 OR Quantity > 10000;
GO
-- DMS-04: the registration-number override table (a registration changed from a workshop login).
SELECT TOP 50 * FROM dbo.VehicleSaleOverrides ORDER BY 1 DESC;
GO
-- Also on the SERVER (not in SQL): files uploaded during the test that are not photos or videos, e.g. poc.png.html:
--   Get-ChildItem <site>\wwwroot\uploads -Recurse -File | Where-Object { $_.Extension -notmatch '^\.(jpg|jpeg|png|gif|webp|heic|heif|mp4|mov|webm|3gp|avi)$' } | Select FullName, Length, LastWriteTime
-- Remove only what is listed there and is confirmed test data (the application now refuses to serve such files in any case).
