# BGauss DMS - VAPT backend security layer (23.10.2026, final)

All 16 findings of the Securepoint report (17 Oct 2026) are now fixed in code, including the three that were "partly fixed": DMS-12, DMS-15 and DMS-16. Nothing here changes the database.
"Fixed in code" is not "verified closed": that needs the deploy on dms.bgauss.com and the retest (tests\vapt-retest.js). Read PRODUCTION-ROLLOUT.md first.

## 1. Copy (API project folder = backend\JobCardScanner.Api)
| From this package | To your project |
|---|---|
| Security\*.cs (17 files) | Security\ - add / replace ALL 17 (the new ones: DealerTokenRenewer, OtpEnumerationMiddleware, SessionFreshness, SessionFreshnessEf, SessionRenewal). Delete a leftover RevokedTokenStore.cs |
| Controllers\SessionController.cs | replaces / adds (logout + the new renew) |
| Controllers\JobCardsController.cs, RepairBillDocsController.cs | replace (keep backups) |
| Program.cs | replace your Program.cs (keep a backup): adds builder.AddAppSecurityEf() and the EF interceptor |
| appsettings.Production.template.json | a template - copy the "Security" values you want into your real settings / environment variables |

## 2. Settings (environment variables on the server - NOT in appsettings.json or web.config)
    CustomerPortalJwt__Secret, DealerAuthJwt__Secret   32+ characters (the API refuses to start in production without them)
    DealerAuthJwt__ExpiryMinutes = 60, CustomerPortalJwt__ExpiryMinutes = 60     token lifetime (the report asks for 1 hour or less)
    Security__MediaSigningKey         32+ random characters (photo links)
    Security__RouteGuardMode = LogOnly, Security__DealerScopeMode = LogOnly, Security__SessionFreshnessMode = LogOnly   first working day, then Enforce
    Security__CspMode = ReportOnly
Optional: Security__MaxTokenMinutes (60), RenewedTokenMinutes (60), SessionCheckSeconds (30), OtpMinResponseMs (700), AllowDevTokens (false).

## 3. What the three last findings do now
DMS-12  POST /api/portal/otp/request answers the SAME HTTP 200 { otpRequestId, message: "If this number is registered, an OTP has been sent to it." } for every number (an unregistered number gets a random id that can never verify),
        after at least OtpMinResponseMs; POST /api/portal/otp/verify answers one HTTP 400 "Invalid or expired OTP." for a wrong code, an expired or an unknown request. devOtpCode / devResetToken never leave the API outside
        Development. The portal login page no longer prints "No account found" (web: PortalLoginPage.tsx).
        !! The site has no SMS provider (MockNotificationClient), so with devOtpCode removed a customer can no longer get an OTP on screen. Customers with a password still sign in; for OTP either wire a real SMS client
        or, temporarily, set Security__AllowDevTokens=true (the dev code is shown again; an unregistered number then gets a random 6-digit dev code too, so the two still look the same).
DMS-15  GET /api/menu-access and /api/menu-access/role-modes return, to a non-corporate login, only what its own role can use (its role, plus the Captain / ViceCaptain designation entries): a page it may see lists only its role,
        a page it may not see lists "-", a page open to everyone stays "everyone" - the sidebar shows exactly the same, but the full role-to-screen map can no longer be read. CorporateAdmin / SystemAdmin (the Menu Access page)
        get the full lists. GET /api/dealers hides other dealers' contact fields (as before).
DMS-16  * no token older than MaxTokenMinutes (60) is accepted (a Dealer / Workshop or customer-portal token); the web and Android apps renew it silently in its last 15 minutes (POST /api/session/renew);
        * the session of a user ends - within seconds, or at the latest SessionCheckSeconds - when the user's role, active flag, dealer or password changes or the user is deleted (EF interceptor + a database check),
          without any controller having to call anything; * sign-out revokes the token (as before); * web: sessionStorage; Android: SecureStore, allowBackup false, no cleartext (see the web + Android package).
        A request that fails answers HTTP 401, which both apps already treat as "sign in again". A database outage lets requests through. SessionFreshnessMode = LogOnly only logs ("Session freshness: ...").

## 4. Build and test
    dotnet build        (the first build may need a small fix in TenantIsolationFilter.cs: it assumes JobCardScannerDbContext and JobCards.DealerId)
Then follow PRODUCTION-ROLLOUT.md; run tests\vapt-retest.js after Enforce.

## Verified here
The Security folder (except the two Entity Framework classes) + SessionController logic compile on .NET 8 and 83 in-process checks pass; the two EF classes, SessionController, JobCardsController and Program.cs were only syntax-checked
(they need your project). NOT verified: the full project build and everything on the live server.
