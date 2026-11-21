/* 2026-11-21 - DMS sub-location codes for Sathwika's location list (Locations_magnemite.xlsx).
   Reads only. Run in the JobCardScanner database. Send the result grid (Save Results As CSV) back; she fills the "DMS Sub-location Code" field in Zoho from it.
   Part 1: every DMS sub-location (dbo.WorkshopLocations) with its dealer - find the Magnemite outlets here and put the code next to each name in her sheet.
   Part 2: what is already mapped to Zoho (dbo.ZohoLocationMap), so nothing is mapped twice.
   Part 3: sub-locations with stock or bills in DMS but not Confirmed in the map (the ones still missing, e.g. CUS0288W2..W9). */
SET NOCOUNT ON;

SELECT w.LocCode AS [DMS sub-location code], w.LocName AS [DMS location name], d.BaplDmsDealerCode AS [DMS dealer code], d.Name AS [Dealer name], w.IsActive
FROM dbo.WorkshopLocations w JOIN dbo.Dealers d ON d.Id = w.DealerId
WHERE d.BaplDmsDealerCode IN ('CUS0288', 'CUS0270', 'CUS0460')   -- Magnemite dealer codes seen so far; add others if the sheet needs them
ORDER BY d.BaplDmsDealerCode, w.LocCode;

SELECT ZohoLocationId, DealerCode, SubLocation, Confirmed FROM dbo.ZohoLocationMap ORDER BY DealerCode, SubLocation;

SELECT DISTINCT p.LocationCode AS [sub-location with stock], d.BaplDmsDealerCode AS [dealer]
FROM dbo.PartUploads p JOIN dbo.Dealers d ON d.Id = p.DealerId
WHERE p.LocationCode IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.ZohoLocationMap m WHERE m.Confirmed = 1 AND m.SubLocation = p.LocationCode)
ORDER BY d.BaplDmsDealerCode, p.LocationCode;
