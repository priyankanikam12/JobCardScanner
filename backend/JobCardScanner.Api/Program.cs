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
builder.Services.AddDbContext<JobCardScannerDbContext>(opt =>
    opt.UseSqlServer(builder.Configuration.GetConnectionString("JobCardScannerDb")));

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

app.UseHttpsRedirection();
app.UseCors("AppCors");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// Create the schema and seed demo data automatically on startup in Development, so
// `dotnet run` against a fresh local SQL Server produces a ready-to-use JobCardScanner
// database with zero manual steps.
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
    // NOTHING on every future startup: no Dealers, no WorkflowStages, no seeded admin user, even
    // though the app logs no error at all. That silent no-op is why Users can stay empty forever
    // even though this code looks correct. The logging below makes that state visible instead of
    // silent - if you ever see "0 dealers / 0 users" here again after a startup, the fix is to
    // drop and let this block recreate the database from scratch (see backend/README.md /
    // AZURE_AD_SETUP.md), not to hand-edit tables.
    var wasCreated = await db.Database.EnsureCreatedAsync();
    await DbSeeder.SeedAsync(db);

    var dealerCount = await db.Dealers.CountAsync();
    var userCount = await db.Users.CountAsync();
    Console.WriteLine($"[DbSeeder] EnsureCreatedAsync created a new database: {wasCreated}. Current counts -> Dealers: {dealerCount}, Users: {userCount}.");
    if (dealerCount == 0)
    {
        Console.WriteLine("[DbSeeder] WARNING: Dealers is empty, which means seeding never ran. " +
            "This almost always means the database already existed with some hand-created table " +
            "in it before this app ever touched it, so EnsureCreatedAsync() skipped schema " +
            "creation entirely. Drop the database and restart the API to fix it properly.");
    }
}

app.Run();
