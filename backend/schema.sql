-- ============================================================================
-- JobCardScanner - SQL Server schema (fallback / reference)
--
-- The backend creates this schema automatically at first run via EF Core's
-- Database.EnsureCreatedAsync() (see Program.cs) - you do NOT need to run this
-- file for normal local development. It is provided as a human-readable
-- reference of the data model, and as a fallback if you want to create the
-- database by hand (e.g. to hand off to a DBA, or to review before granting
-- the app's login CREATE TABLE rights).
--
-- Run against an empty database, e.g.:
--   sqlcmd -S localhost,1433 -U sa -P "YourStrong!Passw0rd" -Q "CREATE DATABASE JobCardScanner"
--   sqlcmd -S localhost,1433 -U sa -P "YourStrong!Passw0rd" -d JobCardScanner -i schema.sql
-- ============================================================================

CREATE TABLE Dealers (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    Code NVARCHAR(30) NOT NULL,
    Region NVARCHAR(100) NULL,
    State NVARCHAR(100) NULL,
    City NVARCHAR(100) NULL,
    Address NVARCHAR(300) NULL,
    Gstin NVARCHAR(30) NULL,
    Phone NVARCHAR(30) NULL,
    Email NVARCHAR(200) NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT UQ_Dealers_Code UNIQUE (Code)
);

CREATE TABLE Users (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    Email NVARCHAR(200) NOT NULL,
    Mobile NVARCHAR(30) NULL,
    Role NVARCHAR(30) NOT NULL,
    DealerId UNIQUEIDENTIFIER NULL,
    Active BIT NOT NULL DEFAULT 1,
    AvatarColor NVARCHAR(20) NULL,
    AzureAdObjectId NVARCHAR(100) NULL,
    CreatedAt DATETIME2 NOT NULL,
    LastLoginAt DATETIME2 NULL,
    CONSTRAINT UQ_Users_Email UNIQUE (Email),
    CONSTRAINT FK_Users_Dealers FOREIGN KEY (DealerId) REFERENCES Dealers(Id)
);
CREATE INDEX IX_Users_AzureAdObjectId ON Users(AzureAdObjectId);

CREATE TABLE Customers (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    Mobile NVARCHAR(30) NOT NULL,
    Email NVARCHAR(200) NULL,
    Address NVARCHAR(300) NULL,
    City NVARCHAR(100) NULL,
    DealerId UNIQUEIDENTIFIER NOT NULL,
    OutstandingAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    ErpCustomerId NVARCHAR(60) NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_Customers_Dealers FOREIGN KEY (DealerId) REFERENCES Dealers(Id)
);
CREATE INDEX IX_Customers_Mobile ON Customers(Mobile);

CREATE TABLE Vehicles (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    CustomerId UNIQUEIDENTIFIER NOT NULL,
    DealerId UNIQUEIDENTIFIER NOT NULL,
    Model NVARCHAR(100) NOT NULL,
    Variant NVARCHAR(60) NULL,
    Color NVARCHAR(40) NULL,
    RegNo NVARCHAR(30) NULL,
    Vin NVARCHAR(50) NULL,
    BatteryNo NVARCHAR(50) NULL,
    MotorNo NVARCHAR(50) NULL,
    SerialNo NVARCHAR(50) NULL,
    PurchaseDate DATE NULL,
    LastServiceDate DATE NULL,
    Odometer FLOAT NOT NULL DEFAULT 0,
    ErpVehicleId NVARCHAR(60) NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_Vehicles_Customers FOREIGN KEY (CustomerId) REFERENCES Customers(Id) ON DELETE CASCADE
);
CREATE INDEX IX_Vehicles_RegNo ON Vehicles(RegNo);
CREATE INDEX IX_Vehicles_Vin ON Vehicles(Vin);

CREATE TABLE Warranties (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    VehicleId UNIQUEIDENTIFIER NOT NULL,
    Status NVARCHAR(20) NOT NULL,
    StartDate DATE NULL,
    ExpiryDate DATE NULL,
    CoverageKm FLOAT NOT NULL DEFAULT 0,
    PartsCoveredJson NVARCHAR(MAX) NULL,
    LabourCovered BIT NOT NULL DEFAULT 1,
    BatteryWarrantyExpiry DATE NULL,
    MotorWarrantyExpiry DATE NULL,
    CONSTRAINT UQ_Warranties_VehicleId UNIQUE (VehicleId),
    CONSTRAINT FK_Warranties_Vehicles FOREIGN KEY (VehicleId) REFERENCES Vehicles(Id) ON DELETE CASCADE
);

CREATE TABLE WorkflowStages (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    DealerId UNIQUEIDENTIFIER NULL,
    StageKey NVARCHAR(60) NOT NULL,
    Label NVARCHAR(120) NOT NULL,
    Seq INT NOT NULL,
    Icon NVARCHAR(60) NULL,
    ColorHex NVARCHAR(20) NULL,
    Active BIT NOT NULL DEFAULT 1,
    IsTerminal BIT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_WorkflowStages_Dealers FOREIGN KEY (DealerId) REFERENCES Dealers(Id),
    CONSTRAINT UQ_WorkflowStages_Dealer_Key UNIQUE (DealerId, StageKey)
);

CREATE TABLE JobCards (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardNumber NVARCHAR(40) NOT NULL,
    DealerId UNIQUEIDENTIFIER NOT NULL,
    VehicleId UNIQUEIDENTIFIER NOT NULL,
    CustomerId UNIQUEIDENTIFIER NOT NULL,
    Status NVARCHAR(30) NOT NULL,
    ServiceType NVARCHAR(30) NOT NULL,
    Source NVARCHAR(30) NOT NULL,
    Priority NVARCHAR(20) NOT NULL,
    CurrentStageId UNIQUEIDENTIFIER NULL,
    ServiceAdvisorId UNIQUEIDENTIFIER NULL,
    AssignedTechnicianId UNIQUEIDENTIFIER NULL,
    OdometerAtCheckIn FLOAT NOT NULL DEFAULT 0,
    BatteryLevelAtCheckIn INT NULL,
    ExpectedDeliveryAt DATETIME2 NULL,
    ActualDeliveryAt DATETIME2 NULL,
    ClosedAt DATETIME2 NULL,
    TrackingToken NVARCHAR(80) NOT NULL,
    CustomerConsentNotes NVARCHAR(2000) NULL,
    CheckInSignatureUrl NVARCHAR(500) NULL,
    ErpJobCardId NVARCHAR(60) NULL,
    CreatedAt DATETIME2 NOT NULL,
    UpdatedAt DATETIME2 NOT NULL,
    CreatedById UNIQUEIDENTIFIER NULL,
    CONSTRAINT UQ_JobCards_Number UNIQUE (JobCardNumber),
    CONSTRAINT UQ_JobCards_TrackingToken UNIQUE (TrackingToken),
    CONSTRAINT FK_JobCards_Dealers FOREIGN KEY (DealerId) REFERENCES Dealers(Id),
    CONSTRAINT FK_JobCards_Vehicles FOREIGN KEY (VehicleId) REFERENCES Vehicles(Id),
    CONSTRAINT FK_JobCards_Customers FOREIGN KEY (CustomerId) REFERENCES Customers(Id),
    CONSTRAINT FK_JobCards_Stages FOREIGN KEY (CurrentStageId) REFERENCES WorkflowStages(Id),
    CONSTRAINT FK_JobCards_ServiceAdvisor FOREIGN KEY (ServiceAdvisorId) REFERENCES Users(Id),
    CONSTRAINT FK_JobCards_Technician FOREIGN KEY (AssignedTechnicianId) REFERENCES Users(Id),
    CONSTRAINT FK_JobCards_CreatedBy FOREIGN KEY (CreatedById) REFERENCES Users(Id)
);
CREATE INDEX IX_JobCards_Status ON JobCards(Status);

CREATE TABLE JobCardComplaints (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    Description NVARCHAR(500) NOT NULL,
    Category NVARCHAR(80) NULL,
    IsCustomerVoice BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_Complaints_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id) ON DELETE CASCADE
);

CREATE TABLE JobCardInspections (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    Component NVARCHAR(120) NOT NULL,
    Condition NVARCHAR(40) NOT NULL,
    Notes NVARCHAR(500) NULL,
    TechnicianId UNIQUEIDENTIFIER NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_Inspections_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Inspections_Technician FOREIGN KEY (TechnicianId) REFERENCES Users(Id)
);

CREATE TABLE JobCardPhotos (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    Stage NVARCHAR(20) NOT NULL,
    Url NVARCHAR(500) NOT NULL,
    Caption NVARCHAR(200) NULL,
    UploadedById UNIQUEIDENTIFIER NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_Photos_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Photos_UploadedBy FOREIGN KEY (UploadedById) REFERENCES Users(Id)
);

CREATE TABLE JobCardStageHistories (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    StageId UNIQUEIDENTIFIER NOT NULL,
    EnteredAt DATETIME2 NOT NULL,
    ExitedAt DATETIME2 NULL,
    ChangedById UNIQUEIDENTIFIER NULL,
    Notes NVARCHAR(500) NULL,
    CONSTRAINT FK_StageHistory_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id) ON DELETE CASCADE,
    CONSTRAINT FK_StageHistory_Stages FOREIGN KEY (StageId) REFERENCES WorkflowStages(Id),
    CONSTRAINT FK_StageHistory_ChangedBy FOREIGN KEY (ChangedById) REFERENCES Users(Id)
);

CREATE TABLE JobCardWorklogs (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    TechnicianId UNIQUEIDENTIFIER NOT NULL,
    TaskDescription NVARCHAR(300) NULL,
    StartedAt DATETIME2 NOT NULL,
    EndedAt DATETIME2 NULL,
    DurationMinutes INT NULL,
    Notes NVARCHAR(500) NULL,
    CONSTRAINT FK_Worklogs_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Worklogs_Technician FOREIGN KEY (TechnicianId) REFERENCES Users(Id)
);

CREATE TABLE QcChecklistItems (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    ItemName NVARCHAR(150) NOT NULL,
    Passed BIT NULL,
    Notes NVARCHAR(500) NULL,
    CheckedById UNIQUEIDENTIFIER NULL,
    CheckedAt DATETIME2 NULL,
    CONSTRAINT FK_Qc_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Qc_CheckedBy FOREIGN KEY (CheckedById) REFERENCES Users(Id)
);

CREATE TABLE Estimates (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    EstimateNumber NVARCHAR(40) NOT NULL,
    Status NVARCHAR(30) NOT NULL,
    TotalAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    Reason NVARCHAR(1000) NULL,
    CustomerResponseNotes NVARCHAR(1000) NULL,
    CreatedById UNIQUEIDENTIFIER NULL,
    CreatedAt DATETIME2 NOT NULL,
    SentToCustomerAt DATETIME2 NULL,
    RespondedAt DATETIME2 NULL,
    OtpVerified BIT NOT NULL DEFAULT 0,
    CONSTRAINT UQ_Estimates_Number UNIQUE (EstimateNumber),
    CONSTRAINT FK_Estimates_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Estimates_CreatedBy FOREIGN KEY (CreatedById) REFERENCES Users(Id)
);

CREATE TABLE EstimateLines (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    EstimateId UNIQUEIDENTIFIER NOT NULL,
    Type NVARCHAR(20) NOT NULL,
    Description NVARCHAR(200) NOT NULL,
    PartId UNIQUEIDENTIFIER NULL,
    Quantity FLOAT NOT NULL DEFAULT 1,
    UnitPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
    Amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT FK_EstimateLines_Estimates FOREIGN KEY (EstimateId) REFERENCES Estimates(Id) ON DELETE CASCADE
);

CREATE TABLE PartMasters (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    PartNumber NVARCHAR(60) NOT NULL,
    Name NVARCHAR(200) NOT NULL,
    Category NVARCHAR(80) NULL,
    UnitPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
    StockQty INT NOT NULL DEFAULT 0,
    ReorderLevel INT NOT NULL DEFAULT 5,
    DealerId UNIQUEIDENTIFIER NULL,
    ErpPartId NVARCHAR(60) NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_PartMasters_Dealers FOREIGN KEY (DealerId) REFERENCES Dealers(Id)
);
CREATE INDEX IX_PartMasters_PartNumber ON PartMasters(PartNumber);

ALTER TABLE EstimateLines ADD CONSTRAINT FK_EstimateLines_Parts FOREIGN KEY (PartId) REFERENCES PartMasters(Id);

CREATE TABLE JobCardParts (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    PartId UNIQUEIDENTIFIER NOT NULL,
    Quantity FLOAT NOT NULL DEFAULT 1,
    UnitPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
    Amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    Status NVARCHAR(20) NOT NULL,
    RequestedById UNIQUEIDENTIFIER NULL,
    IssuedById UNIQUEIDENTIFIER NULL,
    IssuedAt DATETIME2 NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_JobCardParts_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id) ON DELETE CASCADE,
    CONSTRAINT FK_JobCardParts_Parts FOREIGN KEY (PartId) REFERENCES PartMasters(Id),
    CONSTRAINT FK_JobCardParts_RequestedBy FOREIGN KEY (RequestedById) REFERENCES Users(Id),
    CONSTRAINT FK_JobCardParts_IssuedBy FOREIGN KEY (IssuedById) REFERENCES Users(Id)
);

CREATE TABLE Invoices (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NOT NULL,
    InvoiceNumber NVARCHAR(40) NOT NULL,
    DealerId UNIQUEIDENTIFIER NOT NULL,
    CustomerId UNIQUEIDENTIFIER NOT NULL,
    LabourAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    PartsAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    DiscountAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    CgstAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    SgstAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    IgstAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    TotalAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    Status NVARCHAR(20) NOT NULL,
    PaymentMode NVARCHAR(20) NOT NULL,
    PaymentReference NVARCHAR(80) NULL,
    GeneratedById UNIQUEIDENTIFIER NULL,
    GeneratedAt DATETIME2 NULL,
    PaidAt DATETIME2 NULL,
    PdfUrl NVARCHAR(500) NULL,
    ErpInvoiceId NVARCHAR(60) NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT UQ_Invoices_Number UNIQUE (InvoiceNumber),
    CONSTRAINT FK_Invoices_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id),
    CONSTRAINT FK_Invoices_Dealers FOREIGN KEY (DealerId) REFERENCES Dealers(Id),
    CONSTRAINT FK_Invoices_Customers FOREIGN KEY (CustomerId) REFERENCES Customers(Id),
    CONSTRAINT FK_Invoices_GeneratedBy FOREIGN KEY (GeneratedById) REFERENCES Users(Id)
);

CREATE TABLE NotificationTemplates (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    [Key] NVARCHAR(80) NOT NULL,
    Channel NVARCHAR(20) NOT NULL,
    Subject NVARCHAR(200) NULL,
    Body NVARCHAR(2000) NOT NULL,
    Active BIT NOT NULL DEFAULT 1,
    CONSTRAINT UQ_NotificationTemplates_Key UNIQUE ([Key])
);

CREATE TABLE NotificationRecords (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    JobCardId UNIQUEIDENTIFIER NULL,
    CustomerId UNIQUEIDENTIFIER NULL,
    Channel NVARCHAR(20) NOT NULL,
    TemplateKey NVARCHAR(80) NULL,
    RecipientAddress NVARCHAR(200) NOT NULL,
    Content NVARCHAR(2000) NOT NULL,
    Status NVARCHAR(20) NOT NULL,
    SentAt DATETIME2 NULL,
    ErrorMessage NVARCHAR(500) NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_NotificationRecords_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id),
    CONSTRAINT FK_NotificationRecords_Customers FOREIGN KEY (CustomerId) REFERENCES Customers(Id)
);

CREATE TABLE OtpRequests (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Purpose NVARCHAR(30) NOT NULL,
    Mobile NVARCHAR(30) NOT NULL,
    JobCardId UNIQUEIDENTIFIER NULL,
    EstimateId UNIQUEIDENTIFIER NULL,
    OtpHash NVARCHAR(100) NOT NULL,
    ExpiresAt DATETIME2 NOT NULL,
    VerifiedAt DATETIME2 NULL,
    Attempts INT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_OtpRequests_JobCards FOREIGN KEY (JobCardId) REFERENCES JobCards(Id),
    CONSTRAINT FK_OtpRequests_Estimates FOREIGN KEY (EstimateId) REFERENCES Estimates(Id)
);
CREATE INDEX IX_OtpRequests_Mobile_Purpose ON OtpRequests(Mobile, Purpose);

CREATE TABLE AuditLogEntries (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId UNIQUEIDENTIFIER NULL,
    Action NVARCHAR(80) NOT NULL,
    EntityType NVARCHAR(60) NOT NULL,
    EntityId NVARCHAR(60) NULL,
    DetailsJson NVARCHAR(MAX) NULL,
    IpAddress NVARCHAR(60) NULL,
    CreatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_AuditLogEntries_Users FOREIGN KEY (UserId) REFERENCES Users(Id)
);
CREATE INDEX IX_AuditLogEntries_Entity ON AuditLogEntries(EntityType, EntityId);

CREATE TABLE IntegrationLogEntries (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    [System] NVARCHAR(20) NOT NULL,
    Direction NVARCHAR(20) NOT NULL,
    Endpoint NVARCHAR(150) NOT NULL,
    RequestJson NVARCHAR(MAX) NULL,
    ResponseJson NVARCHAR(MAX) NULL,
    StatusCode INT NULL,
    Success BIT NOT NULL,
    DurationMs INT NOT NULL DEFAULT 0,
    RetryCount INT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL
);

CREATE TABLE Counters (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    DealerId UNIQUEIDENTIFIER NOT NULL,
    CounterType NVARCHAR(40) NOT NULL,
    Prefix NVARCHAR(20) NULL,
    CurrentValue INT NOT NULL DEFAULT 0,
    CONSTRAINT UQ_Counters_Dealer_Type UNIQUE (DealerId, CounterType),
    CONSTRAINT FK_Counters_Dealers FOREIGN KEY (DealerId) REFERENCES Dealers(Id)
);
