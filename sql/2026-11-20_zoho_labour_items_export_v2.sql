/* 2026-11-03 - Labour master in ZOHO BOOKS' ITEM IMPORT FORMAT (sample_items.csv from Sania Begum, Zoho Finance Consultant: 17 columns, labour = product type "service").
   Run this in the JobCardScanner database (the labour master tables were moved there; v2 of 20.11.2026: LabourMasterWithoutPartwise + LabourMasterPartwise). It makes ONE row per labour code, with the columns in Zoho's order. Then:
     Part A result  -> right-click the result grid > Save Results As... > CSV (the header row is included)  -> send to Zoho
     Part B results -> the checks that finance / Zoho must look at before the file is loaded
   If the table names differ, find them with:  SELECT name FROM sys.tables WHERE name LIKE '%Labour%'
   Reads only. Changes nothing. */
SET NOCOUNT ON;
DECLARE @DefaultSac VARCHAR(8) = NULL;          -- SAC for a labour code that was never billed (e.g. '998714'); leave NULL until Magnemite finance confirms it
DECLARE @AccountName NVARCHAR(100) = N'Sales'; -- the sales account NAME in Zoho Books (the sample file uses Sales)
DECLARE @Unit NVARCHAR(20) = N'pcs';            -- usage unit (the sample file uses pcs)

IF OBJECT_ID('tempdb..#items') IS NOT NULL DROP TABLE #items;

;WITH src AS (
    SELECT LTRIM(RTRIM(LabourCode)) AS LabourCode, NULLIF(LTRIM(RTRIM(JobDescription)), N'') AS JobDescription, LabourRate,
           CASE WHEN IGST > 0 AND IGST < 1 THEN IGST * 100 ELSE ISNULL(IGST, 0) END AS IgstPct,   /* the labour master keeps GST as a fraction: 0.09 = 9% */
           CASE WHEN CGST > 0 AND CGST < 1 THEN CGST * 100 ELSE ISNULL(CGST, 0) END AS CgstPct,
           CASE WHEN SGST > 0 AND SGST < 1 THEN SGST * 100 ELSE ISNULL(SGST, 0) END AS SgstPct,
           EffectiveDate, IsActive
    FROM dbo.LabourMasterWithoutPartwise WHERE NULLIF(LTRIM(RTRIM(LabourCode)), N'') IS NOT NULL
    UNION ALL
    SELECT LTRIM(RTRIM(LabourCode)), NULLIF(LTRIM(RTRIM(JobDescription)), N''), LabourRate,
           CASE WHEN IGST > 0 AND IGST < 1 THEN IGST * 100 ELSE ISNULL(IGST, 0) END,
           CASE WHEN CGST > 0 AND CGST < 1 THEN CGST * 100 ELSE ISNULL(CGST, 0) END,
           CASE WHEN SGST > 0 AND SGST < 1 THEN SGST * 100 ELSE ISNULL(SGST, 0) END,
           EffectiveDate, IsActive
    FROM dbo.LabourMasterPartwise WHERE NULLIF(LTRIM(RTRIM(LabourCode)), N'') IS NOT NULL
),
stats AS (   /* how many different rates a code has (per model / tier / effective date) - reported in Part B */
    SELECT UPPER(LabourCode) AS CodeKey, COUNT(*) AS master_rows, COUNT(DISTINCT LabourRate) AS different_rates FROM src GROUP BY UPPER(LabourCode)
),
pick AS (    /* the row that is current: active first, then the latest effective date, then the highest rate */
    SELECT *, ROW_NUMBER() OVER (PARTITION BY UPPER(LabourCode) ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END, EffectiveDate DESC, LabourRate DESC) AS rn FROM src
),
sac AS (     /* the SAC BGauss bills already carry for a labour code */
    SELECT UPPER(LTRIM(RTRIM(ItemCode))) AS CodeKey, MAX(LTRIM(RTRIM(HsnCode))) AS Sac
    FROM dbo.RepairBillDocItems
    WHERE ItemType = 'Labour' AND LEN(LTRIM(RTRIM(ISNULL(HsnCode, '')))) >= 4
    GROUP BY UPPER(LTRIM(RTRIM(ItemCode)))
)
SELECT p.LabourCode, COALESCE(p.JobDescription, p.LabourCode) AS BaseName, p.LabourRate, p.IsActive,
       ISNULL(s.Sac, @DefaultSac) AS Sac, CASE WHEN s.Sac IS NULL THEN 0 ELSE 1 END AS SacFromBills,
       CASE WHEN p.IgstPct > 0 THEN p.IgstPct ELSE p.CgstPct + p.SgstPct END AS GstPct,
       st.master_rows, st.different_rates
INTO #items
FROM pick p JOIN stats st ON st.CodeKey = UPPER(p.LabourCode) LEFT JOIN sac s ON s.CodeKey = UPPER(p.LabourCode)
WHERE p.rn = 1;

/* ===== PART A - the file for Zoho (17 columns, in the order of sample_items.csv) ===== */
SELECT
    CASE WHEN COUNT(*) OVER (PARTITION BY UPPER(BaseName)) > 1 THEN BaseName + N' (' + LabourCode + N')' ELSE BaseName END AS [Item Name],  /* Zoho allows each item name once */
    LabourCode                                     AS [SKU],
    Sac                                            AS [HSN/SAC],
    BaseName                                       AS [Description],
    CAST(ISNULL(LabourRate, 0) AS DECIMAL(18, 2))  AS [Rate],                                          /* excluding GST */
    'service'                                      AS [Product Type],
    @AccountName                                   AS [Account],
    @Unit                                          AS [Usage unit],
    CAST(NULL AS NVARCHAR(10))                     AS [Purchase Description],                           /* labour is sold, not purchased */
    CAST(NULL AS NVARCHAR(10))                     AS [Purchase Rate],
    CAST(NULL AS NVARCHAR(10))                     AS [Purchase Account],
    CASE WHEN IsActive = 1 THEN 'Active' ELSE 'Inactive' END AS [Status],
    CAST(NULL AS NVARCHAR(20))                     AS [Taxability Type],                                /* empty = taxable */
    CASE WHEN GstPct IN (0, 5, 12, 18, 28, 40) THEN CAST(CAST(GstPct AS INT) AS VARCHAR(5)) END          AS [Inter State Tax Rate],
    CASE WHEN GstPct IN (0, 5, 12, 18, 28, 40) THEN 'GST' + CAST(CAST(GstPct AS INT) AS VARCHAR(5)) END AS [Intra State Tax Name],
    CASE WHEN GstPct IN (0, 5, 12, 18, 28, 40) THEN 'Group' END                                          AS [Intra State Tax Type],
    CASE WHEN GstPct IN (0, 5, 12, 18, 28, 40) THEN CAST(CAST(GstPct AS INT) AS VARCHAR(5)) END          AS [Intra State Tax Rate]
FROM #items
ORDER BY LabourCode;

/* ===== PART B - checks before the file is loaded ===== */
SELECT COUNT(*) AS labour_codes,
       SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS active_codes,
       SUM(CASE WHEN Sac IS NULL THEN 1 ELSE 0 END) AS codes_without_sac,
       SUM(CASE WHEN GstPct NOT IN (0, 5, 12, 18, 28, 40) THEN 1 ELSE 0 END) AS codes_with_unusual_gst,
       SUM(CASE WHEN ISNULL(LabourRate, 0) = 0 THEN 1 ELSE 0 END) AS codes_with_rate_0,
       SUM(CASE WHEN different_rates > 1 THEN 1 ELSE 0 END) AS codes_with_more_than_one_rate
FROM #items;
SELECT TOP 200 LabourCode, BaseName AS description, Sac AS sac_if_known FROM #items WHERE Sac IS NULL ORDER BY LabourCode;                                   -- B2: codes with no SAC (finance to supply)
SELECT TOP 200 LabourCode, BaseName AS description, different_rates, master_rows, LabourRate AS rate_used FROM #items WHERE different_rates > 1 ORDER BY LabourCode;   -- B3: codes whose rate differs by model / tier / date
SELECT TOP 200 LabourCode, GstPct FROM #items WHERE GstPct NOT IN (0, 5, 12, 18, 28, 40) ORDER BY LabourCode;                                                  -- B4: GST rate Zoho does not know: tax columns are left empty
DROP TABLE #items;
