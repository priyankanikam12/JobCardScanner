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
using JobCardScanner.Api.Security;
using QuestPDF.Infrastructure;
using JobCardScanner.Api.Options;
using JobCardScanner.Api.Services.Zoho;

var builder = WebApplication.CreateBuilder(args);

// 2026-10-17 (VAPT): security layer - Security/*.cs
builder.AddAppSecurity();
builder.AddAppSecurityEf();   // 2026-10-23 (VAPT DMS-16): the database part of the session checks

// QuestPDF Community license (free for this use case) - required as of QuestPDF 2023+.
QuestPDF.Settings.License = LicenseType.Community;

// 2026-10-23 (VAPT, found while reviewing this file): the two JWT secrets below used to fall back to a fixed text that is public in this
// source file ("dev-only-insecure-secret-...") when the setting was missing - then anyone could sign a token with any role. Outside Development
// a missing or short (< 32 characters) secret now stops the API from starting instead. Set CustomerPortalJwt__Secret and DealerAuthJwt__Secret
// (32+ random characters) as environment variables / in appsettings.Production.json BEFORE deploying this file.
static string RequireSecret(IConfigurationSection section, IHostEnvironment env)
{
    var value = section["Secret"];
    if (!string.IsNullOrWhiteSpace(value) && value.Length >= 32) return value;
    if (env.IsDevelopment()) return "dev-only-insecure-secret-change-me-min-32-chars";
    throw new InvalidOperationException($"{section.Path}:Secret is missing or shorter than 32 characters - set it before starting the API.");
}

// ---------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------
// EnableRetryOnFailure: your RDS connection occasionally drops mid-query ("An existing connection
// was forcibly closed by the remote host" / SQL error 10054 - a transient network blip, not a bug
// in a query) which otherwise surfaces as a raw 500 on whatever request happened to be running.
// This makes EF Core transparently retry a handful of times before giving up.
builder.Services.AddDbContext<JobCardScannerDbContext>((sp, opt) =>
{
    opt.UseSqlServer(builder.Configuration.GetConnectionString("JobCardScannerDb"),
        sql => sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10), errorNumbersToAdd: null));
    // 2026-10-23 (VAPT DMS-16): a change of a user's role / active flag / dealer / password, or a delete, ends that user's sessions (Security/SessionFreshnessEf.cs)
    opt.AddInterceptors(sp.GetRequiredService<UserChangeRevocationInterceptor>());
});
builder.Services.AddDbContext<CareDeskDbContext>(o =>
    o.UseSqlServer(builder.Configuration.GetConnectionString("CareDeskDb") ?? "Server=.;Database=CareDesk;Trusted_Connection=True",   // placeholder is never used while CareDesk:Enabled is false
                   sql => sql.CommandTimeout(60)));
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

builder.Services.Configure<ZohoBooksOptions>(builder.Configuration.GetSection(ZohoBooksOptions.SectionName));
builder.Services.AddHttpClient<ZohoOAuthTokenService>();
builder.Services.AddSingleton<ZohoOAuthTokenService>();
builder.Services.AddHttpClient<ZohoBooksApiClient>(c => c.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddSingleton<ZohoBooksApiClient>();


// 2026-09-03: DIAGNOSTIC - added while chasing a reported 401 on /api/auth/me from a fresh
// public-IP deploy (https://3.88.172.79). AddMicrosoftIdentityWebApi rejects a bad/invalid token
// with a 401 challenge, but the *reason* (bad signature, wrong audience, expired, clock skew,
// couldn't reach Azure AD's key-fetch endpoint...) only goes to ILogger, which on a plain
// `dotnet MyApp.dll` in a terminal, or a systemd/IIS-hosted process, may not be visible anywhere
// the person deploying this is actually looking. Every other startup check in this file
// (EnsureCreatedAsync) already logs straight to Console.WriteLine
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

    // 2026-10-20: a token issued by the Dealer / Workshop login (issuer = DealerAuthJwt:Issuer) is not an Azure AD token -
    // this scheme steps aside for it (NoResult) instead of rejecting it and logging "Token REJECTED" on every request.
    // Every other token goes through the normal Microsoft.Identity.Web handling (its own OnMessageReceived is still called).
    var previousOnMessageReceived = options.Events.OnMessageReceived;
    options.Events.OnMessageReceived = async context =>
    {
        var header = context.Request.Headers.Authorization.ToString();
        if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var issuer = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(header[7..].Trim()).Issuer;
                if (issuer == builder.Configuration["DealerAuthJwt:Issuer"]) { context.NoResult(); return; }
            }
            catch { /* not a readable JWT - normal validation will report it */ }
        }
        if (previousOnMessageReceived is not null) await previousOnMessageReceived(context);
    };

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
    var secret = RequireSecret(section, builder.Environment);   // 2026-10-23 (VAPT): no public fallback outside Development
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
    var secret = RequireSecret(section, builder.Environment);   // 2026-10-23 (VAPT): no public fallback outside Development
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

    // 2026-10-20: try this scheme only for tokens issued by the dealer login. A Microsoft (Azure AD) token is handled -
    // and accepted - by the AzureAd scheme, so it steps aside (NoResult) instead of logging "IDX10205: Issuer validation failed".
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = ctx =>
        {
            var header = ctx.Request.Headers.Authorization.ToString();
            if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var issuer = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(header[7..].Trim()).Issuer;
                    if (issuer != section["Issuer"]) ctx.NoResult();
                }
                catch { ctx.NoResult(); }
            }
            return Task.CompletedTask;
        }
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
    options.AddPolicy(Policies.ServiceAdvisorUp, p => RoleUp(p, "ServiceAdvisor", "Captain", "ViceCaptain", "Supervisor", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
    options.AddPolicy(Policies.PartsReadUp, p => RoleUp(p, "ServiceAdvisor", "Captain", "ViceCaptain", "PartsUser", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));  
    // options.AddPolicy(Policies.ServiceAdvisorUp, p => RoleUp(p, "ServiceAdvisor", "Supervisor", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin"));
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
    options.AddPolicy("ServiceAdvisorUpNoSupervisor", p => RoleUp(p, "ServiceAdvisor", "WorkshopManager", "DealerAdmin", "CorporateAdmin", "SystemAdmin","Captain","ViceCaptain","PartsUser","Cashier"));   // 2026-10-23 (VAPT): "Supervisor" was in this list although the policy is named NoSupervisor - removed so the SECTION 162 lock is real
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
builder.Services.Configure<CareDeskOptions>(builder.Configuration.GetSection(CareDeskOptions.Section));
builder.Services.AddScoped<ICareDeskService, CareDeskService>();
// SECTION 186 (2026-10-02, "after 1st login 9 hr calculate and log out after 9 hr that
// implememnt properly") - confirmed via AskUserQuestion: Shift 1 staff still checked in at 18:00
// IST get CheckOutTime auto-written as 18:00. See Services/AttendanceAutoCheckoutService.cs's own
// doc comment for the full reasoning (plain poll-loop BackgroundService, not Hangfire/Quartz -
// nothing in this file registers either, so none is assumed to exist).
builder.Services.AddHostedService<AttendanceAutoCheckoutService>();
builder.Services.AddHostedService<ZohoPushDispatcher>();


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
app.UseAppSecurityEarly();   // 2026-10-17 (VAPT): forwarded headers + security headers (DMS-13)

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
app.UseAppRateLimit();        // 2026-10-17 (VAPT): rate limits + failed-login lockout (DMS-11, DMS-12)

// Serves job card photos uploaded via POST /api/jobcards/{id}/photos/upload (JobCardsController)
// from wwwroot/uploads/... at the matching /uploads/... URL. No [Authorize] on static files
// themselves (ASP.NET Core static file middleware doesn't support that). 2026-10-23 (VAPT DMS-14): that is no longer
// the only protection - UseAppStaticFiles (Security/SecurityExtensions.cs) serves /uploads/jobcard-photos only for an
// address with a valid, unexpired signature, which the API adds to every photo address it returns to a signed-in user.
Directory.CreateDirectory(Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads", "jobcard-photos"));

// Default FileExtensionContentTypeProvider doesn't know ".apk" - without this, UseStaticFiles()
// returns a plain 404 for wwwroot/app/JobCardScanner.apk (self-hosted Android distribution,
// see deploy/ANDROID_DEPLOYMENT.md) instead of serving it. Note: web.config's IIS-level
// <staticContent><mimeMap> for .apk has NO effect here - the site's handler mapping forwards
// every request (path="*") to AspNetCoreModuleV2, so IIS's own static file handler never runs;
// this app's own middleware is what actually serves wwwroot.
var staticFileProvider = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
staticFileProvider.Mappings[".apk"] = "application/vnd.android.package-archive";
app.UseAppStaticFiles(staticFileProvider);   // 2026-10-17 (VAPT DMS-06): /uploads only as safe media types, never HTML

app.UseAuthentication();
app.UseAuthorization();
app.UseAppGuards();   // 2026-10-17 (VAPT): route guard + response sanitizer (DMS-01, 02, 04, 05, 09, 10, 12, 15)
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
    var dealerCount = await db.Dealers.CountAsync();
    var userCount = await db.Users.CountAsync();
    Console.WriteLine($"[Startup] EnsureCreatedAsync created a new database: {wasCreated}. Current counts -> Dealers: {dealerCount}, Users: {userCount}.");
}

// 2026-10-20: the self-healing schema catch-up (the Run*CatchUpAsync blocks that applied ALTER/CREATE TABLE on every start)
// was disabled since 2026-10-02 and has been removed from this file. Schema changes ship as SQL scripts (sql/*.sql) run once per database.

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
