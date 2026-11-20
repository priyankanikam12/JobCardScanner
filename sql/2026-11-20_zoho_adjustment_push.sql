-- 2026-11-20 Zoho inventory adjustment push (source: dbo.PartUploads). Safe to re-run.
IF OBJECT_ID('dbo.ZohoAdjustmentPush') IS NULL
CREATE TABLE dbo.ZohoAdjustmentPush (
  ReferenceNumber NVARCHAR(60) NOT NULL PRIMARY KEY,
  LocationCode    NVARCHAR(30) NOT NULL,
  ZohoLocationId  NVARCHAR(40) NOT NULL,
  AdjustmentDate  VARCHAR(10)  NOT NULL,
  Status          NVARCHAR(20) NOT NULL,           -- Creating / Sent / Failed
  ZohoAdjustmentId NVARCHAR(40) NULL,
  LineCount       INT NOT NULL,
  NetQty          DECIMAL(14,2) NOT NULL,
  Detail          NVARCHAR(2000) NULL,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2 NULL);
IF OBJECT_ID('dbo.ZohoAdjustmentPushLine') IS NULL
CREATE TABLE dbo.ZohoAdjustmentPushLine (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  ReferenceNumber NVARCHAR(60) NOT NULL,
  PartUploadId    UNIQUEIDENTIFIER NOT NULL,
  PartNo          NVARCHAR(60) NOT NULL,
  QtyBefore       DECIMAL(14,2) NOT NULL,
  QtyAfter        DECIMAL(14,2) NOT NULL,
  Delta           DECIMAL(14,2) NOT NULL,
  Status          NVARCHAR(20) NOT NULL,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ZohoAdjustmentPushLine_Part')
CREATE INDEX IX_ZohoAdjustmentPushLine_Part ON dbo.ZohoAdjustmentPushLine (PartUploadId, Status, CreatedAt);
