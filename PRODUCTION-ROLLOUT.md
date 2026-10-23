# VAPT - rollout on the LIVE site only (dms.bgauss.com, no UAT) - 23.10.2026

Principle: there is nothing to test on first, so every step is reversible, the guards start in LogOnly (they log what they WOULD refuse, they refuse nothing), and the retest never sends a write
request unless the server has proven (with read-only questions) that the guard is enforcing.

## 0. Before (15 minutes, outside peak hours)
- Copy the whole current publish folder to a backup (like C:\inetpub\backup\NN). No database change is part of this release, so the folder is the whole rollback.
- Make sure both JWT secrets are already set on the server (machine variables or appsettings.Production.json): CustomerPortalJwt__Secret and DealerAuthJwt__Secret, 32+ characters.
  The new Program.cs REFUSES TO START in production without them. (Before, a public default text was silently used.)
- Create the settings (machine environment variables, then iisreset):
      Security__MediaSigningKey = <32+ random characters>      photo links
      Security__RouteGuardMode  = LogOnly
      Security__DealerScopeMode = LogOnly
      Security__CspMode         = ReportOnly

## 1. Deploy (about 5 minutes of restart)
Copy Security\ (12 files), Controllers\SessionController.cs, JobCardsController.cs, RepairBillDocsController.cs, Program.cs; merge web.config; dotnet build; publish; iisreset.
Check: https://dms.bgauss.com opens and a login works. The web build can follow later (old web + new API work together, new web + old API too).

## 2. One working day in LogOnly
Use the system normally. Every request that "Enforce" would refuse is written to the log (stdout log in .\logs):
    Select-String -Path .\logs\stdout* -Pattern 'Route guard:|Tenant isolation:'
Read each line (it names the method, the path and the user):
- a request nobody should make (a dealer reading the staff directory, a dealer id of another dealer) = the guard is right;
- a request a real user needs (for example a MAIN DEALER working on a job card of a dealer under its hub) = DECISION NEEDED before Enforce - see "Hub rule" below.
Nothing is refused in this phase.

## 3. Switch to Enforce
    Security__RouteGuardMode  = Enforce
    Security__DealerScopeMode = Enforce
iisreset. Emergency switch (no redeploy): set either value to Off and iisreset.

## 4. Re-test on the live site (from your PC, Node 18+, folder tests\)
Use the test logins BGauss gave Securepoint (DealerAdmin, Captain, Supervisor/ViceCaptain) and one TEST job card of the Captain's dealer (a Technician assigned, one photo uploaded).
    set VAPT_DEALERADMIN_TOKEN=...   set VAPT_CAPTAIN_TOKEN=...   set VAPT_SUPERVISOR_TOKEN=...
    node vapt-retest.js --base https://dms.bgauss.com --readonly
    node vapt-retest.js --base https://dms.bgauss.com --test-jobcard <guid> --other-jobcard <guid of ANOTHER dealer> --other-dealer <guid>
A token is copied from the browser (developer tools, Network tab, the Authorization header of any /api request after signing in). Tokens expire; copy a fresh one.
How it protects production: it first asks two READ-ONLY questions (a DealerAdmin on an admin-only GET; a Captain reading another dealer's job card). If the answer is not "refused", it prints FAIL and SKIPS every
write-style test. The only writes that can still happen are on your TEST job card (an HTML file posing as a photo, a negative labour rate); if one is accepted it says CLEANUP NEEDED and removes what it can.
--readonly sends no write at all. The last test (DMS-16) signs the Captain token out; --keep-session skips it.

## 5. Clean up what the pen test itself left on production
- Run sql\2026-10-17_vapt_cleanup_checks.sql (read-only): leftover SystemAdmin accounts, injected workflow stages, bill lines with a negative price.
- Delete poc.png.html (and anything that is not a photo / video) under wwwroot\uploads.
- Disable the Securepoint test logins when the retest is finished.

## 6. Later
- After a week without Content-Security-Policy-Report-Only complaints in the browser console: Security__CspMode = Enforce.
- Open items (need files): DMS-12 OTP answers identical for registered / unregistered numbers (OtpService + portal controller); DMS-15 /api/menu-access matrix (MenuAccessController);
  dealer token lifetime 1 hour and token revoke on role / password change (DealerAuthController, UsersController).

## Hub rule (your review notes on DMS-03 / DMS-07)
The dealer scope has NO notion of a main dealer or hub: a dealer login may only touch job cards whose DealerId equals its own. If a main dealer must work on the job cards of the dealers under its hub,
Enforce would refuse it. Step 2 shows whether that happens. To allow it, the code needs the table / column that says which dealers belong to which main dealer (send the Dealer entity or table).
