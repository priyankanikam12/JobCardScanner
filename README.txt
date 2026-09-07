JobCardScanner - changed files from this session
=================================================

Every file below has the SAME path inside this zip as in your project (e.g.
backend/JobCardScanner.Api/Controllers/JobCardsController.cs). Overwrite the
matching file in your own checkout with each one, then:

  - Backend: rebuild + restart the API (`dotnet build` / `dotnet run` from
    backend/JobCardScanner.Api). appsettings.json changes hot-reload on their
    own, but these are .cs code changes and need an actual rebuild+restart.
  - Web: no build step needed beyond your normal dev server picking up the
    file save (Vite hot-reloads .tsx automatically).
  - Mobile: Metro also hot-reloads .tsx on save; a full reload/restart of the
    Expo dev server is the safe fallback if something looks stale.

WHAT CHANGED AND WHY
---------------------

1) Coupon No. + Job Category in the Job Card Wizard's Vehicle step
   (placed right before Odometer (km), matching BAPL DMS's own form):
     - web/src/pages/staff/JobCardWizardPage.tsx
     - mobile/src/screens/JobCardWizardScreen.tsx
     - backend/JobCardScanner.Api/Dtos/Requests.cs
         (CreateJobCardRequest: + BaplCouponNo, BaplJobCategory)
     - backend/JobCardScanner.Api/Controllers/JobCardsController.cs
         (Create(): passes them through to BaplDmsCreateJobCardRequest)
     - backend/JobCardScanner.Api/Services/BaplDmsService.cs
         (CreateJobCardAsync(): uses them when supplied, otherwise falls
         back to the same auto-derived defaults as before - chassis number's
         last 13 characters for Coupon No., "B2C" for Job Category)

2) Estimates Amount: Part Suggestion / Labour Suggestion auto-lock once
   Grand Total reaches Rs.2000 (independent of the existing manual
   Done/Edit lock):
     - web/src/pages/staff/JobCardDetailPage.tsx
     - mobile/src/screens/JobCardDetailScreen.tsx
     - mobile/src/components/PartSuggestionSection.tsx
     - mobile/src/components/LabourSuggestionSection.tsx

3) Email send failures now surface the REAL error instead of a generic
   "check your configuration" message - IEmailClient.SendAsync returns
   EmailSendResult(Success, Error) instead of a bare bool, and
   JobCardsController.EmailEstimate puts the real Graph/token error into
   its response message:
     - backend/JobCardScanner.Api/Services/Integrations/GraphEmailClient.cs
     - backend/JobCardScanner.Api/Services/Integrations/OtpService.cs
         (adjusted to the new EmailSendResult return type)
     - backend/JobCardScanner.Api/Controllers/JobCardsController.cs
         (EmailEstimate: same file as #1's Create() change above)

4) Emailed "Estimates Amount" PDF now matches the same visual format as the
   existing browser "Estimate" print/PDF (buildEstimatePrintHtml) - navy
   header rule, dealer name + "ESTIMATE" title + Job Card No/Date on the
   right, bordered Customer Details / Vehicle Details boxes (now also
   showing City and Odometer, which the old PDF omitted), a bordered Part
   Details / Labour Details table with a grey title bar, and a bordered
   Grand Total block with a navy rule above it - built from the reference
   PDF you sent (matches the MAGNEMITE MOTO LLP-DELHI sample layout):
     - backend/JobCardScanner.Api/Services/EstimatePdfService.cs
         (This is the file behind the "Estimates Amount" -> email PDF
         attachment. It is NOT used for BAPL DMS's own repair-bill PDF
         (InvoicePdfService, unchanged) - only for JobCardScanner's own
         Part/Labour Suggestion estimate.)

5) Job Card Wizard's "Search by chassis no. / registration no." box - fixed
   a regression where unsold vehicles had stopped appearing at all. A
   previous change (2026-09-05) excluded any ChassisDetails row with no
   SaleDate to stop a dealer's whole unsold stock batch (80+ near-identical
   chassis) from burying real matches - but that also hid legitimate
   not-yet-sold vehicles dealers still need to search (pre-delivery
   inspection, warranty work, a sale recorded late in DMS). Fixed by
   bringing unsold vehicles back into the results instead of excluding them
   - sold vehicles still rank first (most-recently-sold), unsold ones now
   follow rather than being hidden entirely:
     - backend/JobCardScanner.Api/Services/BaplDmsService.cs
         (SearchVehiclesAsync: removed "AND ch.SaleDate IS NOT NULL", changed
         ORDER BY to sold-first instead of sold-only)
     - backend/JobCardScanner.Api/Controllers/BaplDmsController.cs
         (doc-comment only, matches the above)

6) Job Cards list: local job cards are now closed automatically once BAPL
   DMS closes/bills them there, instead of staying stuck at whatever local
   status they had. Reported directly as "the biggest issue": closing a job
   card in BAPL DMS closed it there, but JobCardScanner's own list kept
   showing it as still open, because nothing ever synced BAPL DMS's status
   back into JobCardScanner's own JobCard.Status - it was only ever changed
   by JobCardScanner's own actions (worklog start, the closure-OTP flow,
   workflow stage automation). Fixed with a sync-on-read: GET /api/jobcards
   (the list) and GET /api/jobcards/{id} (the detail page) now check BAPL
   DMS's live status (RepairbillStatus = 'Billed' = "Closed", same
   convention already used elsewhere in this codebase) for every local job
   card that isn't already Closed, and flip it to Closed the moment BAPL
   DMS agrees - reflected immediately in that same response, and persisted
   so it stays fixed on every request after:
     - backend/JobCardScanner.Api/Services/BaplDmsService.cs
         (new GetJobStatusesAsync: batch-reads live JobStatus for a set of
         JobCardHeaderIds in one round trip)
     - backend/JobCardScanner.Api/Controllers/JobCardsController.cs
         (new SyncClosedFromDmsAsync helper, called from List() and Get())

   Note on "why don't all my dealer's DMS job cards show up": checked
   against the JobCardHeader rows you pasted for CUS0288 (ids 79, 80, 87,
   99, 100) - only id 80 has IsDelete = 0; the other four (79, 87, 99, 100)
   are soft-deleted in BAPL DMS itself (IsDelete = 1). The list/search code
   already excludes IsDelete = 1 rows everywhere (same as BAPL DMS's own
   convention), so this isn't a bug on our side - those four just don't
   exist in BAPL DMS anymore. Only id 80's job card (your "2 / DMS" row) is
   real from BAPL DMS's own point of view.

   Note on Technician Work Log: it already auto-advances the Workflow Stage
   to "Work In Progress" when a technician's timer is started - this was
   already implemented (JobCardsController.StartWorklog calls
   WorkflowStageAutomation.AdvanceIfAheadAsync(..., "in_repair", ...)) and
   didn't need a change. If it isn't visibly happening for you: make sure
   the API you're running actually includes this (a rebuild from an older
   checkout wouldn't have it), and that a "Work In Progress"/in_repair stage
   is active for your dealer (Program.cs self-heals the global template on
   every startup, so this should always be true unless a dealer-specific
   override disabled it).

7) Android Dashboard: brought up to parity with the web Dealer Dashboard, and
   branded with your logo/scooter assets. Previously the mobile Dashboard
   only had 6 plain tiles with no icons, no revenue/CSAT row, and no
   "Job Cards by Status" breakdown at all - so nothing showed Closed job
   cards specifically, and it looked far plainer than the web version:
     - mobile/src/screens/DashboardScreen.tsx
         (rewritten: same 9 KPI tiles as web, same icons, same Revenue/Avg
         Service Time/Customer Satisfaction row, and a new "Job Cards by
         Status" section - a simple horizontal bar list, since there's no
         charting library in the mobile app - that includes Closed counts
         and taps through to that filtered list, same as web's chart. Also
         adds a navy "hero" header card with your logo and the scooter
         image.)
     - mobile/src/types/index.ts
         (DashboardKpis was missing almost every field the web type has
         had for a while - revenuePaidInvoices, byStatus, csat, and all 9
         Dealer Dashboard tile fields - even though /api/dashboard/kpis
         already returns them. Brought in line with web's type so the
         screen above actually typechecks.)
     - mobile/app.json
         (Android app icon (top-level "icon" and the adaptiveIcon's
         "foregroundImage") now point at BG_Logo.png instead of the old
         icon.png/android-icon-foreground.png, per your request to use
         that file as the APK's icon. Left backgroundColor/backgroundImage/
         monochromeImage as they were - if BG_Logo.png fills its whole
         square rather than sitting in a smaller "safe zone", Android's
         adaptive-icon mask may crop its edges on some launchers; if that
         looks off once you build, the fix is a version of BG_Logo.png with
         some transparent padding around the mark, not a code change.)

   IMPORTANT - this needs 3 image files already in your project's
   mobile/assets/ folder (you referenced all three by these exact names,
   so this assumes they're already there - they are NOT included in this
   zip, since they never existed in this sandbox to begin with):
     - mobile/assets/BGauss_Logo.png   (in-app header logo)
     - mobile/assets/Bg0-scooty.png    (scooter illustration)
     - mobile/assets/BG_Logo.png       (Android app icon)
   If any filename/case doesn't match exactly what's actually in that
   folder, Metro will fail to bundle with a "module not found" error for
   that require() - React Native's bundler is case-sensitive even where
   your OS's filesystem isn't.

8) Job Cards list (web): the whole row now opens the job card, not just the
   Job Card # cell. Reported directly: "any place click on jobcard then
   open jobcard now only jobcard open when click Job card no" - previously
   clicking the customer/vehicle/stage/status/technician/created cells did
   nothing at all:
     - web/src/pages/staff/JobCardsListPage.tsx
         (every <tr> now has its own onClick that navigates to that row's
         detail page - /jobcards/{id} for a JobCardScanner row, or
         /jobcards/bapl/{jobCardHeaderId} for a BAPL-DMS-only row, same
         routes the old Job Card # link already used. The inner Links -
         Job Card # and the 📷 Photos count, which jumps straight to the
         Photos section via a #photos anchor - stop the click from also
         reaching the row's handler, so they keep their own more specific
         destination instead of being overridden by the row's plain link.)

   Note: mobile's Job Cards list already opens the job card from anywhere
   in the row (its list is built from Pressable rows, not a single inner
   link per row) - only the web table needed this fix.

9) "BAPL DMS" renamed to just "DMS" everywhere it appeared in user-visible
   text (error messages, headings, placeholders, locked-field notices) -
   "from next dont add any where BAPL DMS only DMS". This was a plain
   text find-and-replace, no logic changed anywhere it touched:
     - web/src/pages/staff/JobCardWizardPage.tsx
     - mobile/src/screens/JobCardWizardScreen.tsx
     - web/src/pages/staff/JobCardsListPage.tsx, JobCardDetailPage.tsx,
       PartsPage.tsx, LoginPage.tsx, BaplJobCardDetailPage.tsx,
       AdminUsersPage.tsx, types/index.ts, App.tsx,
       lib/jobCardPrintHtml.ts, components/StatusBadge.tsx
     - mobile/src/types/index.ts, components/PartSuggestionSection.tsx,
       components/LabourSuggestionSection.tsx, screens/LoginScreen.tsx,
       screens/JobCardDetailScreen.tsx, screens/PartsScreen.tsx,
       utils/printJobCard.ts, screens/JobCardsListScreen.tsx
     - backend/JobCardScanner.Api/Controllers/JobCardsController.cs,
       BaplDmsController.cs, CustomersController.cs, AuthController.cs,
       DealerAuthController.cs, PartsController.cs
     - backend/JobCardScanner.Api/Services/BaplDmsService.cs,
       EstimatePdfService.cs, IInvoicePdfService.cs,
       IJobCardNumberingService.cs, JobCardNumberingService.cs,
       InvoicePdfService.cs
     - backend/JobCardScanner.Api/Dtos/Requests.cs
   A handful of internal code COMMENTS (not shown on any screen) still say
   "BAPL DMS" - e.g. Models/JobCard.cs, Models/MasterData.cs, Program.cs,
   and two comments in the wizard files - these are developer documentation,
   never rendered in the app, so they were intentionally left alone rather
   than rewritten for no user-visible benefit.

10) Job Card Wizard - Odometer (km) field wouldn't fully clear on backspace
    (web only): "when i type in inbox in that default 0 or last existing
    Previous km shown i try to backspace this then 0 not errase from back".
    Root cause: the input's value was bound directly to the numeric state
    (0 when empty), and backspacing a lone "0" character down to "" still
    evaluates to 0 in JS (Number('') === 0), so the box never actually went
    blank - there was always a "0" sitting there to fight against. Fixed by
    showing the field as blank whenever the value is 0/unset, same pattern
    mobile's equivalent field already used correctly:
      - web/src/pages/staff/JobCardWizardPage.tsx
    Checked mobile's odometer field for the same bug and confirmed it does
    NOT have it - it was already written as blank-when-empty, so mobile/src/
    screens/JobCardWizardScreen.tsx needed no change for this specific fix.

11) Job Card Wizard, Vehicle step (web only) - all 6 fields (Model, Reg No,
    VIN, Coupon No, Job Category, Odometer (km)) now always sit on a single
    row instead of Odometer wrapping down to its own line:
      - web/src/pages/staff/JobCardWizardPage.tsx
          (that field group's .form-row got a per-instance
          `gridTemplateColumns: repeat(auto-fit, minmax(130px, 1fr))`
          override, narrower than the shared 200px floor in global.css, so
          all 6 columns fit side by side instead of the 6th one overflowing
          to a new row. global.css itself wasn't touched, so every other
          .form-row elsewhere in the app keeps its original 200px floor.)

12) Current time shown in IST (UTC+05:30) consistently, regardless of the
    browser/device's own configured timezone:
      - web/src/pages/staff/JobCardWizardPage.tsx
          ("Expected delivery" datetime-local default now shifts by exactly
          +330 minutes off UTC instead of using the browser's own
          getTimezoneOffset() - the old approach only happened to be
          correct if the browser/OS was already set to IST; vehicle sale
          date displays (search results, global search, selected DMS
          vehicle) now go through a new formatISTDate() helper that
          explicitly formats in Asia/Kolkata rather than the browser's
          local zone)
      - mobile/src/screens/JobCardWizardScreen.tsx
          (same idea: new formatISTDate()/formatISTDateTime() helpers using
          Asia/Kolkata explicitly; "Expected delivery" display and vehicle
          sale date displays now go through them instead of plain
          toLocaleString()/toLocaleDateString())
    Note: the Worklog "Started (IST)/Ended (IST)/Duration (min)" table you
    pasted as a style reference wasn't itself part of these two files, so
    it wasn't touched here - if that table is ever showing a wrong time, it
    lives in a different screen/component and would need to be pointed out
    separately.

13) Job Cards list showing 2 rows for 1 job card created: "still 2 job
    cards shown from only 1 create". Since BAPL DMS became the sole source
    of truth (job cards can now only be created via DMS - see the
    2026-09-05 comments already in JobCardsController.cs), every
    JobCardScanner-native job card row is now ALSO a DMS job card by
    definition. The list's "blend in DMS's own job cards" step wasn't
    aware of that overlap - it added a second, read-only "SummarizeBapl"
    row for every DMS job card, including ones that already had their own
    native row. Fixed by excluding, from the blended DMS rows, any DMS
    JobCardHeaderId that's already represented by a native row on the same
    page of results:
      - backend/JobCardScanner.Api/Controllers/JobCardsController.cs
          (List(): builds a HashSet of BaplJobCardHeaderId from the
          already-fetched native rows, then filters the DMS search hits to
          drop any row whose JobCardHeaderId is already in that set, before
          merging the two lists)
    This only dedups within each list page's own result set (native: top
    200 by CreatedAt, DMS: top 50 matching hits) - a job card old enough to
    fall outside both of those windows at the same time isn't a realistic
    case in normal day-to-day use, so it wasn't specifically handled.
    Separately, per what was already explained earlier in this project: a
    job card that DMS itself has closed directly (outside JobCardScanner)
    is expected to disappear from the "open" list and only reappear once
    DMS marks it Closed on JobCardScanner's own side too - that's existing,
    intended behavior (SyncClosedFromDmsAsync), not the duplicate-row bug
    this section fixes.

DIAGNOSING THE CURRENT 502 ON /estimates/email
------------------------------------------------
Once GraphEmailClient.cs is rebuilt in, the on-screen message on the
Estimates Amount card will say exactly what Graph rejected. Until then (or
even right now, since this logging already existed before this change), run
this against JobCardScannerDb to see the last few failures' real reason:

  SELECT TOP 5 CreatedAt, Endpoint, StatusCode, ResponseJson
  FROM IntegrationLogEntries
  WHERE System = 'Email' AND Success = 0
  ORDER BY CreatedAt DESC;
