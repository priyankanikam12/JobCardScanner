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

// 2026-09-03: DIAGNOSTIC - added while chasing a reported 401 on /api/auth/me from a fresh
// public-IP deploy (https://3.88.172.79). AddMicrosoftIdentityWebApi rejects a bad/invalid token
// with a 401 challenge, but the *reason* (bad signature, wrong audience, expired, clock skew,
// couldn't reach Azure AD's key-fetch endpoint...) only goes to ILogger, which on a plain
// `dotnet MyApp.dll` in a terminal, or a systemd/IIS-hosted process, may not be visible anywhere
// the person deploying this is actually looking. Every other startup check in this file
// (EnsureCreatedAsync, the self-healing schema blocks) already logs straight to Console.WriteLine
// for exactly this reason - this does the same for the one failure mode those checks can't cover.
// Safe to leave in permanently: it only chains onto whatever handlers Microsoft.Identity.Web
// already wired up (captured below and still invoked), it never changes the actual auth decision,
// and it only ever fires on a REJECTED token, so it is silent on every normal successful request.
// Once the real cause is confirmed from these lines, this block can be deleted if the extra
// console noise on ordinary bad-token attempts (e.g. an expired browser tab) isn't wanted.
builder.Services.Configure<JwtBearerOptions>(AuthSchemes.AzureAd, options =>
{
    var previousOnAuthenticationFailed = options.Events?.OnAuthenticationFailed;
    var previousOnChallenge = options.Events?.OnChallenge;
    options.Events ??= new JwtBearerEvents();

    options.Events.OnAuthenticationFailed = async context =>
    {
        Console.WriteLine($"[AzureAd JWT] Token REJECTED - {context.Exception.GetType().Name}: {context.Exception.Message}");
        if (previousOnAuthenticationFailed is not null) await previousOnAuthenticationFailed(context);
    };
    options.Events.OnChallenge = async context =>
    {
        Console.WriteLine($"[AzureAd JWT] 401 challenge on {context.Request.Path} - " +
            $"AuthenticateFailure: {context.AuthenticateFailure?.Message ?? "(none - request had no/unparseable bearer token)"}. " +
            $"Error={context.Error ?? "(none)"}, ErrorDescription={context.ErrorDescription ?? "(none)"}");
        if (previousOnChallenge is not null) await previousOnChallenge(context);
    };
});

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

    // 2026-09-24: "Supervisor" (new role, see StaffRole.Supervisor's doc comment) added to both of
    // these - it keeps the exact same practical access WorkshopManager already has (that's what
    // Designation="Supervisor" used to map onto before today), it's just now its own distinct role
    // rather than a plain alias of WorkshopManager.
    options.AddPolicy(Policies.ServiceAdvisorUp, p => RoleUp(p, "ServiceAdvisor", "Supervisor", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.WorkshopManagerUp, p => RoleUp(p, "Supervisor", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.PartsUserUp, p => RoleUp(p, "PartsUser", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    // See Policies.PartsReadUp's doc comment - union of ServiceAdvisorUp + PartsUserUp's roles,
    // read-only Part Upload access for Repair Bill/Material Transfer's part picker.
    //
    // 2026-09-30 (SECTION 162, "real access lock" for Supervisor - see this file's own SECTION 162
    // note further down for the full narrative): Supervisor REMOVED from this list. Confirmed safe
    // - PartsReadUp is not used by JobCardsController or AttendanceController (the two features
    // Supervisor keeps), only by PartUploadController.Get() (Stock Report - now locked out for
    // Supervisor per this section) and, per its own doc comment, the Repair Bill/Material
    // Transfer Item Code picker (both of those creation flows are also being locked out for
    // Supervisor this section - see MaterialTransferDocsController/RepairBillDocsController's own
    // policy reassignment below), so removing Supervisor here has no collateral effect on
    // anything Supervisor is meant to keep.
    options.AddPolicy(Policies.PartsReadUp, p => RoleUp(p, "ServiceAdvisor", "PartsUser", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.CashierUp, p => RoleUp(p, "Cashier", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.DealerAdminUp, p => RoleUp(p, "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.CorporateAdminUp, p => RoleUp(p, "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.SystemAdminOnly, p => RoleUp(p, "SystemAdmin"));
    // See Policies.SupervisorUp's own doc comment - deliberately excludes plain WorkshopManager.
    //
    // 2026-09-30 (SECTION 162) FLAG, not yet resolved: this policy's entire reason to exist was to
    // give Supervisor (and DealerAdmin and up) access to Technician Employee that a plain
    // WorkshopManager doesn't have. Supervisor is now being locked out of Technician Employee too
    // (see App.tsx/StaffLayout.tsx changes this section), which would make this policy identical
    // to DealerAdminUp (DealerAdmin, CorporateAdmin, SystemAdmin - Supervisor removed below).
    // NOT deleted/merged into DealerAdminUp yet because I don't have
    // TechnicianEmployeesController.cs in this session to confirm it's really the only caller of
    // SupervisorUp before removing/renaming it - paste that file and I'll finish this cleanly
    // (either retire this policy in favour of DealerAdminUp, or confirm another caller still needs
    // the Supervisor-without-WorkshopManager distinction and leave it as its own policy with
    // Supervisor removed, whichever the real file shows).
    options.AddPolicy(Policies.SupervisorUp, p => RoleUp(p, "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    // 2026-09-30 (SECTION 162, "real access lock" for Supervisor - user confirmed: Supervisor
    // logins should only be able to use Dashboard, Job Cards and Attendance; everything else
    // Supervisor could previously reach must be genuinely blocked, not just hidden from the
    // sidebar). FACT: ServiceAdvisorUp and WorkshopManagerUp above are SHARED policies - re-read
    // directly from JobCardsController.cs and AttendanceController.cs this session, both of which
    // gate several of their own actions with these same two policies, and Supervisor must KEEP
    // those (Job Cards and Attendance are the two features being preserved). Stripping Supervisor
    // out of ServiceAdvisorUp/WorkshopManagerUp directly would have also locked Supervisor out of
    // Job Cards and Attendance, which is the opposite of what was asked. So instead of touching
    // those two shared policies, two NEW policies are added below, identical to their originals
    // minus Supervisor, for the controllers whose access should genuinely be revoked. Only the
    // controllers already in this session (MaterialTransferDocsController.cs,
    // RepairBillDocsController.cs) have been repointed at these new policies so far - see this
    // section's own README entry for the full list of controllers still needed (LabourMaster,
    // Item Master/Parts, Service History, Vehicle Sale, Reports, Technician Employees, Extended
    // Battery Warranty Schemes, OEM Models/Warranties) to finish closing this off at the API level.
    // Until those are repointed too, a Supervisor's existing token would still be ACCEPTED by
    // those controllers' current ServiceAdvisorUp/WorkshopManagerUp policies if called directly
    // (Swagger/Postman/a modified client) - the frontend route guards block normal in-app/URL
    // navigation today, but this is not yet a complete server-side lock. Flagging this plainly
    // rather than claiming the lock is finished.
    // NOTE: using plain string literals ("ServiceAdvisorUpNoSupervisor"/"WorkshopManagerUpNoSupervisor")
    // rather than new Policies.XxxNoSupervisor constants - I don't have your real Auth/Policies.cs
    // (or wherever the Policies static class actually lives - you told me on 2026-09-29 there's no
    // Auth/Policies.cs) in this session, so adding constants there risked a guess at that file's
    // exact structure. AddPolicy's first argument and [Authorize(Policy = "...")] both just take a
    // plain string, so this compiles and works identically either way. If you'd rather have real
    // Policies.ServiceAdvisorUpNoSupervisor/WorkshopManagerUpNoSupervisor constants for consistency
    // with every other policy name in this file, paste me the file that defines the Policies class
    // and I'll add them there and switch these two literals over to it - purely cosmetic, not a
    // behavior change.
    options.AddPolicy("ServiceAdvisorUpNoSupervisor", p => RoleUp(p, "ServiceAdvisor", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy("WorkshopManagerUpNoSupervisor", p => RoleUp(p, "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
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
builder.Services.AddScoped<IDmsBaplDataService, DmsBaplDataService>();
builder.Services.AddScoped<ILabourMasterImportService, LabourMasterImportService>();
builder.Services.AddScoped<IPartUploadService, PartUploadService>();
builder.Services.AddScoped<IJobCardNumberingService, JobCardNumberingService>();
builder.Services.AddScoped<IInvoicePdfService, InvoicePdfService>();
builder.Services.AddScoped<IEstimatePdfService, EstimatePdfService>();
builder.Services.AddScoped<IExcelExportService, ExcelExportService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
builder.Services.AddScoped<ILocalItemMasterService, LocalItemMasterService>();
builder.Services.AddScoped<IBaplLedgerService, BaplLedgerService>();
// 2026-09-22 "create warenty table in jobcardscanner db" - shared formula used by both
// ExtendedBatteryWarrantySchemesController's GET .../eligible and RepairBillDocsController.Create's
// non-destructive per-line tagging, see IExtendedBatteryWarrantyEligibilityService's own doc comment.
builder.Services.AddScoped<IExtendedBatteryWarrantyEligibilityService, ExtendedBatteryWarrantyEligibilityService>();

// SECTION 186 (2026-10-02, "after 1st login 9 hr calculate and log out after 9 hr that
// implememnt properly") - confirmed via AskUserQuestion: Shift 1 staff still checked in at 18:00
// IST get CheckOutTime auto-written as 18:00. See Services/AttendanceAutoCheckoutService.cs's own
// doc comment for the full reasoning (plain poll-loop BackgroundService, not Hangfire/Quartz -
// nothing in this file registers either, so none is assumed to exist).
builder.Services.AddHostedService<AttendanceAutoCheckoutService>();

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

    // NOTE: these two counts stay sequential (not Task.WhenAll) on purpose - a single
    // JobCardScannerDbContext instance isn't thread-safe for concurrent commands ("A second
    // operation was started on this context before a previous operation completed" if you try).
    // This is a 2-query, same-process cost either way - not where this file's real startup-time
    // win is (see the self-healing section below, which DOES run its blocks concurrently, each
    // on its own DbContext/connection).
    var dealerCount = await db.Dealers.CountAsync();
    var userCount = await db.Users.CountAsync();
    Console.WriteLine($"[Startup] EnsureCreatedAsync created a new database: {wasCreated}. Current counts -> Dealers: {dealerCount}, Users: {userCount}.");
}

// =======================================================================
// SELF-HEALING SCHEMA CATCH-UP - 2026-10-01 CLEANUP ("clean program.cs coz takes many time to
// start"): same 9 guarded, idempotent SQL blocks that were already here (every statement below is
// byte-for-byte unchanged from before this cleanup - only HOW they're invoked changed), just
// restructured so independent blocks run CONCURRENTLY instead of one-after-another.
//
// FACT: every block below was already its own `using var scope = app.Services.CreateScope();` +
// its own JobCardScannerDbContext + its own try/catch, specifically so one block's failure can
// never block another (see each block's own doc comment, preserved below). That per-block
// isolation is exactly what also makes them safe to run concurrently: each has its own DbContext
// (so its own SQL connection) and touches its own tables. Previously they ran one at a time -
// 9 sequential network round-trips to your RDS/Azure SQL database on EVERY startup, in EVERY
// environment (not just Development). On a remote database with any real network latency, 9
// sequential round-trips is the single biggest startup-time cost in this file after the DB
// connection itself - this is very likely the "takes many time to start" you're seeing, given the
// log you pasted cut off right after the FIRST of these 9 blocks logged its success line.
//
// DEPENDENCY CHECK (so parallelizing doesn't break anything): I re-read all 9 blocks' SQL to find
// any that touch a table only a DIFFERENT block creates.
//   - RunOemModelCatchUpAsync (OemModels/OemModelWarranties) ALTERs
//     dbo.ExtendedBatteryWarrantySchemes to add OemModelId - that table is CREATED by
//     RunExtendedBatteryWarrantySchemeCatchUpAsync. On a database where that table doesn't exist
//     yet, running these two at the same time could race (the ALTER could fire before the CREATE
//     TABLE commits). So RunOemModelCatchUpAsync now explicitly runs AFTER
//     RunExtendedBatteryWarrantySchemeCatchUpAsync, not concurrently with it.
//   - RunPartSuggestionStatusTypeRepairAsync reads/ALTERs dbo.JobCardPartSuggestions.Status -
//     that table is CREATED by RunBaplColumnsLabourWorkflowCatchUpAsync (the old "apply-all-
//     pending-jobcardscannerdb-changes.sql" block). Same reasoning - kept sequential after it,
//     not concurrent with it.
//   - Every other block (column migrations, Material Transfer Labour, Technician Employee,
//     Service Menu/Complaint/Prefix Master, Menu Access Override/Role Menu Mode) touches tables
//     none of the others create or depend on - confirmed safe to run concurrently.
// This is why the two "wave 2" blocks below are awaited AFTER wave 1 finishes, not inside the
// same Task.WhenAll - on an already-provisioned database (yours - 30 dealers, 658 users) every
// guard is already a no-op either way, so this ordering costs nothing extra there; it only
// matters for a brand-new/empty database.
//
// Nothing about WHAT runs changed - same SQL text, same log messages, same per-block try/catch
// (a caught exception is logged and swallowed exactly as before, never allowed to take down the
// other blocks or the app). Only the scheduling changed.
// =======================================================================

// ---- wave 1 block: SELF-HEALING COLUMN MIGRATIONS - runs every startup, every environment (not
// just Development, unlike the EnsureCreatedAsync block above - this database is shared across
// every environment this app has run in so far, and the whole point of this block is to stop
// relying on someone remembering to run a .sql script by hand).
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
// async Task RunColumnMigrationsAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[JobCardPartSuggestions]') AND name = 'Quantity')
//                 ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [Quantity] int NOT NULL CONSTRAINT DF_JobCardPartSuggestions_Quantity DEFAULT (1);
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[JobCardPartSuggestions]') AND name = 'Description')
//                 ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [Description] nvarchar(400) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[JobCardPartSuggestions]') AND name = 'HsnCode')
//                 ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [HsnCode] nvarchar(20) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[JobCardPartSuggestions]') AND name = 'Mrp')
//                 ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [Mrp] decimal(12,2) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'State')
//                 ALTER TABLE [dbo].[Customers] ADD [State] nvarchar(100) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordHash')
//                 ALTER TABLE [dbo].[Customers] ADD [PasswordHash] nvarchar(300) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordResetTokenHash')
//                 ALTER TABLE [dbo].[Customers] ADD [PasswordResetTokenHash] nvarchar(100) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Customers]') AND name = 'PasswordResetExpiresAt')
//                 ALTER TABLE [dbo].[Customers] ADD [PasswordResetExpiresAt] datetime2 NULL;
//             -- 2026-09-17 ""Employees"" page (Admin -> Users) - employee profile + work-area
//             -- location scoping columns on Users. See MasterData.cs's User class doc comments.
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'State')
//                 ALTER TABLE [dbo].[Users] ADD [State] nvarchar(100) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'City')
//                 ALTER TABLE [dbo].[Users] ADD [City] nvarchar(100) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'Pincode')
//                 ALTER TABLE [dbo].[Users] ADD [Pincode] nvarchar(10) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'DateOfJoining')
//                 ALTER TABLE [dbo].[Users] ADD [DateOfJoining] date NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'Designation')
//                 ALTER TABLE [dbo].[Users] ADD [Designation] nvarchar(50) NULL;
//             IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'WorkLocationCodes')
//                 ALTER TABLE [dbo].[Users] ADD [WorkLocationCodes] nvarchar(2000) NULL;
//         ");
//         Console.WriteLine("[Startup] Self-healing column migrations checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         // Never let a migration hiccup take the whole app down - log it loudly instead, same
//         // reasoning as every other best-effort block in this file. Worst case, the app starts with
//         // the same "missing column" 500 it already had, now at least logged clearly at startup
//         // instead of only surfacing later as an opaque request failure.
//         Console.WriteLine($"[Startup] WARNING: self-healing column migrations failed - {ex.Message}");
//     }
// }

// // ---- wave 1 block: SELF-HEALING SCHEMA CATCH-UP (2026-09-03) - folds EVERY previously-manual
// // add-*.sql / apply-all-pending-jobcardscannerdb-changes.sql / redefine-workflow-stages-to-7-
// // steps.sql script sitting at the repo root into one self-applying block, same reasoning as the
// // column-migration block above (and the exact same root cause it was written for): this project
// // has no EF Core migrations, so every schema/data change since the database was first created
// // shipped as its own loose .sql file the user had to remember to run by hand against the real RDS
// // database. Several of these were confirmed NOT actually applied yet (that's what caused the
// // recurring part-suggestions 500 the block above fixes) - rather than trust that every other loose
// // script WAS run, this block re-applies all of them here too. Every statement is guarded (IF NOT
// // EXISTS / COL_LENGTH / OBJECT_ID), copied from the already-idempotent source scripts, so this is
// // safe and cheap to run on every startup regardless of which of the original scripts were or
// // weren't run by hand:
// //   - apply-all-pending-jobcardscannerdb-changes.sql (Dealers/Vehicles/JobCards/JobCardPhotos BAPL
// //     DMS columns, the JobCardPartSuggestions table + its own self-heal, the Invoices unique index)
// //   - add-jobcard-labour-suggestions-table.sql (the JobCardLabourSuggestions table itself - if this
// //     was never run, EVERY labour suggestion save/read fails, which is likely why "Add Suggestion"
// //     under Labour Suggestion was reported as not working even after the part-suggestions fix)
// //   - redefine-workflow-stages-to-7-steps.sql (the 7-step workflow: Vehicle Check-In, Work In
// //     Progress, Part Suggestion, Labour Suggestion, Repair Completed, Ready for Delivery, Invoice
// //     Generated)
// //   - NEW: an 8th stage, "Estimate Created", inserted right after Labour Suggestion and before
// //     Repair Completed, per explicit request - see JobCardsController.cs/EstimatesController.cs's
// //     calls into WorkflowStageAutomation for what now auto-advances a job card onto it.
// // Deliberately NOT included: add-bapldms-jobcard-media-table.sql and
// // add-bapldms-jobcardheader-priority-column.sql target BAPLDMSvad (DMS's own database, a
// // separate connection this DbContext does not own) - those still need running by hand against that
// // database specifically if not already applied.
// //
// // NOTE (2026-10-01 cleanup): RunPartSuggestionStatusTypeRepairAsync and RunOemModelCatchUpAsync
// // (further below) both depend on something THIS block creates/owns - see the dependency note at
// // the top of this section - so this one is awaited in wave 1, and those two run afterward, not
// // concurrently with it.
// async Task RunBaplColumnsLabourWorkflowCatchUpAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             -- ---- from apply-all-pending-jobcardscannerdb-changes.sql ----
//             IF COL_LENGTH('dbo.Dealers', 'BaplDmsDealerCode') IS NULL
//                 ALTER TABLE [dbo].[Dealers] ADD [BaplDmsDealerCode] nvarchar(30) NULL;
//             IF COL_LENGTH('dbo.Vehicles', 'ControllerNo') IS NULL
//                 ALTER TABLE [dbo].[Vehicles] ADD [ControllerNo] nvarchar(50) NULL;
//             IF COL_LENGTH('dbo.Vehicles', 'ConverterNo') IS NULL
//                 ALTER TABLE [dbo].[Vehicles] ADD [ConverterNo] nvarchar(50) NULL;
//             IF COL_LENGTH('dbo.Vehicles', 'ChargerNo') IS NULL
//                 ALTER TABLE [dbo].[Vehicles] ADD [ChargerNo] nvarchar(50) NULL;
//             IF COL_LENGTH('dbo.Vehicles', 'InsuranceExpiry') IS NULL
//                 ALTER TABLE [dbo].[Vehicles] ADD [InsuranceExpiry] date NULL;
//             IF COL_LENGTH('dbo.Vehicles', 'NextServiceDueDate') IS NULL
//                 ALTER TABLE [dbo].[Vehicles] ADD [NextServiceDueDate] date NULL;
//             IF COL_LENGTH('dbo.JobCards', 'BaplJobType') IS NULL
//                 ALTER TABLE [dbo].[JobCards] ADD [BaplJobType] nvarchar(60) NULL;
//             IF COL_LENGTH('dbo.JobCards', 'BaplServiceLocation') IS NULL
//                 ALTER TABLE [dbo].[JobCards] ADD [BaplServiceLocation] nvarchar(200) NULL;
//             IF COL_LENGTH('dbo.JobCards', 'BaplSupervisorName') IS NULL
//                 ALTER TABLE [dbo].[JobCards] ADD [BaplSupervisorName] nvarchar(120) NULL;
//             IF COL_LENGTH('dbo.JobCards', 'BaplTechnicianName') IS NULL
//                 ALTER TABLE [dbo].[JobCards] ADD [BaplTechnicianName] nvarchar(120) NULL;
//             IF COL_LENGTH('dbo.JobCards', 'BaplManualJobNo') IS NULL
//                 ALTER TABLE [dbo].[JobCards] ADD [BaplManualJobNo] nvarchar(40) NULL;
//             IF COL_LENGTH('dbo.JobCardPhotos', 'Latitude') IS NULL
//                 ALTER TABLE [dbo].[JobCardPhotos] ADD [Latitude] float NULL;
//             IF COL_LENGTH('dbo.JobCardPhotos', 'Longitude') IS NULL
//                 ALTER TABLE [dbo].[JobCardPhotos] ADD [Longitude] float NULL;
//             IF COL_LENGTH('dbo.JobCardPhotos', 'PartSuggestionId') IS NULL
//                 ALTER TABLE [dbo].[JobCardPhotos] ADD [PartSuggestionId] UNIQUEIDENTIFIER NULL;
//             IF COL_LENGTH('JobCards', 'BaplJobTypeId') IS NULL
//                 ALTER TABLE JobCards ADD BaplJobTypeId INT NULL;
//             IF COL_LENGTH('JobCards', 'BaplJobSourceId') IS NULL
//                 ALTER TABLE JobCards ADD BaplJobSourceId INT NULL;
//             IF COL_LENGTH('JobCards', 'BaplJobSourceName') IS NULL
//                 ALTER TABLE JobCards ADD BaplJobSourceName NVARCHAR(60) NULL;
//             IF COL_LENGTH('JobCards', 'BaplServiceHeadId') IS NULL
//                 ALTER TABLE JobCards ADD BaplServiceHeadId INT NULL;
//             IF COL_LENGTH('JobCards', 'BaplServiceHeadName') IS NULL
//                 ALTER TABLE JobCards ADD BaplServiceHeadName NVARCHAR(120) NULL;
//             IF COL_LENGTH('JobCards', 'BaplServiceTypeId') IS NULL
//                 ALTER TABLE JobCards ADD BaplServiceTypeId INT NULL;
//             IF COL_LENGTH('JobCards', 'BaplServiceTypeName') IS NULL
//                 ALTER TABLE JobCards ADD BaplServiceTypeName NVARCHAR(120) NULL;
//             IF COL_LENGTH('JobCards', 'BaplServiceLocationCode') IS NULL
//                 ALTER TABLE JobCards ADD BaplServiceLocationCode NVARCHAR(20) NULL;
//             IF COL_LENGTH('JobCards', 'BaplJobCardHeaderId') IS NULL
//                 ALTER TABLE JobCards ADD BaplJobCardHeaderId INT NULL;
//             IF COL_LENGTH('JobCards', 'BaplJobNo') IS NULL
//                 ALTER TABLE JobCards ADD BaplJobNo INT NULL;
//             IF COL_LENGTH('JobCards', 'BaplSyncStatus') IS NULL
//                 ALTER TABLE JobCards ADD BaplSyncStatus NVARCHAR(20) NULL;
//             IF COL_LENGTH('JobCards', 'BaplSyncError') IS NULL
//                 ALTER TABLE JobCards ADD BaplSyncError NVARCHAR(1000) NULL;
//             IF COL_LENGTH('JobCards', 'AssignedTechnicianName') IS NULL
//                 ALTER TABLE JobCards ADD AssignedTechnicianName NVARCHAR(120) NULL;
//             IF OBJECT_ID('dbo.JobCardPartSuggestions', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.JobCardPartSuggestions (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     JobCardId UNIQUEIDENTIFIER NOT NULL,
//                     ItemCode NVARCHAR(60) NOT NULL,
//                     AvailableQtyAtSuggestion INT NULL,
//                     Status NVARCHAR(20) NOT NULL DEFAULT 'Paid',
//                     SuggestedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     CONSTRAINT FK_JobCardPartSuggestions_JobCards FOREIGN KEY (JobCardId) REFERENCES dbo.JobCards(Id) ON DELETE CASCADE,
//                     CONSTRAINT FK_JobCardPartSuggestions_Users FOREIGN KEY (SuggestedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE INDEX IX_JobCardPartSuggestions_JobCardId ON dbo.JobCardPartSuggestions(JobCardId);
//             END
//             IF COL_LENGTH('dbo.JobCardPartSuggestions', 'AvailableQtyAtSuggestion') IS NULL
//                 ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [AvailableQtyAtSuggestion] INT NULL;
//             IF COL_LENGTH('dbo.JobCardPartSuggestions', 'SuggestedById') IS NULL
//                 ALTER TABLE [dbo].[JobCardPartSuggestions] ADD [SuggestedById] UNIQUEIDENTIFIER NULL;
//             IF COL_LENGTH('dbo.JobCardPartSuggestions', 'SuggestedById') IS NOT NULL
//                AND NOT EXISTS (
//                    SELECT 1 FROM sys.foreign_keys
//                    WHERE name = 'FK_JobCardPartSuggestions_Users' AND parent_object_id = OBJECT_ID('dbo.JobCardPartSuggestions')
//                )
//             BEGIN
//                 ALTER TABLE [dbo].[JobCardPartSuggestions]
//                     ADD CONSTRAINT [FK_JobCardPartSuggestions_Users] FOREIGN KEY ([SuggestedById]) REFERENCES [dbo].[Users]([Id]);
//             END
//             IF NOT EXISTS (
//                 SELECT 1 FROM sys.indexes WHERE name = 'IX_Invoices_JobCardId' AND object_id = OBJECT_ID('dbo.Invoices')
//             )
//             BEGIN
//                 CREATE UNIQUE INDEX [IX_Invoices_JobCardId] ON [dbo].[Invoices] ([JobCardId]);
//             END

//             -- ---- from add-jobcard-labour-suggestions-table.sql ----
//             IF OBJECT_ID('dbo.JobCardLabourSuggestions', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.JobCardLabourSuggestions (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     JobCardId UNIQUEIDENTIFIER NOT NULL,
//                     LabourCode NVARCHAR(60) NOT NULL,
//                     LabourDescription NVARCHAR(400) NULL,
//                     HsnCode NVARCHAR(20) NULL,
//                     Sgst DECIMAL(5,2) NULL,
//                     Cgst DECIMAL(5,2) NULL,
//                     Igst DECIMAL(5,2) NULL,
//                     RateAtSuggestion DECIMAL(12,2) NULL,
//                     Quantity INT NOT NULL DEFAULT 1,
//                     IssueType NVARCHAR(120) NULL,
//                     SuggestedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     CONSTRAINT FK_JobCardLabourSuggestions_JobCards FOREIGN KEY (JobCardId) REFERENCES dbo.JobCards(Id) ON DELETE CASCADE,
//                     CONSTRAINT FK_JobCardLabourSuggestions_Users FOREIGN KEY (SuggestedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE INDEX IX_JobCardLabourSuggestions_JobCardId ON dbo.JobCardLabourSuggestions(JobCardId);
//             END
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'LabourDescription') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [LabourDescription] NVARCHAR(400) NULL;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'HsnCode') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [HsnCode] NVARCHAR(20) NULL;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'Sgst') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [Sgst] DECIMAL(5,2) NULL;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'Cgst') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [Cgst] DECIMAL(5,2) NULL;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'Igst') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [Igst] DECIMAL(5,2) NULL;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'RateAtSuggestion') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [RateAtSuggestion] DECIMAL(12,2) NULL;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'Quantity') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [Quantity] INT NOT NULL DEFAULT 1;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'IssueType') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [IssueType] NVARCHAR(120) NULL;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'SuggestedById') IS NULL
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions] ADD [SuggestedById] UNIQUEIDENTIFIER NULL;
//             IF COL_LENGTH('dbo.JobCardLabourSuggestions', 'SuggestedById') IS NOT NULL
//                AND NOT EXISTS (
//                    SELECT 1 FROM sys.foreign_keys
//                    WHERE name = 'FK_JobCardLabourSuggestions_Users' AND parent_object_id = OBJECT_ID('dbo.JobCardLabourSuggestions')
//                )
//             BEGIN
//                 ALTER TABLE [dbo].[JobCardLabourSuggestions]
//                     ADD CONSTRAINT [FK_JobCardLabourSuggestions_Users] FOREIGN KEY ([SuggestedById]) REFERENCES [dbo].[Users]([Id]);
//             END
//             IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_JobCardLabourSuggestions_JobCardId' AND object_id = OBJECT_ID('dbo.JobCardLabourSuggestions'))
//                 CREATE INDEX IX_JobCardLabourSuggestions_JobCardId ON dbo.JobCardLabourSuggestions(JobCardId);

//             -- ---- from redefine-workflow-stages-to-7-steps.sql ----
//             UPDATE dbo.WorkflowStages SET Label = 'Vehicle Check-In / Job Card Created', Seq = 1, Active = 1, IsTerminal = 0
//                 WHERE DealerId IS NULL AND StageKey = 'check_in';
//             UPDATE dbo.WorkflowStages SET Label = 'Work In Progress', Seq = 2, Active = 1, IsTerminal = 0
//                 WHERE DealerId IS NULL AND StageKey = 'in_repair';
//             UPDATE dbo.WorkflowStages SET Label = 'Repair Completed', Active = 1, IsTerminal = 0
//                 WHERE DealerId IS NULL AND StageKey = 'repair_completed';
//             UPDATE dbo.WorkflowStages SET Label = 'Ready for Delivery', Active = 1, IsTerminal = 0
//                 WHERE DealerId IS NULL AND StageKey = 'ready_for_delivery';
//             UPDATE dbo.WorkflowStages SET Label = 'Invoice Generated', Active = 1, IsTerminal = 1
//                 WHERE DealerId IS NULL AND StageKey = 'invoice_generated';
//             IF NOT EXISTS (SELECT 1 FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'part_suggestion')
//                 INSERT INTO dbo.WorkflowStages (Id, DealerId, StageKey, Label, Seq, Icon, Active, IsTerminal, CreatedAt)
//                 VALUES (NEWID(), NULL, 'part_suggestion', 'Part Suggestion', 3, 'package', 1, 0, SYSUTCDATETIME());
//             IF NOT EXISTS (SELECT 1 FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'labour_suggestion')
//                 INSERT INTO dbo.WorkflowStages (Id, DealerId, StageKey, Label, Seq, Icon, Active, IsTerminal, CreatedAt)
//                 VALUES (NEWID(), NULL, 'labour_suggestion', 'Labour Suggestion', 4, 'tool', 1, 0, SYSUTCDATETIME());
//             UPDATE dbo.WorkflowStages SET Active = 0
//                 WHERE DealerId IS NULL AND StageKey IN ('job_card_created', 'inspection', 'diagnosis', 'estimate_prep', 'customer_approval',
//                                     'parts_requested', 'parts_issued', 'quality_check', 'rework', 'closed');

//             -- ---- NEW: 'Estimate Created' stage, inserted right after Labour Suggestion ----
//             IF NOT EXISTS (SELECT 1 FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'estimate_created')
//                 INSERT INTO dbo.WorkflowStages (Id, DealerId, StageKey, Label, Seq, Icon, Active, IsTerminal, CreatedAt)
//                 VALUES (NEWID(), NULL, 'estimate_created', 'Estimate Created', 5, 'file-text', 1, 0, SYSUTCDATETIME());
//             -- Final order: 1 check_in, 2 in_repair, 3 part_suggestion, 4 labour_suggestion,
//             -- 5 estimate_created, 6 repair_completed, 7 ready_for_delivery, 8 invoice_generated.
//             UPDATE dbo.WorkflowStages SET Seq = 6 WHERE DealerId IS NULL AND StageKey = 'repair_completed';
//             UPDATE dbo.WorkflowStages SET Seq = 7 WHERE DealerId IS NULL AND StageKey = 'ready_for_delivery';
//             UPDATE dbo.WorkflowStages SET Seq = 8 WHERE DealerId IS NULL AND StageKey = 'invoice_generated';

//             -- Re-point any job card still sitting on a now-retired GLOBAL stage onto its nearest
//             -- surviving replacement (history rows are left untouched - see
//             -- redefine-workflow-stages-to-7-steps.sql's own step 4 for the full narrative).
//             DECLARE @checkIn UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'check_in');
//             DECLARE @inRepair UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'in_repair');
//             DECLARE @partSuggestion UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'part_suggestion');
//             DECLARE @repairCompleted UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'repair_completed');
//             DECLARE @invoiceGenerated UNIQUEIDENTIFIER = (SELECT Id FROM dbo.WorkflowStages WHERE DealerId IS NULL AND StageKey = 'invoice_generated');
//             UPDATE j SET CurrentStageId = @checkIn
//                 FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
//                 WHERE s.DealerId IS NULL AND s.StageKey = 'job_card_created';
//             UPDATE j SET CurrentStageId = @inRepair
//                 FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
//                 WHERE s.DealerId IS NULL AND s.StageKey IN ('inspection', 'diagnosis', 'estimate_prep', 'customer_approval');
//             UPDATE j SET CurrentStageId = @partSuggestion
//                 FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
//                 WHERE s.DealerId IS NULL AND s.StageKey IN ('parts_requested', 'parts_issued');
//             UPDATE j SET CurrentStageId = @repairCompleted
//                 FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
//                 WHERE s.DealerId IS NULL AND s.StageKey IN ('quality_check', 'rework');
//             UPDATE j SET CurrentStageId = @invoiceGenerated
//                 FROM dbo.JobCards j JOIN dbo.WorkflowStages s ON j.CurrentStageId = s.Id
//                 WHERE s.DealerId IS NULL AND s.StageKey = 'closed';
//         ");
//         Console.WriteLine("[Startup] Self-healing schema catch-up (BAPL columns, Labour Suggestions table, 8-step workflow) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: self-healing schema catch-up failed - {ex.Message}");
//     }
// }

// // ---- wave 1 block: EXTENDED BATTERY WARRANTY SCHEME (2026-09-22) - "needs to create warenty
// // table in jobcardscanner db for this functionality and add this in our function". Own try/catch
// // block, separate from the others, so a failure here (or in any other block) never blocks any
// // other block from running - same isolation convention already used throughout this file. See
// // Models/ExtendedBatteryWarrantySchemes.cs for the table's full field-by-field reasoning and
// // Models/RepairBillDocs.cs (RepairBillDocItem) for the two new nullable tag-only columns.
// //
// // NOTE (2026-10-01 cleanup): RunOemModelCatchUpAsync (further below) ALTERs the table this block
// // CREATEs, so it's awaited in wave 1 and RunOemModelCatchUpAsync runs after it, not concurrently.
// async Task RunExtendedBatteryWarrantySchemeCatchUpAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             IF OBJECT_ID('dbo.ExtendedBatteryWarrantySchemes', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.ExtendedBatteryWarrantySchemes (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     DealerId UNIQUEIDENTIFIER NOT NULL,
//                     SchemeName NVARCHAR(150) NOT NULL,
//                     VehicleModel NVARCHAR(100) NOT NULL,
//                     RateType NVARCHAR(60) NULL,
//                     Duration INT NOT NULL DEFAULT (0),
//                     DurationType NVARCHAR(10) NOT NULL DEFAULT ('Months'),
//                     Kms DECIMAL(10,2) NOT NULL DEFAULT (0),
//                     DealerPrice DECIMAL(12,2) NOT NULL DEFAULT (0),
//                     CustomerPrice DECIMAL(12,2) NOT NULL DEFAULT (0),
//                     DiscountAmount DECIMAL(12,2) NOT NULL DEFAULT (0),
//                     GstPercent DECIMAL(5,2) NOT NULL DEFAULT (0),
//                     PurchaseValidityDays INT NULL,
//                     BatteryPartCode NVARCHAR(60) NULL,
//                     PartCode NVARCHAR(60) NULL,
//                     FromDate DATE NOT NULL,
//                     ToDate DATE NULL,
//                     IsActive BIT NOT NULL DEFAULT (1),
//                     CreatedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     UpdatedById UNIQUEIDENTIFIER NULL,
//                     UpdatedAt DATETIME2 NULL,
//                     CONSTRAINT FK_ExtendedBatteryWarrantySchemes_Dealers FOREIGN KEY (DealerId) REFERENCES dbo.Dealers(Id),
//                     CONSTRAINT FK_ExtendedBatteryWarrantySchemes_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
//                     CONSTRAINT FK_ExtendedBatteryWarrantySchemes_UpdatedBy FOREIGN KEY (UpdatedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE INDEX IX_ExtendedBatteryWarrantySchemes_DealerId_VehicleModel ON dbo.ExtendedBatteryWarrantySchemes(DealerId, VehicleModel);
//             END

//             IF COL_LENGTH('dbo.RepairBillDocItems', 'ExtendedBatteryWarrantySchemeId') IS NULL
//                 ALTER TABLE [dbo].[RepairBillDocItems] ADD [ExtendedBatteryWarrantySchemeId] UNIQUEIDENTIFIER NULL;
//             IF COL_LENGTH('dbo.RepairBillDocItems', 'IsUnderExtendedWarranty') IS NULL
//                 ALTER TABLE [dbo].[RepairBillDocItems] ADD [IsUnderExtendedWarranty] BIT NULL;
//             IF COL_LENGTH('dbo.RepairBillDocItems', 'ExtendedBatteryWarrantySchemeId') IS NOT NULL
//                AND OBJECT_ID('dbo.ExtendedBatteryWarrantySchemes', 'U') IS NOT NULL
//                AND NOT EXISTS (
//                    SELECT 1 FROM sys.foreign_keys
//                    WHERE name = 'FK_RepairBillDocItems_ExtendedBatteryWarrantySchemes' AND parent_object_id = OBJECT_ID('dbo.RepairBillDocItems')
//                )
//             BEGIN
//                 ALTER TABLE [dbo].[RepairBillDocItems]
//                     ADD CONSTRAINT [FK_RepairBillDocItems_ExtendedBatteryWarrantySchemes]
//                     FOREIGN KEY ([ExtendedBatteryWarrantySchemeId]) REFERENCES [dbo].[ExtendedBatteryWarrantySchemes]([Id]);
//             END
//             IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RepairBillDocItems_ExtendedBatteryWarrantySchemeId' AND object_id = OBJECT_ID('dbo.RepairBillDocItems'))
//                 CREATE INDEX IX_RepairBillDocItems_ExtendedBatteryWarrantySchemeId ON dbo.RepairBillDocItems(ExtendedBatteryWarrantySchemeId);
//         ");
//         Console.WriteLine("[Startup] Self-healing schema catch-up (ExtendedBatteryWarrantySchemes table + RepairBillDocItems tag columns) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: ExtendedBatteryWarrantySchemes schema catch-up failed - {ex.Message}");
//     }
// }

// // ---- wave 2 block (runs AFTER wave 1 - see dependency note above): OEM MODEL MASTER + OEM MODEL
// // WARRANTY (2026-09-22) - "this wants to integrate for my battery-warranty-schemes for link models
// // for warrenty and this all table add in jobcard db that all functionality need to craete in jc".
// // Own try/catch block, separate from the others, for the same isolation reason as every other
// // block in this file. See Models/OemModels.cs for the full field-by-field reasoning (ported from
// // the DMS reference's OemmodelMaster/OemmodelWarranty tables) and
// // Models/ExtendedBatteryWarrantySchemes.cs for the new OemModelId column added there to link the
// // two features together.
// async Task RunOemModelCatchUpAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             IF OBJECT_ID('dbo.OemModels', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.OemModels (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     ModelName NVARCHAR(100) NOT NULL,
//                     ModelShortName NVARCHAR(30) NULL,
//                     IsActive BIT NOT NULL DEFAULT (1),
//                     CreatedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     UpdatedById UNIQUEIDENTIFIER NULL,
//                     UpdatedAt DATETIME2 NULL,
//                     CONSTRAINT FK_OemModels_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
//                     CONSTRAINT FK_OemModels_UpdatedBy FOREIGN KEY (UpdatedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE UNIQUE INDEX IX_OemModels_ModelName ON dbo.OemModels(ModelName);
//             END

//             IF OBJECT_ID('dbo.OemModelWarranties', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.OemModelWarranties (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     OemModelId UNIQUEIDENTIFIER NOT NULL,
//                     EffectiveDate DATE NOT NULL,
//                     OdoReading DECIMAL(10,2) NULL,
//                     DurationType NVARCHAR(10) NULL,
//                     Duration DECIMAL(10,2) NULL,
//                     IsB2b BIT NULL,
//                     CreatedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     UpdatedById UNIQUEIDENTIFIER NULL,
//                     UpdatedAt DATETIME2 NULL,
//                     CONSTRAINT FK_OemModelWarranties_OemModels FOREIGN KEY (OemModelId) REFERENCES dbo.OemModels(Id) ON DELETE CASCADE,
//                     CONSTRAINT FK_OemModelWarranties_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
//                     CONSTRAINT FK_OemModelWarranties_UpdatedBy FOREIGN KEY (UpdatedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE INDEX IX_OemModelWarranties_OemModelId_EffectiveDate ON dbo.OemModelWarranties(OemModelId, EffectiveDate);
//             END

//             IF COL_LENGTH('dbo.ExtendedBatteryWarrantySchemes', 'OemModelId') IS NULL
//                 ALTER TABLE [dbo].[ExtendedBatteryWarrantySchemes] ADD [OemModelId] UNIQUEIDENTIFIER NULL;
//             IF COL_LENGTH('dbo.ExtendedBatteryWarrantySchemes', 'OemModelId') IS NOT NULL
//                AND OBJECT_ID('dbo.OemModels', 'U') IS NOT NULL
//                AND NOT EXISTS (
//                    SELECT 1 FROM sys.foreign_keys
//                    WHERE name = 'FK_ExtendedBatteryWarrantySchemes_OemModels' AND parent_object_id = OBJECT_ID('dbo.ExtendedBatteryWarrantySchemes')
//                )
//             BEGIN
//                 ALTER TABLE [dbo].[ExtendedBatteryWarrantySchemes]
//                     ADD CONSTRAINT [FK_ExtendedBatteryWarrantySchemes_OemModels]
//                     FOREIGN KEY ([OemModelId]) REFERENCES [dbo].[OemModels]([Id]);
//             END
//             IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ExtendedBatteryWarrantySchemes_OemModelId' AND object_id = OBJECT_ID('dbo.ExtendedBatteryWarrantySchemes'))
//                 CREATE INDEX IX_ExtendedBatteryWarrantySchemes_OemModelId ON dbo.ExtendedBatteryWarrantySchemes(OemModelId);
//         ");
//         Console.WriteLine("[Startup] Self-healing schema catch-up (OemModels + OemModelWarranties tables + ExtendedBatteryWarrantySchemes.OemModelId column) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: OemModels/OemModelWarranties schema catch-up failed - {ex.Message}");
//     }
// }

// // ---- wave 2 block (runs AFTER wave 1 - see dependency note above): COLUMN TYPE-REPAIR
// // (2026-09-03) - the IF OBJECT_ID(...)/COL_LENGTH(...) guards in the blocks above only detect a
// // MISSING table/column - they cannot detect or fix a column that already exists with the WRONG
// // type. Confirmed live via a pasted server log: on this database, JobCardPartSuggestions.Status is
// // INT (not NVARCHAR(20) as the CREATE TABLE above and the JobCardPartSuggestion C# model assume),
// // so every "Add Suggestion" save under Part Suggestion failed with "Conversion failed when
// // converting the nvarchar value 'Paid' to data type int." - the app always writes the string
// // 'Paid' or 'U/W' into this column (see AddPartSuggestion's req.Status check in
// // JobCardsController.cs). This almost certainly happened because JobCardPartSuggestions already
// // existed - created earlier by a different ad hoc script with Status typed as INT - before this
// // app's own guarded CREATE TABLE ever ran, so IF OBJECT_ID(...) IS NULL was already false and the
// // correct NVARCHAR(20) definition was silently never applied. This is a SEPARATE try/catch block
// // (its own ExecuteSqlRawAsync call), not folded into RunBaplColumnsLabourWorkflowCatchUpAsync
// // above, because a mid-batch error aborts every remaining statement in that same batch - a bug
// // here must not be able to prevent the BAPL-columns/Labour-table/workflow-stage statements above
// // it from applying.
// async Task RunPartSuggestionStatusTypeRepairAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             DECLARE @actualType NVARCHAR(50);
//             SELECT @actualType = ty.name
//                 FROM sys.columns c
//                 JOIN sys.types ty ON c.user_type_id = ty.user_type_id
//                 WHERE c.object_id = OBJECT_ID('dbo.JobCardPartSuggestions') AND c.name = 'Status';

//             IF @actualType IS NOT NULL AND @actualType <> 'nvarchar'
//             BEGIN
//                 -- Drop any default constraint bound to Status first - ALTER COLUMN fails while one
//                 -- is attached, and the constraint's autogenerated name isn't known up front.
//                 DECLARE @dfName SYSNAME, @dynSql NVARCHAR(400);
//                 SELECT @dfName = dc.name
//                     FROM sys.default_constraints dc
//                     JOIN sys.columns c ON c.default_object_id = dc.object_id
//                     WHERE dc.parent_object_id = OBJECT_ID('dbo.JobCardPartSuggestions') AND c.name = 'Status';
//                 IF @dfName IS NOT NULL
//                 BEGIN
//                     SET @dynSql = N'ALTER TABLE [dbo].[JobCardPartSuggestions] DROP CONSTRAINT [' + @dfName + N']';
//                     EXEC sp_executesql @dynSql;
//                 END

//                 -- Widen first (int -> nvarchar(20) is a safe conversion - SQL Server turns each
//                 -- existing value into its string form automatically) and only translate values
//                 -- afterwards - doing the value translation while the column is still INT would
//                 -- throw this exact same conversion error.
//                 ALTER TABLE [dbo].[JobCardPartSuggestions] ALTER COLUMN [Status] NVARCHAR(20) NULL;

//                 -- Legacy numeric-as-string values -> the two values the app actually understands
//                 -- (AddPartSuggestion rejects anything else - req.Status must be 'Paid' or 'U/W').
//                 -- Adjust this mapping if this dealer's original int codes meant something else;
//                 -- anything unrecognized falls back to 'Paid' rather than being left in a state the
//                 -- UI/API can't handle.
//                 UPDATE [dbo].[JobCardPartSuggestions]
//                     SET [Status] = CASE
//                         WHEN [Status] IN ('Paid', 'U/W') THEN [Status]
//                         WHEN [Status] IN ('2', 'UW', 'U-W', 'Warranty') THEN 'U/W'
//                         ELSE 'Paid'
//                     END;

//                 ALTER TABLE [dbo].[JobCardPartSuggestions] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
//                 ALTER TABLE [dbo].[JobCardPartSuggestions]
//                     ADD CONSTRAINT [DF_JobCardPartSuggestions_Status] DEFAULT ('Paid') FOR [Status];
//             END
//         ");
//         Console.WriteLine("[Startup] Column type-repair (JobCardPartSuggestions.Status) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: JobCardPartSuggestions.Status type-repair failed - {ex.Message}");
//     }
// }

// // ---- wave 1 block: MATERIAL TRANSFER LABOUR (2026-09-22) - "which Rate Type * is Partwise from
// // this we upload FOR Part Code add Labour Code also that was wants to integrate in material
// // transfer which in video ... give proper code like vide functionality in mobile and for web
// // both" - confirmed against the mt-labour_add.mp4 recording of the real BGauss DMS
// // (mydmsconnect.com/MtrlTranN.aspx): a "Labour" button on the Material Transfer entry, scoped to
// // the currently-picked Part Code, opens a "Part wise Labour Detail" popup backed by Labour Master
// // Partwise (DMSBAPLDATA's own LabourMasterPartwise table - see LabourMasterController.cs's new
// // by-part-code endpoint). Own try/catch block for the same isolation reason as every other block
// // in this file. See MaterialTransferDocItem.ItemType/TechnicianId's own doc comments in
// // Models/MaterialTransferDocs.cs.
// async Task RunMaterialTransferLabourCatchUpAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             IF COL_LENGTH('dbo.MaterialTransferDocItems', 'ItemType') IS NULL
//                 ALTER TABLE [dbo].[MaterialTransferDocItems] ADD [ItemType] NVARCHAR(20) NOT NULL DEFAULT ('Part');
//             IF COL_LENGTH('dbo.MaterialTransferDocItems', 'TechnicianId') IS NULL
//                 ALTER TABLE [dbo].[MaterialTransferDocItems] ADD [TechnicianId] UNIQUEIDENTIFIER NULL;
//             IF COL_LENGTH('dbo.MaterialTransferDocItems', 'TechnicianId') IS NOT NULL
//                AND NOT EXISTS (
//                    SELECT 1 FROM sys.foreign_keys
//                    WHERE name = 'FK_MaterialTransferDocItems_Technician' AND parent_object_id = OBJECT_ID('dbo.MaterialTransferDocItems')
//                )
//             BEGIN
//                 ALTER TABLE [dbo].[MaterialTransferDocItems]
//                     ADD CONSTRAINT [FK_MaterialTransferDocItems_Technician]
//                     FOREIGN KEY ([TechnicianId]) REFERENCES [dbo].[Users]([Id]);
//             END
//         ");
//         Console.WriteLine("[Startup] Self-healing schema catch-up (MaterialTransferDocItems.ItemType/TechnicianId columns) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: MaterialTransferDocItems ItemType/TechnicianId schema catch-up failed - {ex.Message}");
//     }
// }

// // ---- wave 1 block: TECHNICIAN EMPLOYEE (2026-09-24) - "this technician dont want to bid username
// // and password for that location wants to create technician" - the new login-less Technicians
// // table (see Models/Technicians.cs's own doc comment). Own try/catch block for the same isolation
// // reason as every other block in this file. NOTE: unrelated to
// // MaterialTransferDocItems.TechnicianId above (a pre-existing, different feature that FKs to
// // Users, not to this new table) - deliberately not touched.
// async Task RunTechnicianEmployeeCatchUpAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             IF OBJECT_ID('dbo.Technicians', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.Technicians (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     DealerId UNIQUEIDENTIFIER NOT NULL,
//                     Name NVARCHAR(150) NOT NULL,
//                     LocationCode NVARCHAR(20) NOT NULL,
//                     LocationName NVARCHAR(200) NULL,
//                     Active BIT NOT NULL DEFAULT (1),
//                     CreatedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     CONSTRAINT FK_Technicians_Dealers FOREIGN KEY (DealerId) REFERENCES dbo.Dealers(Id),
//                     CONSTRAINT FK_Technicians_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE INDEX IX_Technicians_DealerId_LocationCode ON dbo.Technicians(DealerId, LocationCode);
//             END
//         ");
//         Console.WriteLine("[Startup] Self-healing schema catch-up (Technicians table) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: Technicians schema catch-up failed - {ex.Message}");
//     }
// }

// // ---- wave 1 block: SERVICE MENU MASTER + COMPLAINT MASTER + PREFIX MASTER (2026-09-30, SECTION
// // 163) - "wants to create 1. service menu master 2. Complain master 3. Prefix Master". Own
// // try/catch block, same isolation convention as every other block in this file - a failure here
// // never blocks the app from starting or blocks any other schema block from running. See
// // Models/ServiceMenuMaster.cs, Models/ComplaintMaster.cs and Models/DocPrefixMaster.cs for full
// // field-by-field reasoning, including the flagged Assumption on Priority's data shape and the
// // flagged decision to keep the Prefix Master decoupled from the existing (unseen in this session)
// // JobCardNumberingService.
// async Task RunServiceMenuComplaintPrefixCatchUpAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             IF OBJECT_ID('dbo.ServiceMenuMasters', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.ServiceMenuMasters (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     JobTypeId INT NOT NULL,
//                     JobTypeName NVARCHAR(60) NOT NULL,
//                     ServiceHeadId INT NOT NULL,
//                     ServiceHeadName NVARCHAR(120) NOT NULL,
//                     PriorityValue NVARCHAR(10) NOT NULL,
//                     PriorityLabel NVARCHAR(30) NOT NULL,
//                     SortOrder INT NOT NULL DEFAULT (0),
//                     IsActive BIT NOT NULL DEFAULT (1),
//                     CreatedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     UpdatedById UNIQUEIDENTIFIER NULL,
//                     UpdatedAt DATETIME2 NULL,
//                     CONSTRAINT FK_ServiceMenuMasters_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
//                     CONSTRAINT FK_ServiceMenuMasters_UpdatedBy FOREIGN KEY (UpdatedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE UNIQUE INDEX IX_ServiceMenuMasters_JobType_ServiceHead_Priority ON dbo.ServiceMenuMasters(JobTypeId, ServiceHeadId, PriorityValue);
//             END

//             IF OBJECT_ID('dbo.ComplaintMasters', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.ComplaintMasters (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     ComplaintText NVARCHAR(300) NOT NULL,
//                     SortOrder INT NOT NULL DEFAULT (0),
//                     IsActive BIT NOT NULL DEFAULT (1),
//                     CreatedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     UpdatedById UNIQUEIDENTIFIER NULL,
//                     UpdatedAt DATETIME2 NULL,
//                     CONSTRAINT FK_ComplaintMasters_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
//                     CONSTRAINT FK_ComplaintMasters_UpdatedBy FOREIGN KEY (UpdatedById) REFERENCES dbo.Users(Id)
//                 );
//             END

//             IF OBJECT_ID('dbo.DocPrefixMasters', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.DocPrefixMasters (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     DocType NVARCHAR(10) NOT NULL,
//                     Prefix NVARCHAR(10) NOT NULL,
//                     IsActive BIT NOT NULL DEFAULT (1),
//                     CreatedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     UpdatedById UNIQUEIDENTIFIER NULL,
//                     UpdatedAt DATETIME2 NULL,
//                     CONSTRAINT FK_DocPrefixMasters_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
//                     CONSTRAINT FK_DocPrefixMasters_UpdatedBy FOREIGN KEY (UpdatedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE UNIQUE INDEX IX_DocPrefixMasters_DocType ON dbo.DocPrefixMasters(DocType);

//                 -- Seed the 3 document types you named, using the exact prefixes from your example
//                 -- (JC/26-25/0001, MT/26-25/0001, RB/26-25/0001). You can UPDATE these rows any time
//                 -- via SQL - this INSERT only runs once, the first time the table is created.
//                 INSERT INTO dbo.DocPrefixMasters (Id, DocType, Prefix, IsActive, CreatedAt) VALUES
//                     (NEWID(), 'JC', 'JC', 1, SYSUTCDATETIME()),
//                     (NEWID(), 'MT', 'MT', 1, SYSUTCDATETIME()),
//                     (NEWID(), 'RB', 'RB', 1, SYSUTCDATETIME());
//             END

//             IF OBJECT_ID('dbo.DocNumberSequences', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.DocNumberSequences (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     DocType NVARCHAR(10) NOT NULL,
//                     FinancialYear NVARCHAR(10) NOT NULL,
//                     LastSequence INT NOT NULL DEFAULT (0),
//                     UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
//                 );
//                 CREATE UNIQUE INDEX IX_DocNumberSequences_DocType_FY ON dbo.DocNumberSequences(DocType, FinancialYear);
//             END
//         ");
//         Console.WriteLine("[Startup] Self-healing schema catch-up (ServiceMenuMasters + ComplaintMasters + DocPrefixMasters + DocNumberSequences tables) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: ServiceMenuMaster/ComplaintMaster/DocPrefixMaster schema catch-up failed - {ex.Message}");
//     }
// }

// // ---- wave 1 block: MENU ACCESS OVERRIDE + ROLE MENU MODE (SECTION 173, 2026-09-30) - diagnosing
// // "Admin: Menu Access -> Save failed." on the live site (dms.bgauss.com, logged in as
// // SystemAdmin).
// //
// // FACT, confirmed by re-reading this whole file: Models/MenuAccessOverride.cs (SECTION 155,
// // 2026-09-29) and Models/RoleMenuMode.cs (SECTION 170, 2026-09-30) are the ONLY two tables added to
// // JobCardScannerDbContext this entire session that never got a guarded CREATE TABLE block here -
// // every other new table since (PartUploads, Technicians, ServiceMenuMasters, ComplaintMasters,
// // DocPrefixMasters, DocNumberSequences, ExtendedBatteryWarrantySchemes, OemModels, ...) has one.
// // db.Database.EnsureCreatedAsync() near the top of this file only creates schema for a brand-new,
// // completely empty database (see that block's own comment) - it does NOT retroactively add tables
// // to an already-existing database, which dms.bgauss.com clearly is. So on any environment where
// // these two tables were never created some other way, GET /api/menu-access and PUT /api/menu-access
// // (MenuAccessController.cs) would throw a raw SqlException ("Invalid object name
// // 'dbo.MenuAccessOverrides'"/'dbo.RoleMenuModes'") the first time either table is touched.
// //
// // INTERPRETATION, NOT CONFIRMED AS THE CAUSE: the screenshot you sent shows the page's GET load
// // working fine (every item listed, "EVERYONE" defaults) - if MenuAccessOverrides were missing on
// // dms.bgauss.com specifically, that GET would already be failing with its own "Could not load..."
// // banner, not just Save. So either that table already exists there (created some other way) and
// // only RoleMenuModes is missing - its own GET fails silently (fail-open, see MenuAccessPage.tsx's
// // load()), which would explain a Save-time failure with no earlier symptom - or the real cause of
// // THIS specific "Save failed." is something else entirely (e.g. the CorporateAdmin/SystemAdmin role
// // check in MenuAccessController.Put returning Forbid() with an empty body for this login). This
// // block fixes the CONFIRMED gap (both tables missing their self-healing catch-up, unlike every
// // sibling table) regardless - it's a safe, idempotent no-op if both already exist on
// // dms.bgauss.com, and protects every other/future environment (a staging reset, a DR restore, a
// // fresh install) from hitting this same silent gap. It does NOT by itself confirm or rule out
// // what's actually failing on dms.bgauss.com right now - see MenuAccessPage.tsx's own SECTION 173
// // fix (real HTTP status + backend message now shown in the error banner) for how to pin that down
// // next time Save is clicked there.
// async Task RunMenuAccessRoleModeCatchUpAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             IF OBJECT_ID('dbo.MenuAccessOverrides', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.MenuAccessOverrides (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     NavKey NVARCHAR(80) NOT NULL,
//                     RolesCsv NVARCHAR(400) NOT NULL DEFAULT (''),
//                     UpdatedBy NVARCHAR(200) NULL,
//                     UpdatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
//                 );
//                 CREATE UNIQUE INDEX IX_MenuAccessOverrides_NavKey ON dbo.MenuAccessOverrides(NavKey);
//             END

//             IF OBJECT_ID('dbo.RoleMenuModes', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.RoleMenuModes (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     Role NVARCHAR(40) NOT NULL,
//                     OnlyShowChecked BIT NOT NULL DEFAULT (0),
//                     UpdatedBy NVARCHAR(200) NULL,
//                     UpdatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
//                 );
//                 CREATE UNIQUE INDEX IX_RoleMenuModes_Role ON dbo.RoleMenuModes(Role);
//             END
//         ");
//         Console.WriteLine("[Startup] Self-healing schema catch-up (MenuAccessOverrides + RoleMenuModes tables) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: MenuAccessOverride/RoleMenuMode schema catch-up failed - {ex.Message}");
//     }
// }

// // 2026-10-02 (SECTION 188) - "Ledger Master" (Party/Insurance only) - see Models/LedgerMaster.cs
// // for the full reasoning. Runs in WAVE 2 (not wave 1) because, beyond creating its own table, it
// // also seeds a "ledger-master" row into dbo.DocPrefixMasters (IF NOT EXISTS) so Ledger Codes have
// // a Prefix Master row to consume from day one - that seed depends on DocPrefixMasters already
// // existing, which wave 1's RunServiceMenuComplaintPrefixCatchUpAsync is responsible for creating.
// // The seed check here is a data-level "IF NOT EXISTS (SELECT ...)", not an OBJECT_ID check, since
// // DocPrefixMasters itself may already exist with other rows in it (it does, on your real DB - JC/
// // MT/RB were seeded back in SECTION 163) - this only ever adds the ONE new row this feature needs,
// // never touches your existing JC/MT/RB rows.
// //
// // ASSUMPTION FLAGGED: this assumes the SECTION 184 migration (backend/recreate-doc-prefix-master-tables.sql,
// // delivered earlier this session) has already been run against your real DB, so DocPrefixMasters
// // has ModuleKey/UsesFinancialYear columns (not the older DocType-only shape) - if it hasn't, this
// // INSERT will fail with an "Invalid column name" error and the warning below will say so; run that
// // migration first if you see that in your console.
// //
// // SECTION 189 (2026-10-02): added DealerId to the CREATE TABLE below (per-dealer scoping, see
// // Models/LedgerMaster.cs). IF your "Could not save this ledger" error happened because
// // dbo.LedgerMasters was ALREADY created on your DB by the SECTION 188 version of this file (without
// // DealerId) - unlikely if Save was already failing outright, since that usually means the table was
// // never created successfully in the first place, but possible - this guarded CREATE TABLE will NOT
// // retroactively add the column (IF OBJECT_ID(...) IS NULL is now false). Run
// // backend/add-ledgermaster-dealerid-column.sql by hand first in that case; otherwise just restart
// // the backend and this creates the table correctly from scratch.
// async Task RunLedgerMasterCatchUpAsync()
// {
//     using var scope = app.Services.CreateScope();
//     var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
//     try
//     {
//         await db.Database.ExecuteSqlRawAsync(@"
//             IF OBJECT_ID('dbo.LedgerMasters', 'U') IS NULL
//             BEGIN
//                 CREATE TABLE dbo.LedgerMasters (
//                     Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
//                     DealerId UNIQUEIDENTIFIER NOT NULL,
//                     LedgerType NVARCHAR(20) NOT NULL,
//                     LedgerCode NVARCHAR(40) NOT NULL,
//                     LedgerName NVARCHAR(200) NOT NULL,
//                     MobileNumber NVARCHAR(10) NULL,
//                     AlternateMobileNo NVARCHAR(10) NULL,
//                     EMail NVARCHAR(200) NULL,
//                     Address NVARCHAR(400) NULL,
//                     Pin NVARCHAR(10) NULL,
//                     Gstno NVARCHAR(20) NULL,
//                     Pan NVARCHAR(10) NULL,
//                     AadharNumber NVARCHAR(20) NULL,
//                     IsActive BIT NOT NULL DEFAULT (1),
//                     CreatedById UNIQUEIDENTIFIER NULL,
//                     CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
//                     UpdatedById UNIQUEIDENTIFIER NULL,
//                     UpdatedAt DATETIME2 NULL,
//                     CONSTRAINT FK_LedgerMasters_Dealer FOREIGN KEY (DealerId) REFERENCES dbo.Dealers(Id),
//                     CONSTRAINT FK_LedgerMasters_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
//                     CONSTRAINT FK_LedgerMasters_UpdatedBy FOREIGN KEY (UpdatedById) REFERENCES dbo.Users(Id)
//                 );
//                 CREATE UNIQUE INDEX IX_LedgerMasters_LedgerCode ON dbo.LedgerMasters(LedgerCode);
//                 CREATE INDEX IX_LedgerMasters_Dealer_LedgerType ON dbo.LedgerMasters(DealerId, LedgerType);
//             END

//             IF NOT EXISTS (SELECT 1 FROM dbo.DocPrefixMasters WHERE ModuleKey = 'ledger-master')
//             BEGIN
//                 INSERT INTO dbo.DocPrefixMasters (Id, ModuleKey, Prefix, UsesFinancialYear, IsActive, CreatedAt) VALUES
//                     (NEWID(), 'ledger-master', 'LED', 0, 1, SYSUTCDATETIME());
//             END
//         ");
//         Console.WriteLine("[Startup] Self-healing schema catch-up (LedgerMasters table + ledger-master Prefix Master seed) checked/applied.");
//     }
//     catch (Exception ex)
//     {
//         Console.WriteLine($"[Startup] WARNING: LedgerMaster schema catch-up failed - {ex.Message}");
//     }
// }

// Self-healing schema catch-up DISABLED 2026-10-02 at user's request: the schema is already
// fully up to date in production (every ALTER TABLE/CREATE TABLE check in the Run*CatchUpAsync
// functions above has already been applied), and running all of this on every single app start
// was adding a long, unnecessary DB round-trip to startup - on 2026-10-02 one of these blocks
// (RunBaplColumnsLabourWorkflowCatchUpAsync) hung on a SQL Server schema lock long enough to
// blow through IIS's 120-second startup-time-limit (HTTP 500.37 / Event ID 1007), taking the
// whole site down. The Run*CatchUpAsync functions above are left in place, unused, as reference
// in case a future schema change needs this same idempotent-DDL pattern again - they will not
// run unless the Task.WhenAll calls below are restored.
//
// var selfHealStopwatch = Stopwatch.StartNew();
//
// await Task.WhenAll(
//     RunColumnMigrationsAsync(),
//     RunBaplColumnsLabourWorkflowCatchUpAsync(),
//     RunExtendedBatteryWarrantySchemeCatchUpAsync(),
//     RunMaterialTransferLabourCatchUpAsync(),
//     RunTechnicianEmployeeCatchUpAsync(),
//     RunServiceMenuComplaintPrefixCatchUpAsync(),
//     RunMenuAccessRoleModeCatchUpAsync());
//
// await Task.WhenAll(
//     RunOemModelCatchUpAsync(),
//     RunPartSuggestionStatusTypeRepairAsync(),
//     RunLedgerMasterCatchUpAsync());
//
// selfHealStopwatch.Stop();
// Console.WriteLine($"[Startup] All self-healing schema checks complete in {selfHealStopwatch.ElapsedMilliseconds} ms (2 waves, was 9 sequential round-trips before this cleanup).");
Console.WriteLine("[Startup] Self-healing schema catch-up skipped (disabled - schema already up to date in this database).");

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
