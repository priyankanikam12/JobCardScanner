/* 2026-11-21 - dbo.ZohoCustomerGstin: the GSTIN of a customer for the Zoho invoice push.
   WHY: dbo.Customers (the job-card customer) has no GSTIN column and none of the customers on the waiting bills has a ledger with a GSTIN, so the invoice push created customers without gst_no.
   The invoice push now reads this table when it has to CREATE a customer in Zoho: a valid 15-character GSTIN is sent with gst_treatment = business_gst + gst_no. A customer with no row here is created as before.
   Finance (Kshitij Shekhar / Kundan Vijayvargia) supplies the values. A row with StateName set applies only when the customer's state is that state (GSTIN is per state for national companies); StateName NULL = any state.
   NOTE: a customer ALREADY created in Zoho is not updated by the integration - correct those contacts in Zoho by hand.
   Run in the JobCardScanner database. Part 1 creates the table (safe to run twice); Part 2 lists the customers to fill; Part 3 is the INSERT template (edit, then run); Part 4 checks the rows. */
SET NOCOUNT ON;

/* ===== Part 1 - the table ===== */
IF OBJECT_ID('dbo.ZohoCustomerGstin') IS NULL
CREATE TABLE dbo.ZohoCustomerGstin (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    CustomerKey  NVARCHAR(300) NOT NULL,         -- UPPER(TRIM(name)) + '|' + TRIM(mobile)  (same key as dbo.ZohoCustomerKeys)
    StateName    NVARCHAR(100) NULL,             -- the customer's State as stored in dbo.Customers, compared case-insensitively; NULL = any state
    Gstin        VARCHAR(15)   NOT NULL,
    Note         NVARCHAR(200) NULL,             -- who supplied it and when
    IsActive     BIT           NOT NULL DEFAULT 1,
    CreatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_ZohoCustomerGstin_Len CHECK (LEN(Gstin) = 15)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ZohoCustomerGstin_Key_State' AND object_id = OBJECT_ID('dbo.ZohoCustomerGstin'))
    CREATE UNIQUE INDEX UX_ZohoCustomerGstin_Key_State ON dbo.ZohoCustomerGstin (CustomerKey, StateName);

/* ===== Part 2 - the customers on the waiting bills, with the key and state to fill (Finance supplies the GSTIN) ===== */
SELECT UPPER(LTRIM(RTRIM(c.Name))) + N'|' + LTRIM(RTRIM(ISNULL(c.Mobile, N''))) AS CustomerKey,
       MAX(NULLIF(LTRIM(RTRIM(c.State)), N'')) AS StateName, COUNT(*) AS WaitingBills
FROM dbo.RepairBillDocs r
JOIN dbo.JobCards j ON j.Id = r.JobCardId
JOIN dbo.Customers c ON c.Id = j.CustomerId
WHERE r.IsDeleted = 0 AND r.Status = 'Billed'
  AND NOT EXISTS (SELECT 1 FROM dbo.ZohoInvoicePush p WHERE p.BillId = r.Id AND p.Status = 'Sent')
GROUP BY UPPER(LTRIM(RTRIM(c.Name))), LTRIM(RTRIM(ISNULL(c.Mobile, N'')))
ORDER BY WaitingBills DESC;

/* ===== Part 3 - INSERT template: copy CustomerKey and StateName from Part 2, put the GSTIN Finance gave. Remove the comment marks of a row only when its GSTIN is real. =====
-- INSERT INTO dbo.ZohoCustomerGstin (CustomerKey, StateName, Gstin, Note)
-- VALUES (N'ZOMATO LOCAL SERVICES PRIVATE LIMITED|8800786935', N'DELHI', '<15-character GSTIN from Finance>', N'Finance, 21.11.2026');
*/

/* ===== Part 4 - check: every row is 15 characters, the first 2 digits are a GST state code, and no row is a duplicate ===== */
SELECT CustomerKey, StateName, Gstin, LEFT(Gstin, 2) AS StateCodeInGstin, Note, IsActive FROM dbo.ZohoCustomerGstin ORDER BY CustomerKey, StateName;
