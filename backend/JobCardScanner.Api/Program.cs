using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
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
// from wwwroot/uploads/... at the matching /uploads/... URL, plus part-suggestion photos (see
// POST /api/jobcards/{id}/part-suggestions/{suggestionId}/photos/upload). No [Authorize] on
// static files themselves (ASP.NET Core static file middleware doesn't support that) - the file
// names are unguessable GUIDs, same tradeoff as most "public CDN link" photo storage.
Directory.CreateDirectory(Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads", "jobcard-photos"));
Directory.CreateDirectory(Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads", "jobcard-part-photos"));
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

// ---------------------------------------------------------------------
// Schema: real EF Core migrations, not EnsureCreatedAsync()/DbSeeder.
//
// EnsureCreatedAsync() only creates a schema on a database that doesn't exist yet - it can never
// apply an incremental change (a new table, a new column) to a database that's already there, so
// every table added since JobCardScannerDb was first created (JobCardPartSuggestion,
// JobCardPartSuggestionPhoto, JobCardLabourSuggestion, JobCard.AssignedTechnicianName, etc.) would
// silently never appear. MigrateAsync() below applies whatever migrations exist in the
// Migrations/ folder, in order, and is safe to run on every startup - it's a no-op once the
// database is already up to date.
//
// DbSeeder.SeedAsync() (demo dealers/users) is intentionally NOT called here any more. If you
// still want seed data on a brand-new database, run it manually once via a one-off script rather
// than automatically on every startup.
//
// One-time setup, if you haven't already:
//   dotnet ef migrations add InitialCreate
//   dotnet ef database update
// From then on, whenever the model changes:
//   dotnet ef migrations add <DescriptiveName>
// MigrateAsync() below applies it automatically on the next run - no separate `database update`
// step needed in any environment this API itself starts up in.
// ---------------------------------------------------------------------
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
    await db.Database.MigrateAsync();

    var dealerCount = await db.Dealers.CountAsync();
    var userCount = await db.Users.CountAsync();
    Console.WriteLine($"[Startup] Migrations applied. Current counts -> Dealers: {dealerCount}, Users: {userCount}.");
}

app.Run();