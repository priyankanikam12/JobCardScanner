/* 2026-11-21 - Where can the customers' GSTIN come from for the Zoho invoice push?
   FACT: dbo.Customers (the job-card customer) has NO GSTIN column; the GSTIN is only in dbo.LedgerMasters.Gstno (Dealer / Company / Insurance / Party ledgers).
   This lists the customers of the Billed bills still waiting to be sent, and whether a ledger with a GSTIN matches them by NAME or by MOBILE (a match is a candidate, not proof - review it).
   Reads only. Changes nothing. Run in the JobCardScanner database. */
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#cust') IS NOT NULL DROP TABLE #cust;
SELECT UPPER(LTRIM(RTRIM(c.Name))) AS CustName, LTRIM(RTRIM(ISNULL(c.Mobile, N''))) AS Mobile, COUNT(*) AS WaitingBills
INTO #cust
FROM dbo.RepairBillDocs r
JOIN dbo.JobCards j ON j.Id = r.JobCardId
JOIN dbo.Customers c ON c.Id = j.CustomerId
WHERE r.IsDeleted = 0 AND r.Status = 'Billed'
  AND NOT EXISTS (SELECT 1 FROM dbo.ZohoInvoicePush p WHERE p.BillId = r.Id AND p.Status = 'Sent')
GROUP BY UPPER(LTRIM(RTRIM(c.Name))), LTRIM(RTRIM(ISNULL(c.Mobile, N'')));

/* 1. summary */
SELECT COUNT(*) AS customers_on_waiting_bills,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM dbo.LedgerMasters l WHERE l.IsActive = 1 AND NULLIF(LTRIM(RTRIM(l.Gstno)), N'') IS NOT NULL
                              AND (UPPER(LTRIM(RTRIM(l.LedgerName))) = k.CustName OR (k.Mobile <> N'' AND l.MobileNumber = k.Mobile))) THEN 1 ELSE 0 END) AS with_a_ledger_gstin_candidate
FROM #cust k;

/* 2. the candidates (review each: same name / same mobile does not always mean the same party) */
SELECT k.CustName, k.Mobile, k.WaitingBills, l.LedgerCode, l.LedgerName, l.Gstno,
       CASE WHEN UPPER(LTRIM(RTRIM(l.LedgerName))) = k.CustName THEN 'name' ELSE 'mobile' END AS matched_by
FROM #cust k
JOIN dbo.LedgerMasters l ON l.IsActive = 1 AND NULLIF(LTRIM(RTRIM(l.Gstno)), N'') IS NOT NULL
 AND (UPPER(LTRIM(RTRIM(l.LedgerName))) = k.CustName OR (k.Mobile <> N'' AND l.MobileNumber = k.Mobile))
ORDER BY k.WaitingBills DESC, k.CustName;

/* 3. customers that look like businesses but have no candidate GSTIN (Finance to supply) */
SELECT k.CustName, k.Mobile, k.WaitingBills
FROM #cust k
WHERE (k.CustName LIKE '%PVT%' OR k.CustName LIKE '%PRIVATE%' OR k.CustName LIKE '%LIMITED%' OR k.CustName LIKE '%LTD%' OR k.CustName LIKE '%LLP%' OR k.CustName LIKE '%ENTERPRISE%' OR k.CustName LIKE '%MOTORS%' OR k.CustName LIKE '%TRADERS%' OR k.CustName LIKE '%SERVICES%')
  AND NOT EXISTS (SELECT 1 FROM dbo.LedgerMasters l WHERE l.IsActive = 1 AND NULLIF(LTRIM(RTRIM(l.Gstno)), N'') IS NOT NULL
                  AND (UPPER(LTRIM(RTRIM(l.LedgerName))) = k.CustName OR (k.Mobile <> N'' AND l.MobileNumber = k.Mobile)))
ORDER BY k.WaitingBills DESC;

DROP TABLE #cust;
