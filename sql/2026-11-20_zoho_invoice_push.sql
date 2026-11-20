/* 2026-11-20 - Zoho Books invoice push: result table. Run once on JobCardScannerDb. Safe to run again. */
IF OBJECT_ID(N'dbo.ZohoInvoicePush') IS NULL
CREATE TABLE dbo.ZohoInvoicePush (
    BillId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ZohoInvoicePush PRIMARY KEY,   -- dbo.RepairBillDocs.Id
    BillNumber     NVARCHAR(60)     NOT NULL,
    Status         VARCHAR(12)      NOT NULL,     -- Sent / Created (draft in Zoho, not yet marked Sent) / Failed (dry runs are not stored)
    ZohoInvoiceId  NVARCHAR(40)     NULL,
    DmsTotal       DECIMAL(18,2)    NULL,
    ZohoTotal      DECIMAL(18,2)    NULL,
    Detail         NVARCHAR(2000)   NULL,
    UpdatedAt      DATETIME2        NOT NULL CONSTRAINT DF_ZohoInvoicePush_UpdatedAt DEFAULT SYSUTCDATETIME());
GO
IF OBJECT_ID(N'dbo.ZohoContactMap') IS NULL
CREATE TABLE dbo.ZohoContactMap (
    CanonicalCustomerId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ZohoContactMap PRIMARY KEY,
    ZohoContactId       NVARCHAR(40)     NOT NULL,
    CreatedAt           DATETIME2        NOT NULL CONSTRAINT DF_ZohoContactMap_CreatedAt DEFAULT SYSUTCDATETIME());
GO
