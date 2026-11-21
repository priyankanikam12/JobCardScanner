/* 2026-11-21 - Confirm dbo.ZohoLocationMap from the Zoho Books location list (22 locations supplied by Sathwika, location ids as in the Zoho branch URLs).
   Maps 18 Zoho locations to their DMS sub-location code and sets Confirmed = 1.
   NOT mapped (left as they are, Confirmed = 0): Anna Nagar 3898946000000062230, Lado Sarai - RidEV 3898946000000062309, Dombivali - SFX 3898946000000062488 - no DMS code exists for them.
   CORRECTION: the old row  CUS0270 / CUS0270W2 -> 3898946000000062524  is wrong. Zoho 062524 is "Chennai (HUB)", which is CUS0270W1 in the DMS (W2 is Saligramam). It is changed to CUS0270W1.
   DMS codes with NO Zoho location yet (so not mappable): CUS0270W2 Saligramam, CUS0288W6 Dwarka, CUS0288W8 Noida, CUS0288W9 Gurgaon, CUS0316W2 Begur - Zoho must create them first.
   Changes only dbo.ZohoLocationMap, only the rows listed here. A copy of the table is kept first (dbo.ZohoLocationMap_bak_20261121), so it can be undone. Run in the JobCardScanner database. */
SET NOCOUNT ON;

IF OBJECT_ID('dbo.ZohoLocationMap_bak_20261121') IS NULL SELECT * INTO dbo.ZohoLocationMap_bak_20261121 FROM dbo.ZohoLocationMap;

DECLARE @m TABLE (ZohoLocationId VARCHAR(40) PRIMARY KEY, DealerCode VARCHAR(20), SubLocation VARCHAR(20), ZohoName NVARCHAR(80));
INSERT INTO @m VALUES
 ('3898946000000032107','CUS0288','CUS0288W1',N'Delhi (Hub)'),
 ('3898946000000062008','CUS0288','CUS0288W5',N'Lado Sarai - Zomato'),
 ('3898946000000062092','CUS0288','CUS0288W4',N'Lawrence Road - Zomato'),
 ('3898946000000062131','CUS0288','CUS0288W3',N'Uttam Nagar - Zomato'),
 ('3898946000000062164','CUS0288','CUS0288W2',N'Okhla - Zomato'),
 ('3898946000000062197','CUS0288','CUS0288W7',N'Chhatarpur - Zomato'),
 ('3898946000000062266','CUS0213','CUS0213W1',N'Ahmedabad (HUB)'),
 ('3898946000000062345','CUS0209','CUS0209W1',N'Rajkot (HUB)'),
 ('3898946000000062381','CUS0347','CUS0347W1',N'Pune (HUB)'),
 ('3898946000000062420','CUS0460','CUS0460W1',N'Dombivali (HUB)'),
 ('3898946000000062453','CUS0460','CUS0460W2',N'Mira Bhayandar - SFX'),
 ('3898946000000062524','CUS0270','CUS0270W1',N'Chennai (HUB)'),
 ('3898946000000062593','CUS0270','CUS0270W3',N'Chrompet - SFX'),
 ('3898946000000062560','CUS0316','CUS0316W1',N'Bangalore (HUB)'),
 ('3898946000000062626','CUS0316','CUS0316W3',N'E City (Hebbal) - SFX'),
 ('3898946000000062662','CUS0260','CUS0260W1',N'Hyderabad (HUB)'),
 ('3898946000000062695','CUS0260','CUS0260W2',N'Gachibowli - SFX'),
 ('3898946000000062728','CUS0260','CUS0260W3',N'Nagole - RidEV');

-- every id must already exist in the map (the 21 rows were loaded earlier); stop if one does not
IF EXISTS (SELECT 1 FROM @m m WHERE NOT EXISTS (SELECT 1 FROM dbo.ZohoLocationMap z WHERE z.ZohoLocationId = m.ZohoLocationId))
BEGIN
    SELECT m.ZohoLocationId, m.ZohoName AS missing_in_map FROM @m m WHERE NOT EXISTS (SELECT 1 FROM dbo.ZohoLocationMap z WHERE z.ZohoLocationId = m.ZohoLocationId);
    RAISERROR('Some location ids are not in dbo.ZohoLocationMap - nothing changed. Send me the list above.', 16, 1);
    RETURN;
END

-- before
SELECT z.ZohoLocationId, m.ZohoName, z.DealerCode AS old_dealer, z.SubLocation AS old_sub, z.Confirmed AS old_confirmed, m.DealerCode AS new_dealer, m.SubLocation AS new_sub
FROM dbo.ZohoLocationMap z JOIN @m m ON m.ZohoLocationId = z.ZohoLocationId ORDER BY m.SubLocation;

UPDATE z SET z.DealerCode = m.DealerCode, z.SubLocation = m.SubLocation, z.Confirmed = 1
FROM dbo.ZohoLocationMap z JOIN @m m ON m.ZohoLocationId = z.ZohoLocationId;

-- after: the full map
SELECT ZohoLocationId, DealerCode, SubLocation, Confirmed FROM dbo.ZohoLocationMap ORDER BY Confirmed DESC, DealerCode, SubLocation;

/* UNDO:  UPDATE z SET z.DealerCode = b.DealerCode, z.SubLocation = b.SubLocation, z.Confirmed = b.Confirmed
          FROM dbo.ZohoLocationMap z JOIN dbo.ZohoLocationMap_bak_20261121 b ON b.ZohoLocationId = z.ZohoLocationId;  */
