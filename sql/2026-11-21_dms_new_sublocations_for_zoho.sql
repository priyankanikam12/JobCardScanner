/* 2026-11-21 - DMS changes for the 3 Zoho locations that have NO DMS sub-location code yet.
   Zoho already has them: Anna Nagar (DEL-AN) 3898946000000062230, Lado Sarai - RidEV (DEL-RI) 3898946000000062309, Dombivali - SFX (DOM-DO) 3898946000000062488.
   The CODES BELOW ARE PROPOSED (next free number under the dealer) - CONFIRM them first, and CONFIRM the ERP has the same code (the ERP location master is where job cards take the location from).
   Run in the JobCardScanner database. Part 1 checks the codes are free; Part 2 adds them (remove the comment marks after you have confirmed the codes); Part 3 maps them to Zoho.
   Changes only dbo.WorkshopLocations (3 new rows) and dbo.ZohoLocationMap (3 rows). Back up first: SELECT * INTO dbo.WorkshopLocations_bak_20261121 FROM dbo.WorkshopLocations; */
SET NOCOUNT ON;

/* Part 1 - are the proposed codes free? (must return no rows) */
SELECT LocCode, LocName FROM dbo.WorkshopLocations WHERE LocCode IN ('CUS0288W10', 'CUS0288W11', 'CUS0460W3');

/* Part 2 - add the DMS sub-locations (dealer ids from dbo.Dealers: CUS0288 = 38CBC463-..., CUS0460 = 03A5A0F3-...)
-- IF OBJECT_ID('dbo.WorkshopLocations_bak_20261121') IS NULL SELECT * INTO dbo.WorkshopLocations_bak_20261121 FROM dbo.WorkshopLocations;
-- INSERT INTO dbo.WorkshopLocations (DealerId, LocCode, LocName, IsActive, Source, CreatedAt) VALUES
--  ('38CBC463-A9A5-482F-9D63-C13CB44307CE', 'CUS0288W10', 'MAGNEMITE MOTO LLP-DELHI ANNA NAGAR',           1, 'Manual', SYSUTCDATETIME()),
--  ('38CBC463-A9A5-482F-9D63-C13CB44307CE', 'CUS0288W11', 'MAGNEMITE MOTO LLP-DELHI LADO SARAI RIDEV',     1, 'Manual', SYSUTCDATETIME()),
--  ('03A5A0F3-BA63-4539-9DE9-091CD2049DF5', 'CUS0460W3',  'MAGNEMITE MOTO LLP-DOMBIVLI SFX DOMBIVLI',      1, 'Manual', SYSUTCDATETIME());
*/

/* Part 3 - map them to the Zoho locations (the 3 rows exist in dbo.ZohoLocationMap with Confirmed = 0)
-- UPDATE dbo.ZohoLocationMap SET DealerCode = 'CUS0288', SubLocation = 'CUS0288W10', Confirmed = 1 WHERE ZohoLocationId = '3898946000000062230';
-- UPDATE dbo.ZohoLocationMap SET DealerCode = 'CUS0288', SubLocation = 'CUS0288W11', Confirmed = 1 WHERE ZohoLocationId = '3898946000000062309';
-- UPDATE dbo.ZohoLocationMap SET DealerCode = 'CUS0460', SubLocation = 'CUS0460W3',  Confirmed = 1 WHERE ZohoLocationId = '3898946000000062488';
*/

SELECT ZohoLocationId, DealerCode, SubLocation, Confirmed FROM dbo.ZohoLocationMap WHERE ZohoLocationId IN ('3898946000000062230', '3898946000000062309', '3898946000000062488');
