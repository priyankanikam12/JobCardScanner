# JobCardScanner API (ASP.NET Core 8)

The backend for JobCardScanner: an EV two-wheeler workshop job card management system.
Dual authentication (Azure AD for staff, mobile+OTP JWT for customers), EF Core Code-First
against SQL Server, and mock ERP/DMS/Notification/OTP integrations built behind swappable
interfaces so a real integration can drop in later without touching the rest of the app.

## About this build

This project was generated in a sandboxed environment whose outbound network access does
not include `api.nuget.org`, so **`dotnet restore` / `dotnet build` could not be run or
verified here**. The C# was written carefully against well-established, stable APIs for the
exact package versions pinned in `JobCardScanner.Api.csproj` (EF Core 8.0.10, Microsoft
.Identity.Web 3.5.0, QuestPDF 2024.10.3, ClosedXML 0.102.3, QRCoder 1.6.0), and was reviewed
line by line for namespace/type/API-surface correctness - but you should run a normal
`dotnet build` yourself as the first step after unzipping, before relying on it, since no
compiler ran over this code before you received it.

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- SQL Server, any of:
  - Docker: `docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourStrong!Passw0rd" -p 1433:1433 --name jobcardscanner-sql -d mcr.microsoft.com/mssql/server:2022-latest`
  - SQL Server LocalDB (Windows, comes with Visual Studio)
  - Any reachable SQL Server / Azure SQL Database instance
- An Azure AD App Registration for staff sign-in - see `../docs/AZURE_AD_SETUP.md`.

## Setup

```bash
cd backend
dotnet restore
dotnet user-secrets init --project JobCardScanner.Api
dotnet user-secrets set "ConnectionStrings:JobCardScannerDb" "Server=localhost,1433;Database=JobCardScanner;User Id=sa;Password=YourStrong!Passw0rd;TrustServerCertificate=True;" --project JobCardScanner.Api
dotnet user-secrets set "AzureAd:TenantId" "<your tenant id>" --project JobCardScanner.Api
dotnet user-secrets set "AzureAd:ClientId" "<your API app registration client id>" --project JobCardScanner.Api
dotnet user-secrets set "AzureAd:Audience" "api://<your API app registration client id>" --project JobCardScanner.Api
dotnet user-secrets set "CustomerPortalJwt:Secret" "<a random 64+ character string>" --project JobCardScanner.Api
dotnet run --project JobCardScanner.Api
```

(User Secrets keeps real values out of `appsettings.json`/source control; for a quick local
test you can instead just edit `appsettings.Development.json` directly - never commit real
secrets there.)

On first run in Development, the app automatically creates the `JobCardScanner` database
schema and seeds demo data (2 dealers, staff across all 8 roles, 6 customers/vehicles,
a spare-parts catalog, and the default 15-stage workflow template) - see
`JobCardScanner.Api/Data/DbSeeder.cs`. The API listens on the URL(s) printed in the console
(typically `https://localhost:5001` / `http://localhost:5000`) and serves Swagger UI at
`/swagger` in Development.

### Listening on all interfaces (for the mobile app)

By default `dotnet run` only binds `localhost`, which an Android emulator/phone cannot
reach. To let the mobile app connect, run with:

```bash
dotnet run --project JobCardScanner.Api --urls "http://0.0.0.0:5000;https://0.0.0.0:5001"
```

## Project layout

```
JobCardScanner.Api/
  Models/          EF Core entities (Dealer, User, Customer, Vehicle, JobCard, Estimate,
                    PartMaster, Invoice, Notifications, audit/integration logs, ...)
  Data/            JobCardScannerDbContext (Fluent API config) + DbSeeder
  Auth/            Dual auth: AzureAd scheme wiring, customer JWT issuance, the
                    AppClaimsTransformation that resolves Azure AD identity -> app role
  Services/        Numbering, invoice PDF (QuestPDF), Excel export (ClosedXML), audit log
  Services/Integrations/  Swappable mock ERP/DMS/Notification/OTP clients + retry/logging base
  Controllers/     All REST endpoints (job cards, estimates, parts, invoices, dashboard,
                    reports, admin, customer portal)
  Dtos/            Request DTOs
schema.sql         Hand-written reference schema (not required - EnsureCreatedAsync builds
                   the same schema from the EF model automatically on first run)
```

## Authentication model

Two independent bearer schemes are registered (see `Program.cs`):

- **`AzureAd`** - staff (web + Android) sign in via Microsoft Entra ID. Azure AD proves
  *identity* only; `Auth/AppClaimsTransformation.cs` looks the signed-in email up in the
  app's own `Users` table and stamps `app_role`/`app_user_id`/`app_dealer_id` claims that
  drive every `[Authorize(Policy = ...)]` check. This means role/dealer assignment is
  managed entirely inside JobCardScanner (Admin > Users), not in the Azure Portal - see
  `../docs/AZURE_AD_SETUP.md` Part 4.
- **`CustomerPortal`** - customers authenticate with mobile number + OTP
  (`Services/Integrations/OtpService.cs`) and receive a short-lived symmetric-key JWT
  (`Auth/CustomerTokenService.cs`). Customers are never Azure AD principals.

Endpoints that must accept either kind of caller (e.g. downloading an invoice PDF) declare
both schemes explicitly: `[Authorize(AuthenticationSchemes = AuthSchemes.AzureAd + "," + AuthSchemes.CustomerPortal)]`.

## Switching a mock integration for a real one

Each of `IErpClient`, `IDmsClient`, `INotificationClient`, `IOtpService` is registered in
`Program.cs` against its `Mock*` implementation. To integrate a real system, implement the
interface against the real API and swap the registration - nothing else in the app needs to
change, since controllers only depend on the interfaces.

## Moving from `EnsureCreatedAsync` to real EF Core migrations

This project ships without a `Migrations/` folder (scaffolding one requires `dotnet ef
migrations add`, which requires `dotnet restore` to have succeeded first - see "About this
build" above). Once you've confirmed the project builds:

```bash
dotnet tool install --global dotnet-ef
dotnet ef migrations add InitialCreate --project JobCardScanner.Api
```

Then change `Program.cs`'s `await db.Database.EnsureCreatedAsync();` to
`await db.Database.MigrateAsync();` so future schema changes are tracked and repeatable -
this is the path to take before deploying against Azure SQL Database or any shared
environment.
