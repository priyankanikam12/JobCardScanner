# BGauss DMS - VAPT backend security layer (23.10.2026)

WHY THIS PACKAGE: files such as SignedMedia.cs, ResponseSanitizerMiddleware.cs and JobCardsController.cs need the REST of the Security folder.
Errors like "SecurityOptions / SafeUpload / FinancialInputValidator could not be found" mean the Security folder is not in the project yet.
Copy the whole folder, once. Nothing here changes the database.

## 1. Copy (API project folder = backend/JobCardScanner.Api)
| From this package | To your project |
|---|---|
| Security\*.cs  (12 files) | Security\  (new folder, add all 12) |
| Controllers\SessionController.cs | Controllers\  (new file) |
| Controllers\JobCardsController.cs | replaces your JobCardsController.cs (keep a backup) |
| Controllers\RepairBillDocsController.cs | replaces yours (keep a backup) |

If your JobCardsController.cs / RepairBillDocsController.cs differ from the ones this package was built on, do NOT overwrite: ask for a merge.

## 2. Program.cs
EASIEST: replace your Program.cs with backend\JobCardScanner.Api\Program.cs from this package (built from the file you sent on 23.10.2026: your file + the six security lines + two fixes - see the list below). Keep a backup of yours first.
SET BEFORE STARTING: CustomerPortalJwt__Secret and DealerAuthJwt__Secret (32+ random characters). Outside Development the API now refuses to start without them (before, a public default text was used).
The two fixes besides the six lines: (a) the JWT secrets no longer fall back to a public text; (b) "ServiceAdvisorUpNoSupervisor" no longer lists Supervisor (it was in the list although the policy is named NoSupervisor) - Supervisor logins lose access to the controllers that use that policy (Material Transfer / Repair Bill), as the 30.09.2026 lock intended.

ALTERNATIVE (only the six lines, nothing else) - backup is written first:
    cd backend\JobCardScanner.Api
    node ..\..\patches\apply-program-cs-security.js Program.cs
(if the folders are laid out differently, give the real path of both files). It changes nothing when an anchor is not found.

## 3. Settings (environment variables on the server - NOT appsettings.json)
    Security__MediaSigningKey = <32 or more random characters>     photo links; without it links stop working at every restart
    Security__RouteGuardMode  = LogOnly      first day, then Enforce
    Security__DealerScopeMode = LogOnly      first day, then Enforce
    Security__CspMode         = ReportOnly   until the browser console shows no violations
Optional: Security__MediaLinkMinutes (default 120), Security__AllowDevTokens (default false - see below).

## 4. Build and test
    dotnet build
The first build may need a small fix in TenantIsolationFilter.cs (it assumes JobCardScannerDbContext in JobCardScanner.Api.Data and JobCards.DealerId).
Then: merge deploy\web.config.security-snippet.xml, and run tests\Run-VaptRetest.ps1 against UAT.

## 5. What changed for users
- Photos: addresses returned by the API now carry ?exp=...&sig=... (valid 2 hours). Web / Android builds from 23.10.2026 handle this.
- Sign-out calls POST /api/session/logout (no login needed); the token is refused afterwards.
- devOtpCode / devResetToken are removed from responses outside Development. If dealers still reset passwords with the on-screen token (no e-mail provider), that stops working: set Security__AllowDevTokens=true only as a temporary measure.
- Uploads: only photo / video bytes are accepted; the file name is always a GUID.
- Part / labour lines: price 0..1 crore, quantity 1..10,000, statutory GST rates (list in Security\FinancialInputValidator.cs).

## Verified (23.10.2026)
Security folder + SessionController compile on .NET 8 (0 errors, 0 warnings, TenantIsolationFilter replaced by a stand-in) and 29 checks pass against an in-process server.
NOT verified: the full project build (JobCardsController, RepairBillDocsController, TenantIsolationFilter need your project), anything on your server.
