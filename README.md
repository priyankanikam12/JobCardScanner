# BGauss DMS - VAPT retest fixes (31.10.2026): DMS-03, DMS-07, DMS-15

Securepoint's final retest (evidence of 30.10.2026): 13 fixed, DMS-03 and DMS-07 partially fixed, DMS-15 not fixed. This package fixes the three. "Fixed in code" is not "verified closed": deploy, then run the retest (section 4).

## What the screenshots showed
* DMS-15: GET /api/dealers answered 200 with EVERY dealer (name, state, city, address, GSTIN, rep code). The earlier fix removed only e-mail / phone fields. Now a dealer login gets only its own dealer.
* DMS-07: GET /api/jobcards?q=JC/288/26-27/0273 found nothing, but PUT /api/jobcards/fb931c93-7c01-46f3-b1cf-950e3f211fa6 returned 200 (technician and delivery date were changed). The number carries dealer code 288 = the
  test login's own dealer (Ankit Gond, Delhi, Work Area CUS0288W4 only). Lists, search and the card page follow the Work Area; the write routes checked the dealer only. The Work Area rule now applies to every request that names a job card.
* DMS-03: the screenshot shows POST /api/customers with another dealerId refused (403) - the part that was already fixed. The remaining point (search by chassis) is the unscoped fallback described below.

## 0. Check first (SSMS, JobCardScannerDb)
    SELECT j.Id, j.JobCardNumber, j.DealerId, d.Name AS Dealer, j.BaplServiceLocationCode, j.AssignedTechnicianName, j.ExpectedDeliveryAt
    FROM JobCards j JOIN Dealers d ON d.Id = j.DealerId
    WHERE j.Id = 'fb931c93-7c01-46f3-b1cf-950e3f211fa6' OR j.JobCardNumber = 'JC/288/26-27/0273';
    SELECT Id, Name, DealerId, WorkLocationCodes FROM Users WHERE Email = 'ankit.gond1@bgauss.com';
* If the card of the PUT has DealerId 38CBC463-A9A5-482F-9D63-C13CB44307CE (the test login's dealer) and a location other than CUS0288W4, the cause is the Work Area gap, as described.
* If it belongs to ANOTHER dealer, the dealer rule did not apply to that request - tell me before sending anything to Securepoint (check Security__DealerScopeMode is Enforce, the environment variables, and the logs\stdout lines "Tenant isolation:").
* The tester's PUT changed that card: technician "Anand Kumar Gupta", expected delivery 2026-10-20T10:00. Check the card and restore its values if needed.

## 1. Copy (API project)
Security\*.cs (7 files, replace / add in the Security folder):
  TenantIsolationFilter.cs (DMS-07)  JobCardRoutes.cs NEW (DMS-07)  WorkArea.cs NEW (DMS-07)  DealerScope.cs NEW (DMS-03)  ResponseSanitizerMiddleware.cs (DMS-15)  SessionFreshness.cs + SessionFreshnessEf.cs (DMS-15)
Then patch two files of YOUR project (backups <file>.before-retest; nothing changes if an anchor is not found):
    node deploy\patch-retest-dms03.js ".\Controllers\JobCardsController.cs" ".\Services\DmsBaplDataService.cs"
Build, deploy, iisreset.

## 2. What each fix does
DMS-03  TWO causes. (1) A dealerId that was LEFT OUT of the request was never forced to the caller's dealer - an omitted query parameter is not in the action arguments at all, so GET /api/jobcards/vehicle-lookup
        ran with no dealer filter. DealerScope.EnforceDealerIdParameters now fills an omitted / empty dealerId with the caller's dealer and refuses another dealer's id (found on the live site on 31.10.2026).
        (2) The lookup fell back to DMS_VehicleSales by chassis alone (no dealer filter): the fallback now ignores a row of another dealer, and a dealer login whose dealer has no BAPL dealer code is shown nothing.
        Cause (1) is in the Security folder (no patch needed); cause (2) needs patch-retest-dms03.js.
DMS-07  Dealer AND Work Area rules (claim app_work_locations; empty = every location; a card with no location is outside any restricted Work Area - exactly the controller's own rule) apply to every request that names a job card:
        any GUID format, worklogs/{id}/end, photos / part / labour suggestions by their own id, and any jobCardId in the query string or body -> HTTP 403.
DMS-15  GET /api/dealers and /api/bapl-dms/dealers return only the caller's own dealer; /api/dealers/{id} of another dealer is 403; /api/bapl-dms/workshops loses contact fields; /api/menu-access and /role-modes name only the
        caller's own role and designation. If the sanitizer itself fails, the answer is an error, never the unfiltered data.

## 3. Assumptions to check before you deploy
* dbo.JobCardWorklogs (Id, JobCardId) exists:  SELECT name FROM sys.tables WHERE name LIKE '%Worklog%'   (else change the SQL in TenantIsolationFilter.JobCardOfChildAsync; until then only that one route answers HTTP 500).
* dbo.JobCards has BaplServiceLocationCode (it does - seen in your own SELECT).
* DMS_VehicleSales.DealerCode (or LocCode prefix) is in the same format as the dealer's BAPL dealer code:  SELECT TOP 5 DealerCode, LocCode FROM dbo.DMS_VehicleSales   (DMS_IOT_DATA). If not, the fallback never matches - it fails CLOSED.
* Effect to expect: a dealer login with a Work Area now gets HTTP 403 where it used to be able to write to a card of another location. Any screen that did that on purpose will now fail - tell me which one.
  /api/dealers now returns one dealer to a dealer login: a screen that listed all dealers for a dealer role (the Job Card Wizard or Stock Report dealer picker) shows only its own dealer.

## 4. Verify on live (the chassis lookup must now answer 404 for a chassis sold by another dealer, even when the request carries no dealerId; GET /api/dealers must show exactly 1 row)
## (details) (tests\vapt-retest.js, Node 18+). New: --workarea-jobcard, --other-chassis, id-format checks, own-dealer-only checks.
    -- a card of the SAME dealer at another location (for --workarea-jobcard):
    SELECT TOP 5 Id, JobCardNumber, BaplServiceLocationCode FROM JobCards WHERE DealerId = '38CBC463-A9A5-482F-9D63-C13CB44307CE' AND ISNULL(BaplServiceLocationCode,'') <> 'CUS0288W4' ORDER BY CreatedAt DESC;
    -- a chassis sold by ANOTHER dealer (BaplConnection):
    SELECT TOP 5 chassis_no, dealer_code FROM DMS_SaleBill WHERE dealer_code <> 'CUS0288' AND (IsDelete IS NULL OR IsDelete = 0) ORDER BY CreatedOn DESC;
  node vapt-retest.js --base https://dms.bgauss.com --readonly --other-jobcard <card of another dealer> --workarea-jobcard <card of the same dealer, other location> --other-chassis <that chassis>
  then the full run (without --readonly): the PUT on the Work Area card only runs once its GET is refused with 403 (to protect production data).

## 5. Verified here / not verified
Verified: the Security folder without the Entity Framework classes - 117 in-process checks pass (new: an omitted / empty / foreign dealerId, job card id in 9 forms, worklog route, body jobCardId, Work Area rule, own-dealer-only lists, single-dealer 403, dealer picker,
workshops, designation in the matrix, fail-closed sanitizer); the patch script on both indentation styles; the retest script against a mock server in all four situations.
NOT verified: the full project build; TenantIsolationFilter, the EF lookup, JobCardsController and DmsBaplDataService were only syntax-checked; nothing has been run on the live site.

docs\Retest_Results_BGauss_Response_31.10.2026.xlsx is Securepoint's sheet with BGauss's response, fix and verification steps. Fill in the deployment date and time before sending.
