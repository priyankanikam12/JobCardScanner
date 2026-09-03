using System.Diagnostics;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web;
using Microsoft.IdentityModel.Tokens;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using JobCardScanner.Api.Services.Integrations;
using QuestPDF.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// QuestPDF Community license (free for this use case) - required as of QuestPDF 2023+.
QuestPDF.Settings.License = LicenseType.Community;

// ---------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------
// EnableRetryOnFailure: your RDS connection occasionally drops mid-query ("An existing connection
// was forcibly closed by the remote host" / SQL error 10054 - a transient network blip, not a bug
// in a query) which otherwise surfaces as a raw 500 on whatever request happened to be running.
// This makes EF Core transparently retry a handful of times before giving up.
builder.Services.AddDbContext<JobCardScannerDbContext>(opt =>
    opt.UseSqlServer(builder.Configuration.GetConnectionString("JobCardScannerDb"),
        sql => sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10), errorNumbersToAdd: null)));

// ---------------------------------------------------------------------
// Authentication: two independent bearer schemes.
//  - "AzureAd": staff (web + Android) sign in via Azure AD (Entra ID) / MSAL.
//  - "CustomerPortal": customers sign in via mobile + OTP; we issue our own
//    short-lived symmetric-key JWT (see Auth/CustomerTokenService.cs).
// Every [Authorize] attribute in this API explicitly names which scheme(s)
// it accepts, so there is no ambiguous "default scheme" to reason about.
// ---------------------------------------------------------------------
builder.Services.AddAuthentication()
    .AddMicrosoftIdentityWebApi(builder.Configuration, configSectionName: "AzureAd", jwtBearerScheme: AuthSchemes.AzureAd);

builder.Services.AddAuthentication().AddJwtBearer(AuthSchemes.CustomerPortal, options =>
{
    var section = builder.Configuration.GetSection("CustomerPortalJwt");
    var secret = section["Secret"] ?? "dev-only-insecure-secret-change-me-min-32-chars";
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = section["Issuer"],
        ValidateAudience = true,
        ValidAudience = section["Audience"],
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromMinutes(2),
    };
});

// "Dealer / Workshop Login" - local email+password sign-in for dealer-level staff who don't
// have an Azure AD account (see Controllers/DealerAuthController.cs). Issues our own JWT,
// signed with a separate secret from the customer-portal one above.
builder.Services.AddAuthentication().AddJwtBearer(AuthSchemes.DealerJwt, options =>
{
    var section = builder.Configuration.GetSection("DealerAuthJwt");
    var secret = section["Secret"] ?? "dev-only-insecure-secret-change-me-min-32-chars";
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = section["Issuer"],
        ValidateAudience = true,
        ValidAudience = section["Audience"],
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromMinutes(2),
    };
});

builder.Services.AddTransient<Microsoft.AspNetCore.Authentication.IClaimsTransformation, AppClaimsTransformation>();

builder.Services.AddAuthorization(options =>
{
    // Every staff-facing policy accepts BOTH the Azure AD scheme and the local DealerJwt scheme -
    // a workshop user who signed in on either the "Continue with Microsoft" tab or the
    // "Dealer / Workshop Login" tab ends up with the same app_role/app_user_id/app_dealer_id
    // claims (see AppClaimsTransformation and DealerJwtTokenService), so no controller needs to
    // know or care which one was used.
    options.AddPolicy(Policies.Staff, p => p.AddAuthenticationSchemes(AuthSchemes.AzureAd, AuthSchemes.DealerJwt).RequireAuthenticatedUser().RequireClaim("app_role"));
    options.AddPolicy(Policies.Customer, p => p.AddAuthenticationSchemes(AuthSchemes.CustomerPortal).RequireAuthenticatedUser().RequireClaim("customer_id"));

    static void RoleUp(Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder p, params string[] roles) =>
        p.AddAuthenticationSchemes(AuthSchemes.AzureAd, AuthSchemes.DealerJwt).RequireAuthenticatedUser().RequireClaim("app_role", roles);

    options.AddPolicy(Policies.ServiceAdvisorUp, p => RoleUp(p, "ServiceAdvisor", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.WorkshopManagerUp, p => RoleUp(p, "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.PartsUserUp, p => RoleUp(p, "PartsUser", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.CashierUp, p => RoleUp(p, "Cashier", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.DealerAdminUp, p => RoleUp(p, "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.CorporateAdminUp, p => RoleUp(p, "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.SystemAdminOnly, p => RoleUp(p, "SystemAdmin"));
});

// ---------------------------------------------------------------------
// App services
// ---------------------------------------------------------------------
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUserService, CurrentUserService>();
builder.Services.AddScoped<ICustomerTokenService, CustomerTokenService>();
builder.Services.AddScoped<IDealerJwtTokenService, DealerJwtTokenService>();

builder.Services.AddScoped<IErpClient, MockErpClient>();
builder.Services.AddScoped<IDmsClient, MockDmsClient>();
builder.Services.AddScoped<INotificationClient, MockNotificationClient>();
// Real Microsoft Graph call (app-only/client-credentials, see GraphEmailClient's doc comment) -
// not a mock, since OTP's email channel needs to actually land in an inbox to be useful. Best-
// effort by design: OtpService still works (SMS-only) even if AzureAdGraph:SenderMailbox or the
// Mail.Send Application permission aren't set up yet.
builder.Services.AddScoped<IEmailClient, GraphEmailClient>();
builder.Services.AddScoped<IOtpService, OtpService>();
builder.Services.AddMemoryCache();
builder.Services.AddScoped<IAzureAdDirectoryService, AzureAdDirectoryService>();
builder.Services.AddScoped<IBaplDealerService, BaplDealerService>();
builder.Services.AddScoped<IBaplDmsService, BaplDmsService>();
builder.Services.AddScoped<IJobCardNumberingService, JobCardNumberingService>();
builder.Services.AddScoped<IInvoicePdfService, InvoicePdfService>();
builder.Services.AddScoped<IExcelExportService, ExcelExportService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    o.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo { Title = "JobCardScanner API", Version = "v1" });
    var bearerScheme = new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Description = "Paste an Azure AD or Customer-Portal access token.",
    };
    c.AddSecurityDefinition("Bearer", bearerScheme);
    c.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        { new Microsoft.OpenApi.Models.OpenApiSecurityScheme { Reference = new Microsoft.OpenApi.Models.OpenApiReference { Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme, Id = "Bearer" } }, Array.Empty<string>() }
    });
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("AppCors", policy =>
    {
        var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
        policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Plain-HTTP-on-a-bare-public-IP deployments (no domain, no TLS cert) have nothing to redirect
// TO - UseHttpsRedirection() would 307 every request to an https:// origin with no binding,
// which just breaks the site. Guarded by config instead of deleted outright so the normal
// https-domain deployment path (see deploy/DEPLOYMENT_GUIDE.md) keeps this on by default.
// Set "DisableHttpsRedirection": true in appsettings.Production.json for a plain-IP deployment -
// see deploy/DEPLOYMENT_GUIDE_PUBLIC_IP.md.
//
// Once a self-signed cert is added for the browser's sake (MSAL needs a secure context - see
// main.tsx), this only redirects the /api/... surface's CALLERS THAT AREN'T the SPA away from
// plain HTTP for non-API requests - it deliberately EXCLUDES /api/... itself. The Android/Expo
// app talks straight to /api/... over plain HTTP and does its own PKCE via expo-crypto (a native
// module, not the browser's window.crypto.subtle), so it has no secure-context requirement of its
// own - and routing it through this redirect would just run it into the self-signed cert's
// untrusted-CA wall, which Android enforces hard with no "proceed anyway" click-through the way a
// browser has. See deploy/ANDROID_DEPLOYMENT.md.
if (!builder.Configuration.GetValue<bool>("DisableHttpsRedirection"))
{
    app.UseWhen(
        ctx => !ctx.Request.Path.StartsWithSegments("/api"),
        branch => branch.UseHttpsRedirection());
}
app.UseCors("AppCors");

// Serves job card photos uploaded via POST /api/jobcards/{id}/photos/upload (JobCardsController)
// from wwwroot/uploads/... at the matching /uploads/... URL. No [Authorize] on static files
// themselves (ASP.NET Core static file middleware doesn't support that) - the file names are
// unguessable GUIDs, same tradeoff as most "public CDN link" photo storage.
Directory.CreateDirectory(Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads", "jobcard-photos"));

// Default FileExtensionContentTypeProvider doesn't know ".apk" - without this, UseStaticFiles()
// returns a plain 404 for wwwroot/app/JobCardScanner.apk (self-hosted Android distribution,
// see deploy/ANDROID_DEPLOYMENT.md) instead of serving it. Note: web.config's IIS-level
// <staticContent><mimeMap> for .apk has NO effect here - the site's handler mapping forwards
// every request (path="*") to AspNetCoreModuleV2, so IIS's own static file handler never runs;
// this app's own middleware is what actually serves wwwroot.
var staticFileProvider = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
staticFileProvider.Mappings[".apk"] = "application/vnd.android.package-archive";
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = staticFileProvider });

app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// Lets this same app also host the built React SPA straight out of wwwroot (see
// deploy/DEPLOYMENT_GUIDE_PUBLIC_IP.md's "single site, no domain" deployment: `npm run build`'s
// dist/ output copied into wwwroot alongside the API). MapControllers above already claims every
// /api/... route, so this fallback only ever fires for whatever's left over - a direct link or a
// refresh on a client-side route like /jobcards/123 - and hands it index.html so React Router
// can take over, instead of IIS/Kestrel returning a raw 404. Harmless no-op in local dev, where
// wwwroot/index.html doesn't exist (the Vite dev server owns the frontend there instead).
app.MapFallbackToFile("index.html");

// Create the schema automatically on startup in Development, so `dotnet run` against a fresh
// local SQL Server produces a ready-to-use JobCardScanner database with zero manual steps.
// No demo/seed data is inserted - real staff are added via Admin -> Users (see AZURE_AD_SETUP.md
// for how the very first admin gets provisioned when starting from a genuinely empty database).
//
// NOTE ON EF CORE MIGRATIONS: this project ships without a checked-in Migrations/ folder,
// because scaffolding one requires `dotnet ef migrations add`, which in turn requires a
// successful `dotnet restore` - something this project was built without the ability to run
// (see README "About this build" section). EnsureCreatedAsync() below creates the schema
// directly from the model, which is sufficient for local development and evaluation.
// Before deploying to Azure SQL / a shared environment, replace this with real migrations:
//   dotnet ef migrations add InitialCreate
// then swap EnsureCreatedAsync() for db.Database.MigrateAsync() so schema changes are
// tracked and repeatable across environments.
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();

    // IMPORTANT: EnsureCreatedAsync() only creates the schema if the DATABASE ITSELF doesn't
    // exist yet. If you (or anyone) already connected to this database and ran so much as one
    // CREATE TABLE against it - e.g. testing a Users table by hand in SSMS/Azure Data Studio -
    // then from that point on EnsureCreatedAsync() sees "database exists" and silently does
    // NOTHING on every future startup: no tables at all, even though the app logs no error.
    // The logging below makes that state visible instead of silent - if you ever see "0 dealers
    // / 0 users" here on what should be a populated database, the fix is to drop and let this
    // block recreate the schema from scratch (see backend/README.md / AZURE_AD_SETUP.md), not to
    // hand-edit tables.
    var wasCreated = await db.Database.EnsureCreatedAsync();

    var dealerCount = await db.Dealers.CountAsync();
    var userCount = await db.Users.CountAsync();
    Console.WriteLine($"[Startup] EnsureCreatedAsync created a new database: {wasCreated}. Current counts -> Dealers: {dealerCount}, Users: {userCount}.");
}

// ---------------------------------------------------------------------
// SELF-HEALING COLUMN MIGRATIONS - runs every startup, every environment (not just Development,
// unlike the EnsureCreatedAsync block above - this database is shared across every environment
// this app has run in so far, and the whole point of this block is to stop relying on someone
// remembering to run a .sql script by hand).
//
// WHY THIS EXISTS: EnsureCreatedAsync() only creates schema on a brand-new empty database (see the
// NOTE above it) - on an existing database it is a permanent no-op, so every column added to a
// model AFTER the database first existed (JobCardPartSuggestions.Quantity/Description/HsnCode/Mrp,
// Customers.State) needs its own manual ALTER TABLE, previously shipped only as a deploy/*.sql
// script the user had to remember to run against the right database. That's exactly what went
// wrong here: the part-suggestions 500 error kept recurring across multiple test sessions because
// the migration was communicated but never actually executed against the database the backend was
// pointed at - a bare "500 Internal Server Error" in the browser Network tab gave no hint that a
// missing column was the cause (see AddPartSuggestion/AddLabourSuggestion's new catch blocks in
// JobCardsController.cs for the other half of this fix - surfacing the real exception message).
//
// Each ALTER below is guarded by the exact same "does this column already exist" check as its
// deploy/*.sql counterpart (kept in the repo as human-readable documentation of what changed and
// why), so running this on every startup is safe and cheap - a few sub-millisecond metadata
// lookups once the columns already exist, everywhere except the one real run that actually adds
// them.
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
    try
    {
        await db.Database.ExecuteSqlRawAsync(@"
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[JobCardPartSuggestions]') AND name = 'Quantity')
                ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [Quantity] int NOT NULL CONSTRAINT DF_JobCardPartSuggestions_Quantity DEFAULT (1);
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[JobCardPartSuggestions]') AND name = 'Description')
                ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [Description] nvarchar(400) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[JobCardPartSuggestions]') AND name = 'HsnCode')
                ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [HsnCode] nvarchar(20) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[JobCardPartSuggestions]') AND name = 'Mrp')
                ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [Mrp] decimal(12,2) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'State')
                ALTER TABLE [dbo].[Customers] ADD [State] nvarchar(100) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordHash')
                ALTER TABLE [dbo].[Customers] ADD [PasswordHash] nvarchar(300) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordResetTokenHash')
                ALTER TABLE [dbo].[Customers] ADD [PasswordResetTokenHash] nvarchar(100) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordResetExpiresAt')
                ALTER TABLE [dbo].[Customers] ADD [PasswordResetExpiresAt] datetime2 NULL;
        ");
        Console.WriteLine("[Startup] Self-healing column migrations checked/applied.");
    }
    catch (Exception ex)
    {
        // Never let a migration hiccup take the whole app down - log it loudly instead, same
        // reasoning as every other best-effort block in this file. Worst case, the app starts with
        // the same "missing column" 500 it already had, now at least logged clearly at startup
        // instead of only surfacing later as an opaque request failure.
        Console.WriteLine($"[Startup] WARNING: self-healing column migrations failed - {ex.Message}");
    }
}

// ---------------------------------------------------------------------
// SELF-HEALING SCHEMA CATCH-UP (2026-09-03) - folds EVERY previously-manual add-*.sql /
// apply-all-pending-jobcardscannerdb-changes.sql / redefine-workflow-stages-to-7-steps.sql script
// sitting at the repo root into one self-applying block, same reasoning as the column-migration
// block above (and the exact same root cause it was written for): this project has no EF Core
// migrations, so every schema/data change since the database was first created shipped as its own
// loose .sql file the user had to remember to run by hand against the real RDS database. Several of
// these were confirmed NOT actually applied yet (that's what caused the recurring part-suggestions
// 500 the block above fixes) - rather than trust that every other loose script WAS run, this block
// re-applies all of them here too. Every statement is guarded (IF NOT EXISTS / COL_LENGTH /
// OBJECT_ID), copied from the already-idempotent source scripts, so this is safe and cheap to run
// on every startup regardless of which of the original scripts were or weren't run by hand:
//   - apply-all-pending-jobcardscannerdb-changes.sql (Dealers/Vehicles/JobCards/JobCardPhotos BAPL
//     DMS columns, the JobCardPartSuggestions table + its own self-heal, the Invoices unique index)
//   - add-jobcard-labour-suggestions-table.sql (the JobCardLabourSuggestions table itself - if this
//     was never run, EVERY labour suggestion save/read fails, which is likely why "Add Suggestion"
//     under Labour Suggestion was reported as not working even after the part-suggestions fix)
//   - redefine-workflow-stages-to-7-steps.sql (the 7-step workflow: Vehicle Check-In, Work In
//     Progress, Part Suggestion, Labour Suggestion, Repair Completed, Ready for Delivery, Invoice
//     Generated)
//   - NEW: an 8th stage, "Estimate Created", inserted right after Labour Suggestion and before
//     Repair Completed, per explicit request - see JobCardsController.cs/EstimatesController.cs's
//     calls into WorkflowStageAutomation for what now auto-advances a job card onto it.
// Deliberately NOT included: add-bapldms-jobcard-media-table.sql and
// add-bapldms-jobcardheader-priority-column.sql target BAPLDMSvad (BAPL DMS's own database, a
// separate connection this DbContext does not own) - those still need running by hand against that
// database specifically if not already applied.
// ---------------------------------------------------------------------
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
    try
    {
        await db.Database.ExecuteSqlRawAsync(@"
            -- ---- from apply-all-pending-jobcardscannerdb-changes.sql ----
            IF COL_LENGTH('dbo.Dealers', 'BaplDmsDealerCode') IS NULL
                ALTER TABLE [dbo].[Dealers] ADD [BaplDmsDealerCode] nvarchar(30) NULL;
            IF COL_LENGTH('dbo.Vehicles', 'ControllerNo') IS NULL
                ALTER TABLE [dbo].[Vehicles] ADD [ControllerNo] nvarchar(50) NULL;
            IF COL_LENGTH('dbo.Vehicles', 'ConverterNo') IS NULL
                ALTER TABLE [dbo].[Vehicles] ADD [ConverterNo] nvarchar(50) NULL;
            IF COL_LENGTH('dbo.Vehicles', 'ChargerNo') IS NULL
                ALTER TABLE [dbo].[Vehicles] ADD [ChargerNo] nvarchar(50) NULL;
            IF COL_LENGTH('dbo.Vehicles', 'InsuranceExpiry') IS NULL
                ALTER TABLE [dbo].[Vehicles] ADD [InsuranceExpiry] date NULL;
            IF COL_LENGTH('dbo.Vehicles', 'NextServiceDueDate') IS NULL
                ALTER TABLE [dbo].[Vehicles] ADD [NextServiceDueDate] date NULL;
            IF COL_LENGTH('dbo.JobCards', 'BaplJobType') IS NULL
                ALTER TABLE [dbo].[JobCards] ADD [BaplJobType] nvarchar(60) NULL;
            IF COL_LENGTH('dbo.JobCards', 'BaplServiceLocation') IS NULL
                ALTER TABLE [dbo].[JobCards] ADD [BaplServiceLocation] nvarchar(200) NULL;
            IF COL_LENGTH('dbo.JobCards', 'BaplSupervisorName') IS NULL
                ALTER TABLE [dbo].[JobCards] ADD [BaplSupervisorName] nvarchar(120) NULL;
            IF COL_LENGTH('dbo.JobCards', 'BaplTechnicianName') IS NULL
                ALTER TABLE [dbo].[JobCards] ADD [BaplTechnicianName] nvarchar(120) NULL;
            IF COL_LENGTH('dbo.JobCards', 'BaplManualJobNo') IS NULL
                ALTER TABLE [dbo].[JobCards] ADD [BaplManualJobNo] nvarchar(40) NULL;
            IF COL_LENGTH('dbo.JobCardPhotos', 'Latitude') IS NULL
                ALTER TABLE [dbo].[JobCardPhotos] ADD [Latitude] float NULL;
            IF COL_LENGTH('dbo.JobCardPhotos', 'Longitude') IS NULL
                ALTER TABLE [dbo].[JobCardPhotos] ADD [Longitude] float NULL;
            IF COL_LENGTH('dbo.JobCardPhotos', 'PartSuggestionId') IS NULL
                ALTER TABLE [dbo].[JobCardPhotos] ADD [PartSuggestionId] UNIQUEIDENTIFIER NULL;
            IF COL_LENGTH('JobCards', 'BaplJobTypeId') IS NULL
                ALTER TABLE JobCards ADD BaplJobTypeId INT NULL;
            IF COL_LENGTH('JobCards', 'BaplJobSourceId') IS NULL
                ALTER TABLE JobCards ADD BaplJobSourceId INT NULL;
            IF COL_LENGTH('JobCards', 'BaplJobSourceName') IS NULL
                ALTER TABLE JobCards ADD BaplJobSourceName NVARCHAR(60) NULL;
            IF COL_LENGTH('JobCards', 'BaplServiceHeadId') IS NULL
                ALTER TABLE JobCards ADD BaplServiceHeadId INT NULL;
            IF COL_LENGTH('JobCards', 'BaplServiceHeadName') IS NULL
                ALTER TABLE JobCards ADD BaplServiceHeadName NVARCHAR(120) NULL;
            IF COL_LENGTH('JobCards', 'BaplServiceTypeId') IS NULL
                ALTER TABLE JobCards ADD BaplServiceTypeId INT NULL;
            IF COL_LENGTH('JobCards', 'BaplServiceTypeName') IS NULL
                ALTER TABLE JobCards ADD BaplServiceTypeName NVARCHAR(120) NULL;
            IF COL_LENGTH('JobCards', 'BaplServiceLocationCode') IS NULL
                ALTER TABLE JobCards ADD BaplServiceLocationCode NVARCHAR(20) NULL;
            IF COL_LENGTH('JobCards', 'BaplJobCardHeaderId') IS NULL
                ALTER TABLE JobCards ADD BaplJobCardHeaderId INT NULL;
            IF COL_LENGTH('JobCards', 'BaplJobNo') IS NULL
                ALTER TABLE JobCards ADD BaplJobNo INT NULL;
            IF COL_LENGTH('JobCards', 'BaplSyncStatus') IS NULL
                ALTER TABLE JobCards ADD BaplSyncStatus NVARCHAR(20) NULL;
            IF COL_LENGTH('JobCards', 'BaplSyncError') IS NULL
                ALTER TABLE JobCards ADD BaplSyncError NVARCHAR(1000) NULL;
            IF COL_LENGTH('JobCards', 'AssignedTechnicianName') IS NULL
                ALTER TABLE JobCards ADD AssignedTechnicianName NVARCHAR(120) NULL;
            IF OBJECT_ID('dbo.JobCardPartSuggestions', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.JobCardPartSuggestions (
                    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                    JobCardId UNIQUEIDENTIFIER NOT NULL,
                    ItemCode NVARCHAR(60) NOT NULL,
                    AvailableQtyAtSuggestion INT NULL,
                    Status NVARCHAR(20) NOT NULL DEFAULT 'Paid',
                    SuggestedById UNIQUEIDENTIFIER NULL,
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT FK_JobCardPartSuggestions_JobCards FOREIGN KEY (JobCardId) REFERENCES dbo.JobCards(Id) ON DELETE CASCADE,
                    CONSTRAINT FK_JobCardPartSuggestions_Users FOREIGN KEY (SuggestedById) REFERENCES dbo.Users(Id)
                );
                CREATE INDEX IX_JobCardPartSuggestions_JobCardId ON dbo.JobCardPartSuggestions(JobCardId);
            END
            IF COL_LENGTH('dbo.JobCardPartSuggestions', 'AvailableQtyAtSuggestion') IS NULL
                ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [AvailableQtyAtSuggestion] INT NULL;
            IF COL_LENGTH('dbo.JobCardPartSuggestions', 'SuggestedById') IS NULL
                ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [SuggestedById] UNIQUEIDENTIFIER NULL;
            IF COL_LENGTH('dbo.JobCardPartSuggestions', 'SuggestedById') IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM sys.foreign_keys
                   WHERE name = 'FK_JobCardPartSuggestions_Users' AND parent_object_id = OBJECT_ID('dbo.JobCardPartSuggestions')
               )
            BEGIN
                ALTER TABLE [dbo].[JobCardPartSuggestions]
                    ADD CONSTRAINT [FK_JobCardPartSuggestions_Users] FOREIGN KEY ([SuggestedById]) REFERENCES [dbo].[Users]([Id]);
            END
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes WHERE name = 'IX_Invoices_JobCardId' AND object_id = OBJECT_ID('dbo.Invoices')
            )
            BEGIN
                CREATE UNIQUE INDEX [IX_Invoices_JobCardId] ON [dbo].[Invoices] ([JobCardId]);
            END

            -- ---- from add-jobcard-labour-suggestions-table.sql ----
            IF OBJECT_ID('dbo.JobCardLabourSuggestions', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.JobCardLabourSuggestions (
                    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                    JobCardId UNIQUEIDENTIFIER NOT NULL,
                    LabourCode NVARCHAR(60) NOT NULL,
                    LabourDescription NVARCHAR(400) NULL,
                    HsnCode NVARCHAR(20) NULL,
                    Sgst DECIMAL(5,2) NULL,
                    Cgst DECIMAL(5,2) NULL,
                    Igst DECIMAL(5,2) NULL,
                    RateAtSuggestion DECIMAL(12,2) NULL,
                    Quantity INT NOT NULL DEFAULT 1,
                    IssueType NVARCHAR(120) NULL,
                    SuggestedById UNIQUEIDENTIFIER NULL,
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT FK_JobCardLabourSuggestions_JobCards FOREIGN KEY (JobCardId) REFERENCES dbo.JobCards(Id) ON DELETE CASCADE,
                    CONSTRAINT FK_JobCardLabourSuggestions_Users FOREIGN KEY (SuggestedById) REFERENCES dbo.Users(Id)
                );
                CREATE INDEX IX_JobCardLabourSuggestions_JobCardId ON dbo.JobCardLabourSuggestions(JobCardId);
            END
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'LabourDescription') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [LabourDescription] NVARCHAR(400) NULL;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'HsnCode') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [HsnCode] NVARCHAR(20) NULL;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'Sgst') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [Sgst] DECIMAL(5,2) NULL;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'Cgst') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [Cgst] DECIMAL(5,2) NULL;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'Igst') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [Igst] DECIMAL(5,2) NULL;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'RateAtSuggestion') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [RateAtSuggestion] DECIMAL(12,2) NULL;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'Quantity') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [Quantity] INT NOT NULL DEFAULT 1;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'IssueType') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [IssueType] NVARCHAR(120) NULL;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'SuggestedById') IS NULL
                ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [SuggestedById] UNIQUEIDENTIFIER NULL;
            IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'SuggestedById') IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM sys.foreign_keys
                   WHERE name = 'FK_JobCardLabourSuggestions_Users' AND parent_object_id = OBJECT_ID('dbo.JobCardLabourSuggestions')
               )
            BEGIN
                ALTER TABLE [dbo].[JobCardLabourSuggestions]
                    ADD CONSTRAINT [FK_JobCardLabourSuggestions_Users] FOREIGN KEY ([SuggestedById]) REFERENCES [dbo].[Users]([Id]);
            END
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_JobCardLabourSuggestions_JobCardId' AND object_id = OBJECT_ID('dbo.JobCardLabourSuggestions'))
                CREATE INDEX IX_JobCardLabourSuggestions_JobCardId ON dbo.JobCardLabourSuggestions(JobCardId);

            -- ---- from redefine-workflow-stages-to-7-steps.sql ----
            UPDATE dbo.WorkflowStages SET Label = 'Vehicle Check-In / Job Card Created', Seq = 1, Active = 1, IsTerminal = 0
                WHERE DealerId IS NULL AND StageKey = 'check_in';
            UPDATE dbo.WorkflowStages SET Label = 'Work In Progress', Seq = 2, Active = 1, IsTerminal = 0
                WHERE DealerId IS NULL AND StageKey = 'in_repair';
            UPDATE dbo.WorkflowStages SET Label = 'Repair Completed', Active = 1, IsTerminal = 0
                WHERE DealerId IS NULL AND StageKey = 'repair_completed';
            UPDATE dbo.WorkflowStages SET Label = 'Ready for Delivery', Active = 1, IsTerminal = 0
                WHERE DealerId IS NULL AND StageKey = 'ready_for_delivery';
            UPDATE dbo.WorkflowStages SET Label = 'Invoice Generated', Active = 1, IsTerminal = 1
                WHERE DealerId IS NULL AND StageKey = 'invoice_generated';
            IF NOT EXISTS (SELECT 1 FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'part_suggestion')
                INSERT INTO dbo.WorkflowStages (Id, DealerId, StageKey, Label, Seq, Icon, Active, IsTerminal, CreatedAt)
                VALUES (NEWID(), NULL, 'part_suggestion', 'Part Suggestion', 3, 'package', 1, 0, SYSUTCDATETIME());
            IF NOT EXISTS (SELECT 1 FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'labour_suggestion')
                INSERT INTO dbo.WorkflowStages (Id, DealerId, StageKey, Label, Seq, Icon, Active, IsTerminal, CreatedAt)
                VALUES (NEWID(), NULL, 'labour_suggestion', 'Labour Suggestion', 4, 'tool', 1, 0, SYSUTCDATETIME());
            UPDATE dbo.WorkflowStages SET Active = 0
                WHERE DealerId IS NULL AND StageKey IN ('job_card_created', 'inspection', 'diagnosis', 'estimate_prep', 'customer_approval',
                                    'parts_requested', 'parts_issued', 'quality_check', 'rework', 'closed');

            -- ---- NEW: 'Estimate Created' stage, inserted right after Labour Suggestion ----
            IF NOT EXISTS (SELECT 1 FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'estimate_created')
                INSERT INTO dbo.WorkflowStages (Id, DealerId, StageKey, Label, Seq, Icon, Active, IsTerminal, CreatedAt)
                VALUES (NEWID(), NULL, 'estimate_created', 'Estimate Created', 5, 'file-text', 1, 0, SYSUTCDATETIME());
            -- Final order: 1 check_in, 2 in_repair, 3 part_suggestion, 4 labour_suggestion,
            -- 5 estimate_created, 6 repair_completed, 7 ready_for_delivery, 8 invoice_generated.
            UPDATE dbo.WorkflowStages SET Seq = 6 WHERE DealerId IS NULL AND StageKey = 'repair_completed';
            UPDATE dbo.WorkflowStages SET Seq = 7 WHERE DealerId IS NULL AND StageKey = 'ready_for_delivery';
            UPDATE dbo.WorkflowStages SET Seq = 8 WHERE DealerId IS NULL AND StageKey = 'invoice_generated';

            -- Re-point any job card still sitting on a now-retired GLOBAL stage onto its nearest
            -- surviving replacement (history rows are left untouched - see
            -- redefine-workflow-stages-to-7-steps.sql's own step 4 for the full narrative).
            DECLARE @checkIn UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'check_in');
            DECLARE @inRepair UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'in_repair');
            DECLARE @partSuggestion UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'part_suggestion');
            DECLARE @repairCompleted UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'repair_completed');
            DECLARE @invoiceGenerated UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'invoice_generated');
            UPDATE j SET CurrentStageId = @checkIn
                FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
                WHERE s.DealerId IS NULL AND s.StageKey = 'job_card_created';
            UPDATE j SET CurrentStageId = @inRepair
                FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
                WHERE s.DealerId IS NULL AND s.StageKey IN ('inspection', 'diagnosis', 'estimate_prep', 'customer_approval');
            UPDATE j SET CurrentStageId = @partSuggestion
                FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
                WHERE s.DealerId IS NULL AND s.StageKey IN ('parts_requested', 'parts_issued');
            UPDATE j SET CurrentStageId = @repairCompleted
                FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
                WHERE s.DealerId IS NULL AND s.StageKey IN ('quality_check', 'rework');
            UPDATE j SET CurrentStageId = @invoiceGenerated
                FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
                WHERE s.DealerId IS NULL AND s.StageKey = 'closed';
        ");
        Console.WriteLine("[Startup] Self-healing schema catch-up (BAPL columns, Labour Suggestions table, 8-step workflow) checked/applied.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Startup] WARNING: self-healing schema catch-up failed - {ex.Message}");
    }
}

// ---------------------------------------------------------------------
// COLUMN TYPE-REPAIR (2026-09-03) - the IF OBJECT_ID(...)/COL_LENGTH(...) guards in the block
// above (and the one before it) only detect a MISSING table/column - they cannot detect or fix a
// column that already exists with the WRONG type. Confirmed live via a pasted server log: on this
// database, JobCardPartSuggestions.Status is INT (not NVARCHAR(20) as the CREATE TABLE above and
// the JobCardPartSuggestion C# model assume), so every "Add Suggestion" save under Part Suggestion
// failed with "Conversion failed when converting the nvarchar value 'Paid' to data type int." -
// the app always writes the string 'Paid' or 'U/W' into this column (see AddPartSuggestion's
// req.Status check in JobCardsController.cs). This almost certainly happened because
// JobCardPartSuggestions already existed - created earlier by a different ad hoc script with
// Status typed as INT - before this app's own guarded CREATE TABLE ever ran, so IF OBJECT_ID(...)
// IS NULL was already false and the correct NVARCHAR(20) definition was silently never applied.
// This is a SEPARATE try/catch block (its own ExecuteSqlRawAsync call), not folded into the block
// above, because a mid-batch error aborts every remaining statement in that same batch - a bug
// here must not be able to prevent the BAPL-columns/Labour-table/workflow-stage statements above
// it from applying.
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
    try
    {
        await db.Database.ExecuteSqlRawAsync(@"
            DECLARE @actualType NVARCHAR(50);
            SELECT @actualType = ty.name
                FROM sys.columns c
                JOIN sys.types ty ON c.user_type_id = ty.user_type_id
                WHERE c.object_id = OBJECT_ID('dbo.JobCardPartSuggestions') AND c.name = 'Status';

            IF @actualType IS NOT NULL AND @actualType <> 'nvarchar'
            BEGIN
                -- Drop any default constraint bound to Status first - ALTER COLUMN fails while one
                -- is attached, and the constraint's autogenerated name isn't known up front.
                DECLARE @dfName SYSNAME, @dynSql NVARCHAR(400);
                SELECT @dfName = dc.name
                    FROM sys.default_constraints dc
                    JOIN sys.columns c ON c.default_object_id = dc.object_id
                    WHERE dc.parent_object_id = OBJECT_ID('dbo.JobCardPartSuggestions') AND c.name = 'Status';
                IF @dfName IS NOT NULL
                BEGIN
                    SET @dynSql = N'ALTER TABLE [dbo].[JobCardPartSuggestions] DROP CONSTRAINT [' + @dfName + N']';
                    EXEC sp_executesql @dynSql;
                END

                -- Widen first (int -> nvarchar(20) is a safe conversion - SQL Server turns each
                -- existing value into its string form automatically) and only translate values
                -- afterwards - doing the value translation while the column is still INT would
                -- throw this exact same conversion error.
                ALTER TABLE [dbo].[JobCardPartSuggestions] ALTER COLUMN [Status] NVARCHAR(20) NULL;

                -- Legacy numeric-as-string values -> the two values the app actually understands
                -- (AddPartSuggestion rejects anything else - req.Status must be 'Paid' or 'U/W').
                -- Adjust this mapping if this dealer's original int codes meant something else;
                -- anything unrecognized falls back to 'Paid' rather than being left in a state the
                -- UI/API can't handle.
                UPDATE [dbo].[JobCardPartSuggestions]
                    SET [Status] = CASE
                        WHEN [Status] IN ('Paid', 'U/W') THEN [Status]
                        WHEN [Status] IN ('2', 'UW', 'U-W', 'Warranty') THEN 'U/W'
                        ELSE 'Paid'
                    END;

                ALTER TABLE [dbo].[JobCardPartSuggestions] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
                ALTER TABLE [dbo].[JobCardPartSuggestions]
                    ADD CONSTRAINT [DF_JobCardPartSuggestions_Status] DEFAULT ('Paid') FOR [Status];
            END
        ");
        Console.WriteLine("[Startup] Column type-repair (JobCardPartSuggestions.Status) checked/applied.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Startup] WARNING: JobCardPartSuggestions.Status type-repair failed - {ex.Message}");
    }
}

// Opens Swagger in the default browser automatically once Kestrel has actually started
// listening. launchSettings.json's "launchBrowser"/"launchUrl": "swagger" ONLY takes effect when
// launched from Visual Studio or `dotnet watch run` - plain `dotnet run` (what you get typing it
// straight into a terminal, e.g. PowerShell) ignores both, which is why nothing opened. This
// covers that path too - Development only, and best-effort (never lets a failed browser launch,
// e.g. running headless in a container/CI, take down the app).
if (app.Environment.IsDevelopment())
{
    app.Lifetime.ApplicationStarted.Register(() =>
    {
        try
        {
            var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()?.Addresses;
            var url = addresses?.FirstOrDefault(a => a.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) ?? addresses?.FirstOrDefault();
            if (url != null)
            {
                Process.Start(new ProcessStartInfo($"{url}/swagger") { UseShellExecute = true });
            }
        }
        catch (Exception ex)
        {
            app.Logger.LogInformation(ex, "Could not auto-open Swagger in the browser (harmless - open it manually instead).");
        }
    });
}

app.Run();
