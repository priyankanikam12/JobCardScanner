/* 2026-11-21 - the 32 parts that the stock push (DMS-ADJ) found "not in Zoho Books". READ ONLY: changes nothing.
   Run in the JobCardScanner database. For each part it shows whether the item push CAN send it (same rules as ZohoPushStore.EnqueueItemsAsync) and, if not, the reason.
   Result 1 = one row per part. Result 2 = the comma list of the parts the item push will accept (paste it into  load-items?codes=...). */
SET NOCOUNT ON;
DECLARE @p TABLE (ItemCode VARCHAR(30) PRIMARY KEY);
INSERT INTO @p VALUES
('0301-A01-1025'),('0301-A01-1026'),('0301-A01-1029'),('0301-S01-1014'),('20B8030060AS'),('20B8030061AS'),('20B8030070AS'),('20B8030071AS'),
('20B8030080AS'),('20B8030090AS'),('20B8030091AS'),('20B8050050AS'),('20B8116006AS'),('20B8118026AS'),('20HW020020AS'),('22CX310190AS'),
('22DX020250AS'),('22DX070050AS'),('22DX340170AS'),('22DX350010AS'),('22DZ340070AS'),('22GE030010AS'),('22GE030020AS'),('22GE030070AS'),
('22GE320050AS'),('22GE320110AS'),('22GE340040AS'),('22SE510010AS'),('22SE510020AS'),('22SE540040AS'),('22VX090300AS'),('22VX330130AS');

SELECT p.ItemCode,
       CASE WHEN m.ItemCode IS NULL THEN 'NOT in C_ItemMaster (the item push has nothing to send - the part must be added to the item master first)'
            WHEN m.ProductMainGroupId <> 2 THEN 'ProductMainGroupId = ' + CAST(m.ProductMainGroupId AS VARCHAR(10)) + ' (the item push only sends group 2)'
            WHEN m.Status IS NOT NULL AND LTRIM(RTRIM(m.Status)) <> 'Y' THEN 'Status = ' + LTRIM(RTRIM(m.Status)) + ' (not continuing)'
            WHEN LTRIM(ISNULL(m.ItemName, '')) LIKE 'A2%' OR LTRIM(ISNULL(m.ItemName, '')) LIKE 'B8%' THEN 'item NAME starts with A2 / B8 (excluded by the item push)'
            WHEN LTRIM(RTRIM(ISNULL(m.ItemName, ''))) = '' THEN 'blank item name'
            WHEN ISNULL(m.Dlr_Price, 0) < 0 THEN 'negative dealer price'
            WHEN LTRIM(RTRIM(ISNULL(m.HSNCode, ''))) <> '' AND LEN(LTRIM(RTRIM(m.HSNCode))) NOT IN (4, 6, 8) THEN 'HSN length ' + CAST(LEN(LTRIM(RTRIM(m.HSNCode))) AS VARCHAR(5)) + ' (Zoho takes 4, 6 or 8 digits)'
            WHEN m.IGST NOT IN (0, 5, 12, 18, 28, 40) OR m.IGST IS NULL THEN 'IGST ' + ISNULL(CAST(m.IGST AS VARCHAR(20)), 'NULL') + ' is not an allowed GST rate'
            WHEN m.SGST <> m.IGST / 2 OR m.CGST <> m.IGST / 2 THEN 'CGST / SGST are not half of IGST'
            ELSE 'OK - the item push can send it' END AS Result,
       m.ItemName, m.HSNCode, m.Dlr_Price, m.IGST, m.CGST, m.SGST, m.ProductMainGroupId, m.Status,
       (SELECT TOP 1 o.Status FROM dbo.ZohoPushOutbox o WHERE o.EntityType = 'Item' AND o.EntityKey = p.ItemCode ORDER BY o.Id DESC) AS LastOutboxStatus,
       (SELECT TOP 1 LEFT(o.LastError, 200) FROM dbo.ZohoPushOutbox o WHERE o.EntityType = 'Item' AND o.EntityKey = p.ItemCode ORDER BY o.Id DESC) AS LastOutboxError
FROM @p p LEFT JOIN dbo.C_ItemMaster m ON m.ItemCode = p.ItemCode
ORDER BY CASE WHEN m.ItemCode IS NULL THEN 0 ELSE 1 END, p.ItemCode;

SELECT STUFF((SELECT ',' + m.ItemCode FROM @p p JOIN dbo.C_ItemMaster m ON m.ItemCode = p.ItemCode
              WHERE m.ProductMainGroupId = 2 AND (m.Status IS NULL OR LTRIM(RTRIM(m.Status)) = 'Y')
                AND NOT (LTRIM(ISNULL(m.ItemName, '')) LIKE 'A2%' OR LTRIM(ISNULL(m.ItemName, '')) LIKE 'B8%')
                AND ISNULL(m.Dlr_Price, 0) >= 0 AND (LTRIM(RTRIM(ISNULL(m.HSNCode, ''))) = '' OR LEN(LTRIM(RTRIM(m.HSNCode))) IN (4, 6, 8))
                AND LTRIM(RTRIM(ISNULL(m.ItemName, ''))) <> '' AND m.IGST IN (0, 5, 12, 18, 28, 40) AND m.SGST = m.IGST / 2 AND m.CGST = m.IGST / 2
              ORDER BY m.ItemCode FOR XML PATH('')), 1, 1, '') AS codes_for_load_items;
