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

14) Part Suggestion / Parts &amp; Inventory: items from DMS's ItemMaster catalog
    now show up even if this workshop location has never stocked/transacted
    them. You asked "from SELECT * FROM ItemMaster why Part Suggestion not
    shown?" then "from ItemMaster also show". Cause: GetPartsInventoryAsync
    previously started from PartsInventory (this location's own stock
    ledger) and only used ItemMaster afterward to fill in each match's
    name/price/HSN - so an item had to already have a stock transaction row
    at this specific location before it could appear as a suggestion at
    all, no matter what ItemMaster itself had. Fixed by flipping the query:
    it now starts from ItemMaster (every item in the shared catalog) LEFT
    JOINed to this location's aggregated PartsInventory stock, so every
    catalog item is suggestable - one that's never been stocked here just
    shows AvailableQty = 0, the same as a sold-out item already does, rather
    than not appearing at all:
      - backend/JobCardScanner.Api/Services/BaplDmsService.cs
          (GetPartsInventoryAsync(): single query now, ItemMaster as the
          base table with a LEFT JOIN subquery for this location's stock,
          replacing the old PartsInventory-then-enrich-from-ItemMaster
          two-query approach)
    Worth knowing: ItemMaster is DMS's shared catalog (not scoped to one
    location the way PartsInventory is), so this can return more rows than
    before - every item DMS knows about, not just ones this location has
    touched. If that list turns out to be too large or shows items from
    other dealers/locations that shouldn't be suggestable here, let me know
    and I can look at adding a narrower scope or server-side search
    filtering.

15) "in dms after jobcard closed invoice create so in our jobscanner also
    when jobcard close from dms invoice generate...same as it is like dms
    in flow": when DMS closes/bills a job card directly (not through
    JobCardScanner), the local job card's Status was already flipping to
    Closed (SyncClosedFromDmsAsync, from an earlier fix this session), but
    the Workflow Timeline itself never moved - it stayed wherever it last
    was (usually stuck at "Repair Completed"), so "Invoice Generated" never
    appeared unless someone manually clicked the "Generate Invoice" button
    on the Job Card Detail page. Fixed by having that same DMS-closed sync
    also advance the local job card straight to the "Invoice Generated"
    stage (the exact same terminal stage the manual button reaches), so the
    Workflow Timeline shows the same end state DMS's own flow already
    reached, without anyone having to click anything locally:
      - backend/JobCardScanner.Api/Controllers/JobCardsController.cs
          (SyncClosedFromDmsAsync(): now also calls
          WorkflowStageAutomation.AdvanceIfAheadAsync(..., "invoice_generated", ...)
          for every job card it detects DMS has closed - adds the matching
          StageHistory row with the note "Auto-advanced: DMS closed this job
          card (invoice already generated in DMS)."; never moves a job card
          backwards, so this is safe to run every time List()/Get() sync
          against DMS, not just the first time)
    Note: this doesn't create a separate local "Invoice" record or PDF -
    the actual invoice document was already available live from DMS's own
    RepairBillHeader/Detail via the existing "Download Invoice from DMS"
    button (InvoicePdfService), unchanged here. This fix is specifically
    about the Workflow Timeline/stage catching up to match, since that's
    what a Service Advisor actually sees on the Job Card Detail page.

16) Technician Work Log timer looked frozen once started: "now i start
    timer but still another time show current time 11.51 not shown in
    timer". The "Timer running since ..." line was computed once when the
    page/screen loaded and never updated again on its own - nothing was
    forcing a re-render as real time passed, so it silently showed the same
    start time forever with no visible sign the timer was actually running.
    Added a live elapsed-time readout next to it (e.g. "running for
    12:47"), ticking once a second only while a timer is actually open (a
    complete no-op the rest of the time - not a page-wide poller):
      - web/src/pages/staff/JobCardDetailPage.tsx
      - mobile/src/screens/JobCardDetailScreen.tsx
    Both add a new formatElapsedMs() helper and a 1-second setInterval
    scoped to WorklogCard alone, cleaned up on unmount/timer-stop the same
    way. The Worklog history table's per-row "Duration (min)" figures were
    already correct and are untouched - this only fixes the live "still
    running" line above the table.

17) DMS-only job card detail page ("DMS" badge rows, opened directly in
    DMS - JobCardScanner never created them) now shows the same repair-bill
    breakdown and invoice download the native Job Card Detail page shows
    for its own job cards: "2nd jobcard closed then this jobcard invoice?"
    and "this also show like whole data in our jobcard flow". Previously
    this page (/jobcards/bapl/{id}) only showed four plain summary cards
    (Customer & Vehicle, Job Details, Complaints, Dates on file) with no
    way to see or download the actual invoice - because the existing
    invoice-download code (InvoicePdfService.BuildInvoicePdfAsync) only
    ever worked from a local JobCard.Id, which a DMS-only job card doesn't
    have. Added a second, parallel path that works directly from DMS's own
    JobCardHeaderId instead, with no local record required:
      - backend/JobCardScanner.Api/Services/IInvoicePdfService.cs
          (two new interface methods + two new DTOs -
          BaplDmsInvoiceLineItemDto/BaplDmsInvoiceLineItemsResult - for the
          Part/Labour breakdown)
      - backend/JobCardScanner.Api/Services/InvoicePdfService.cs
          (GetLineItemsAsync() and BuildInvoicePdfFromDmsAsync(): same
          repair-bill read/classify logic BuildInvoicePdfAsync already
          used, just sourcing customer/vehicle info from
          IBaplDmsService.GetJobCardByIdAsync and the dealer's letterhead
          from a local Dealer lookup by BaplDmsDealerCode, instead of a
          local JobCard/Customer/Vehicle/Dealer row)
      - backend/JobCardScanner.Api/Controllers/BaplDmsController.cs
          (two new endpoints: GET /api/bapl-dms/job-cards/{id}/line-items
          and GET /api/bapl-dms/job-cards/{id}/invoice-pdf - same 404
          "nothing raised yet"/502 "real DMS problem" conventions as the
          native job card's own invoice-pdf endpoint)
      - web/src/types/index.ts
          (+ BaplDmsInvoiceLineItem, BaplDmsInvoiceLineItemsResult)
      - web/src/pages/staff/BaplJobCardDetailPage.tsx
          (+ "Estimates Amount (from DMS repair bill)" card - Part
          Details/Labour Details tables + Grand Total, same layout as the
          native page's Estimates Amount card - and a "Download Invoice
          from DMS" button, same download pattern as the native page's
          Invoice card)
    A 404 from either new endpoint means DMS hasn't raised a repair bill
    for this job yet (normal for a job still Open, like job card #7 in
    your screenshot) - shown as a plain "not billed yet" note, not an
    error. This is a WEB-ONLY change - mobile has no equivalent DMS-only
    job card detail screen at all yet (JobCardsListScreen.tsx currently
    disables tapping a "DMS" badge row entirely: `disabled={isBapl}`), so
    building the same thing there would be a separate, larger follow-up if
    you want it.
    Reminder from earlier in this same conversation, still true: job card
    #2/#80 in your screenshots shows Stage "-" on the /jobcards list, and
    that's correct, not a bug - it's a pure DMS-only row with no local
    JobCard record at all, so there's nothing for the Workflow Timeline
    (item 15 above) to attach to. Item 15's fix only applies to a job card
    JobCardScanner itself created and DMS later closed directly - a
    genuinely different case from one opened directly in DMS from the
    start.

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

18. "in dms in repair bil save jobcard 1st Save as proforma then save as
    invoice ... in jobcard invoiceno why not update? ... thats why in our
    jobscanner invoice not download ... fix this for dms as well and in
    our code also"
    -------------------------------------------------------------------
    Investigated both halves of this separately - they turned out to be
    two unrelated things, not one bug with two symptoms:

    (a) THE DMS-SIDE GAP (real, confirmed): in the RepairBillRepo.cs you
        pasted, neither InsertRepairBill ("Save as Proforma") nor
        UpdateRepairBill ("Save as Invoice") ever writes to
        JobCardHeader.InvoiceNo - both only touch RepairBillHeader/
        RepairBillDetail. That's exactly why the JobCardHeader row you
        pasted (Id 112) shows InvoiceNo NULL. This is a bug in your DMS
        codebase, not JobCardScanner's - I can't edit that repo directly
        (I only have the text you pasted, not the files), so the fix is
        written up as a patch recommendation for you to apply there:
          DMS-FIX-RepairBillRepo-InvoiceNo.txt (new file, in this zip's
          root alongside this README)
        It adds a few lines to UpdateRepairBill that set
        header.Job.InvoiceNo via the RepairBillHeader.Job navigation
        property your own model already has, whenever RepairbillStatus
        becomes "Billed" - see that file for the exact snippet and two
        things to double-check against your fuller repo before shipping.

    (b) "IN OUR CODE ALSO" - checked JobCardScanner's own
        InvoicePdfService.cs/BaplDmsService.cs directly: nothing there
        depends on JobCardHeader.InvoiceNo to decide whether a bill
        exists or to build the invoice number shown/downloaded. Every
        invoice path (native BuildInvoicePdfAsync, and the DMS-only
        GetLineItemsAsync/BuildInvoicePdfFromDmsAsync added earlier this
        session) reads RepairBillHeader.BillNo/Prefix instead, and
        "not billed yet" is decided by whether a RepairBillHeader row
        exists at all for that JobId - not by InvoiceNo. So no
        JobCardScanner code needed to change here; none did.

        For the specific job card you pasted (Id 112, JobNo 7,
        JobStatus NULL, created 2026-09-07 22:37): the much more likely
        reason "invoice not download" is simply that no RepairBillHeader
        row exists yet for it (no bill raised in DMS's repair-bill screen
        for job #7 yet) - a normal "not billed yet" state your JobCardScanner
        pages already show correctly, not an error. Run this against
        BAPLDMSvad to confirm either way:

          SELECT * FROM RepairBillHeader WHERE JobId = 112;

        No rows = that's the whole explanation, raise a bill against job
        #7 in DMS first. A row with a BillNo and the download still fails
        would be a genuinely new, different bug - send the exact
        error/response from that case and I'll dig into it.

19. "in dms files give changes for adding this project"
    -------------------------------------------------------------------
    Turned section 18(a)'s recommendation into an actual full, ready-to-drop-in
    file instead of just a text note - replaces DMS-FIX-RepairBillRepo-InvoiceNo.txt.
    New file in this zip (mirrors the path in your DMS repo):

      dms/DMS_BAPL_Data/Repositories/RepairBillRepo/RepairBillRepo.cs

    This is the SAME file you pasted into chat (RepairBillRepo.cs), reproduced in
    full with exactly two additions (verified against the original with `diff` -
    every other line is untouched):

      1. InsertRepairBill ("Save as Proforma"): after building RepairBillDetail
         rows, if RepairbillStatus is already "Billed" and BillNo is set (covers
         the case where your flow can create an already-invoiced bill directly,
         skipping the proforma step) - looks up the JobCardHeader by JobId and
         sets its InvoiceNo to {Prefix}{BillNo}.
      2. UpdateRepairBill ("Save as Invoice" - this is the one that actually
         matters for your reported case, since Angular sets RepairBillStatus to
         "Billed" here): added `.Include(x => x.Job)` to the header fetch so the
         RepairBillHeader.Job navigation property your own model already declares
         is actually loaded, then - right after `header.RepairbillStatus = ...` is
         set - if the new status is "Billed" and BillNo is set, sets
         header.Job.InvoiceNo to {Prefix}{BillNo} (with a defensive re-fetch if
         Job somehow wasn't loaded). This is the block that fixes your
         `SELECT * FROM JobCardHeader ... InvoiceNo NULL` finding going forward -
         every bill that reaches "Billed" status through this method from here on
         will have InvoiceNo populated on its job the moment it's saved.

    To apply: copy this file over your existing RepairBillRepo.cs in DMS_BAPL_Data,
    or diff it against your current copy and apply just the two blocks above if
    your repo has moved on since you pasted it into this chat. Two things to
    double check on your side before deploying, same as noted in section 18:
      - Confirm BillNo/Prefix really are already assigned on `header`/
        `RepairBillheader` by the point these blocks run in your actual repo (they
        read as already-final values in what you pasted, but I can only see the
        one method body, not wherever BillNo itself gets generated).
      - If IsSavedInvoice (rather than RepairbillStatus == "Billed") is your
        repo's real signal for "this is now a real invoice, not a proforma",
        swap the condition to check that instead - I went with RepairbillStatus
        since that's the field the Angular repair-bill-invoice.ts you pasted
        sets to "Billed" on save.

    Nothing on the JobCardScanner side changed again this round - section 18(b)
    already confirmed no JobCardScanner code depends on JobCardHeader.InvoiceNo.

20. "'int' does not contain a definition for 'HasValue' ... this 2 error came in dms"
    -------------------------------------------------------------------
    My mistake in section 19's patch - your RepairBillHeader.BillNo is a plain
    non-nullable `int` (not `int?`) per the model you pasted, so `.HasValue`
    doesn't compile against it. Fixed both spots in
    dms/DMS_BAPL_Data/Repositories/RepairBillRepo/RepairBillRepo.cs (in this
    same zip, updated in place) - both now check `BillNo > 0` instead of
    `BillNo.HasValue`, which means the same thing for this column (0 is never
    a real bill number). No other logic changed - re-diffed against the
    original you pasted and the only differences are still exactly the two
    InvoiceNo-writing blocks from section 19, now compiling correctly.

21. "full code give for fix" (material-transfer-detail.ts save 500) + you re-pasted the
    current material-transfer-detail.ts + the console log showing POST /api/material-transfer
    still 500ing on Save
    -------------------------------------------------------------------
    New file in this zip (mirrors the path in the comment at the top of the file you pasted):

      dms/src/app/components/material-transfer/material-transfer-detail/material-transfer-detail.ts

    Root cause, now confirmed against your actual file: MaterialTransferViewModel (backend)
    binds ItemRate/Mrp as decimal and Technician/IssueType as int, all non-nullable. In
    onAddItem(), itemRate/mrp are built with .toFixed(2) (which always returns a STRING, not a
    number) - e.g. `this.newItem.itemRate = Number(taxDetails.basePrice).toFixed(2)` in
    onChangeItem() runs before itemToSave is built, so itemToSave.itemRate is already a string
    by the time it's spread in; itemToSave.mrp is explicitly set to `taxDetails.finalPrice`
    (also a .toFixed(2) string) or `this.items[index].mrp` (same, from getMaterialTransferList's
    own .toFixed(2)). Technician/issueType can carry a string too, depending on how the
    <select> options bind them (a plain [value] binding always coerces to a string; I don't
    have your current material-transfer-detail.html to re-check that this round, so I can't
    confirm/deny that specific angle this time). Either way, once any of these ends up a JS
    string in the object that gets JSON.stringify'd and POSTed, ASP.NET Core's default
    System.Text.Json settings throw while binding the request body - before your controller
    action runs, and before IPartInventoryService.UpdateOutgoing is ever called - which matches
    exactly what you're seeing: the row "adds" fine in the on-screen grid (that's pure
    client-side array logic, no HTTP call), but Save silently fails server-side with a 500 and
    nothing persists.

    Fix applied: added a private sanitizeForSave(item) helper that coerces itemRate, mrp,
    quantity, technician and issueType back to real JS numbers (and rackNo/validdays to a real
    number or null) right before a row is written into `this.items` - once in the "edit
    existing row" branch of onAddItem(), once in the "new row" branch. Since `this.items` is
    exactly what onSubmit() later filters into lstAdded/lstModified and POSTs, this guarantees
    the JSON body always carries real numbers for these fields regardless of what format they
    arrived in from the form. Nothing else in the file changed - diffed against what you pasted
    and the only differences are the new sanitizeForSave() method and its two call sites.

    One thing I could NOT re-verify this round because you didn't re-paste it: whether
    material-transfer-detail.html still uses [value] instead of [ngValue] on the technician/
    issueType <option> elements (confirmed present a few turns back). That's a separate,
    complementary fix - worth doing for cleanliness even though the sanitizeForSave() fix above
    should stop the 500 on its own regardless of which type the <select> hands back. If you
    want the .html delivered as a full corrected file too (with that swap applied), paste its
    current content and I'll ship it in this same zip.

    Also noted, NOT fixed (unrelated to the 500, cosmetic only): your console log has
    `The specified value "Tue Sep 08 2026 01:16:27 GMT+0530..." does not conform to the
    required format, "yyyy-MM-dd"` - some <input type="date"> in the template is bound directly
    to a JS Date object instead of a "yyyy-MM-dd" string. This doesn't affect the POST body
    (JSON.stringify formats Date objects as ISO strings regardless of what's shown in the
    input), it's just a benign browser console warning. Likely candidate is formData.date -
    happy to fix once I can see the .html.

22. You pasted the actual Network-tab request payload for the still-failing POST + confirmed
    it's still 500ing after section 21's fix
    -------------------------------------------------------------------
    Good news first: the payload you pasted shows itemRate: 77.97, mrp: 92, technician: 1,
    issueType: 1 - all real JSON numbers now, not strings. Section 21's sanitizeForSave() fix
    is working correctly and should stay.

    But the same payload has "materialissueNumber":"1" - a quoted STRING, while your backend's
    MaterialIssueNumber is `int?`. Same bug, different field, that I missed in section 21's
    coercion list. Added `materialissueNumber: toNullableNum(item.materialissueNumber)` to
    sanitizeForSave() in this same file (updated in place in this zip) - it comes from
    `this.formData.issueNumber`, which is built as `String(Number(materialIssueNumber))` in
    getMaterialTransferList()/getMaterialPrefix(), so it was always a string reaching the
    server regardless of the other fixes.

    IMPORTANT - this alone may not be the whole story. A quoted string failing to deserialize
    into a C# int/decimal property is something ASP.NET Core normally turns into a 400 Bad
    Request automatically (via [ApiController] model validation), not a 500 - a 500 usually
    means the request body bound successfully and something actually threw further in, inside
    your controller action or MaterialTransferService/PartInventoryService logic. Since this
    exact 500 has now survived two rounds of JSON-shape fixes, I'd bet on that being the real
    story: most likely IPartInventoryService.UpdateOutgoing(stockTransaction) - called once per
    item inside MaterialTransferService.InsertMaterials BEFORE MaterialTransferRepo.InsertMaterials
    ever runs - throwing on something (e.g. a stock/quantity check, a null lookup for this
    item/location/dealer combo). I still only have that service's interface, not its
    implementation, so I can't confirm this without seeing PartInventoryService.cs.

    The fastest way to stop guessing: open Chrome DevTools > Network tab > click the failed
    POST /api/material-transfer row > check its "Response" (or "Preview") tab. In a Development
    environment ASP.NET Core usually includes the real exception message/stack trace in that
    response body even for a 500 - that text (or whatever prints in the terminal/Output window
    running the backend at the moment of the failed request) will say exactly what's throwing,
    instead of me continuing to guess at backend files I don't have.

23. "Could not read DMS's repair bill lines for bill 75: Invalid object name 'dbo.RepairBillDetail'."
    (BAPL job card detail page, /jobcards/bapl/80) + confirmed via SQL that the real table is
    dbo.RepairBillDetails (plural)
    -------------------------------------------------------------------
    Fixed directly in your JobCardScanner repo (this file lives in your actual codebase, not the
    text-only DMS side, so it's edited in place, not reconstructed):

      backend/JobCardScanner.Api/Services/BaplDmsService.cs

    GetRepairBillDetailLinesAsync's raw SQL queried `FROM [dbo].[RepairBillDetail]` (singular) -
    that table name was carried over from the EF Core *column* list you'd pasted earlier for the
    DMS RepairBillDetail entity, but the physical table name itself was never actually confirmed
    against your real database (unlike RepairBillHeader, whose singular name was already
    confirmed working). You ran `SELECT s.name, t.name FROM sys.tables t JOIN sys.schemas s ON
    t.schema_id = s.schema_id WHERE t.name LIKE '%RepairBillDetail%'` and it came back
    dbo.RepairBillDetails (plural) - so DMS's DbContext maps the plural `RepairBillDetails` DbSet
    straight through to a plural physical table, unlike RepairBillHeader which has some explicit
    singular mapping. Changed the FROM clause to `[dbo].[RepairBillDetails]` - one-line fix, no
    other changes to this file.

    Still open, not yet resolved: you also reported 502 (Bad Gateway) on
    /api/bapl-dms/job-cards/{id}/line-items and /invoice-pdf, hit directly against
    localhost:5262. A 502 (as opposed to a 500) usually means something sits in front of the
    backend process itself (a proxy, dotnet watch restarting mid-request) rather than the app
    code throwing a handled/unhandled exception - I asked whether 5262 is `dotnet run` directly
    or has anything in front of it, and haven't heard back yet. Once the table-name fix above is
    deployed, worth reloading that page again first - if GetRepairBillDetailLinesAsync was
    throwing on every request and something in the hosting setup treats a crashed/faulted request
    as a 502, this single fix might also clear the 502s as a side effect. If they persist, still
    need to know what's actually in front of port 5262.

24. "in dms showing Invoice No BGEV262701438 why not shown in jobscanner when in download Invoice"
    (side-by-side screenshots: DMS's own /repair-bill-invoice/75 page shows the real invoice
    number, JobCardScanner's downloaded PDF for the same job shows "Invoice No: 0")
    -------------------------------------------------------------------
    Fixed in the same JobCardScanner file as sections 23:

      backend/JobCardScanner.Api/Services/BaplDmsService.cs

    GetRepairBillHeaderDetailAsync's query picked the RepairBillHeader row for this JobId using
    only `ORDER BY Id DESC` - i.e. "whichever row has the highest Id, no matter its status". If a
    job ever ends up with more than one RepairBillHeader row (a proforma re-saved, a re-estimate,
    etc.) and a newer-but-still-unbilled row exists with a higher Id than the actual billed one
    (BillNo/Prefix still at their un-set defaults - 0 and null - since that row was never taken to
    "Billed"), this query grabbed the unbilled one instead of the real invoice DMS's own
    /repair-bill-invoice/{id} page reads directly by its specific Id. That produced exactly what
    you saw: Prefix empty + BillNo 0 => "Invoice No: 0".

    Fix: added `RepairbillStatus = 'Billed'` as the first ORDER BY key (ahead of Id DESC) - a
    Billed row now always wins over a non-Billed one for the same job, regardless of which was
    created more recently; only when there are multiple Billed rows does it fall back to picking
    the most recent by Id. RepairbillStatus == "Billed" is the same "this is a real invoice, not a
    proforma" signal already used elsewhere in this codebase (GetJobCardStatusById's JobStatus
    CASE expression), so this is consistent with how the rest of the integration already treats
    that field.

    Also noticed, NOT changed (a design/field-set difference, not obviously a bug): DMS's own
    invoice page shows a "Job Type" field (PDI, in your screenshot) that JobCardScanner's PDF
    doesn't have a slot for at all - it shows "Inward Type"/"Job Status" instead. If you want full
    field parity with DMS's layout there too, let me know and I'll check what row.JobType (or
    equivalent) is actually available to add it.

25. "now working all ok but i want to reduce size of my apk now 80mb" -> "on adding in playstore
    less that apk size wants" (you want to publish to Play Store, and want a smaller download)
    -------------------------------------------------------------------
    Two files changed:

      mobile/eas.json
      mobile/app.json

    The single biggest cause of an 80MB Expo/React Native APK: your existing "preview" and
    "production" profiles both set android.buildType = "apk", which bundles the native .so
    libraries for ALL FOUR CPU architectures (arm64-v8a, armeabi-v7a, x86, x86_64) into one file -
    every installing device downloads all four even though it only ever uses one. That's normal
    and fine for the internal-testing APK you host yourself at http://3.88.172.79/app/... (a raw
    APK has to be "universal" like that to install on anything), so "preview"/"production" were
    left untouched.

    For Play Store specifically, added a NEW build profile in eas.json - "playstore" - with
    android.buildType = "app-bundle" instead of "apk". An Android App Bundle (.aab) is what Google
    requires for new Play Store submissions anyway (not just an optimization - see
    https://docs.expo.dev/distribution/app-size/), and once you upload it, Play Store's own
    "dynamic delivery" generates and serves each installing device ONLY the one architecture's .so
    files and pixel-density images it actually needs - typically cuts what a user downloads to
    roughly a third to a half of a universal APK's size, with no code changes needed beyond this
    config. Build it with:

      eas build --platform android --profile playstore

    then submit with:

      eas submit --platform android --profile playstore

    (first submit needs a Play Console service-account key configured - EAS will prompt you
    through that if it's not set up yet).

    Also added two more real, documented size-reduction options to the existing expo-build-properties
    plugin block in app.json (these help both the Play Store .aab AND your existing internal .apk
    builds, since they're not profile-specific):
      - enableMinifyInReleaseBuilds: true - turns on R8 to strip unused Java/Kotlin code from all
        your native dependencies at build time.
      - enableShrinkResourcesInReleaseBuilds: true - removes unused resources (images, strings,
        etc. that ship with libraries but are never referenced) from the release build.
    Combined, these two typically save several more MB regardless of apk vs app-bundle - safe to
    keep on for "preview"/"production" too since they only affect release builds, not the dev client.

    NOT changed, just flagged as a separate, smaller lever if you want to chase it further: your
    last preview build logged "Your project archive is 252 MB... reduce its size... by excluding
    files... in .easignore file." That's the size of what gets UPLOADED to EAS's build servers
    (affects upload/build time, not the final installed app size) - your mobile/.gitignore already
    excludes node_modules/.expo/ios/android, so if that's still 252MB either the project isn't
    fully git-tracked or something large and untracked is sitting in the folder. Not investigated
    further since it's unrelated to the actual 80MB APK size question.

26. "just currently my app mb size is 77mb now also from this size reduce size less than 77 mb"
    -------------------------------------------------------------------
    One more change, same file: mobile/app.json.

    77MB confirms the minify/shrink-resources change from section 25 already shaved a few MB off
    the original 80MB. The next real lever: added `"buildArchs": ["armeabi-v7a", "arm64-v8a"]` to
    the same expo-build-properties android block. By default Expo/React Native bundles native .so
    libraries for FOUR CPU architectures into every APK (armeabi-v7a, arm64-v8a, x86, x86_64) -
    every phone downloads all four even though it only ever uses one, and this is usually the
    single biggest chunk of an 80MB RN/Expo APK. x86/x86_64 only exist for Android EMULATORS on a
    PC - no real phone uses them - so restricting to just armeabi-v7a (older 32-bit phones) +
    arm64-v8a (all modern 64-bit phones, i.e. virtually everything sold since ~2018) drops it to
    2 of 4 architectures with zero compatibility loss on real devices. This is a documented,
    current expo-build-properties option (`buildArchs`, overrides Gradle's `reactNativeArchitectures`
    list) - see https://docs.expo.dev/versions/latest/sdk/build-properties/.

    IMPORTANT CAVEAT - this affects your Pixel_6 EMULATOR testing: a Windows-hosted Android Studio
    emulator (AVD) is normally x86_64-based, and an x86_64 device can't run arm-only native code.
    Since this app.json change is global (applies to every eas.json profile, not just
    production/playstore), a future `eas build --profile preview` + "install on emulator" may fail
    to run correctly on that Pixel_6 AVD once armeabi-v7a/arm64-v8a-only libraries are the only
    ones present. Two ways around that if you still want emulator testing via EAS builds
    specifically: (a) create an ARM64 system image AVD in Android Studio's Device Manager instead
    of the default x86_64 one, or (b) skip the EAS build entirely for day-to-day iteration and use
    `npx expo start` + the Expo Go app (works on the emulator or a real phone, no build/buildArchs
    involved at all) - this is what I'd recommend for routine dev testing regardless, saving actual
    EAS build minutes for real distribution/Play Store builds.

    Expect roughly another 15-25MB off, on top of section 25's minify/shrink-resources savings -
    exact number depends on how much of the original 80MB was native .so payload vs JS
    bundle/assets (which don't change from this).

27. "add 2 sidebar option in our jobscanner Material Transfer and Repair bill / 1. Repair bill
    select * from DMS_RepairBill where PartyName like '%Zomato%' select * from DMS_RepairBillItem
    ... this is from DMSBAPLDATA databse api we craeted and that data fetch for zomato part only
    DMSBAPLDATA databse ... for only this repair bill create this take reference all of this and
    from DMSBAPLDATA databse fetch all data for in this page"
    -------------------------------------------------------------------
    Added two new sidebar options to JobCardScanner's own web app: "Material Transfer" and
    "Repair Bill". Repair Bill is fully wired up and live; Material Transfer is a placeholder -
    see the note at the bottom of this section on why.

    KEY FACT THAT MADE THIS SIMPLE: the DMSBAPLDATA connection string you pasted
    (epc-db.ccbwwugws73u.us-east-1.rds.amazonaws.com,1433, User Id=admin) is the EXACT SAME AWS
    RDS SQL Server instance JobCardScannerDb itself already runs on (see ConnectionStrings:
    JobCardScannerDb in appsettings.json) - just a different Database= name (DMSBAPLDATA vs
    JobCardScanner), same admin credentials already sitting in that file. So this didn't need a
    new server, a new firewall rule, or a new secret - just a second ConnectionStrings entry.

    Backend (new files):
      - backend/JobCardScanner.Api/Services/DmsBaplDataService.cs - new IDmsBaplDataService /
        DmsBaplDataService, read-only, raw ADO.NET (Microsoft.Data.SqlClient), same pattern as the
        existing BaplDmsService.cs (which reads the LIVE BAPLDMSvad database - DMSBAPLDATA is a
        DIFFERENT, separate, synced/replicated database, populated by your existing AutoGeniusSync
        process, not the live DMS). GetRepairBillsAsync(partyNameFilter) queries
        dbo.DMS_RepairBill (header) + dbo.DMS_RepairBillItem (line items, batched in one follow-up
        query keyed by the header IDs just read) - exact table/column names as you specified
        (`select * from DMS_RepairBill` / `DMS_RepairBillItem`), field shapes mirrored 1:1 from the
        AutoGeniusSync.Models.DmsRepairBill/DmsRepairBillItem classes you pasted. partyNameFilter
        defaults to "Zomato" (LIKE '%Zomato%') at the controller level - pass an empty string to
        see every party (not exposed in the UI yet, kept for flexibility).
      - backend/JobCardScanner.Api/Controllers/DmsBaplDataController.cs - new controller,
        GET /api/dms-bapl-data/repair-bills?party=Zomato. Same auth gate as the rest of the staff
        app (Policies.ServiceAdvisorUp - ServiceAdvisor and up). 502 with the real error message on
        a genuine DMSBAPLDATA connection/schema problem; an empty result set is a normal 200.

    Backend (edited):
      - Program.cs - registered the new service: AddScoped<IDmsBaplDataService, DmsBaplDataService>().
      - appsettings.json - added ConnectionStrings:DMSBAPLDATAConnection (same server as
        JobCardScannerDb, Database=DMSBAPLDATA, same admin credentials) with an explanatory
        _DMSBAPLDATAConnection_comment entry, same convention as the other three connection strings
        already in this file (JobCardScannerDb/BaplConnection/BAPLDMSvadConnection).

    Frontend (new files):
      - web/src/pages/staff/RepairBillPage.tsx - the "Repair Bill" page. Party Name search box
        (defaults to "Zomato"), a table of bill headers (Invoice No/Date/Dealer/Party Name/Reg
        No/Chassis No/Location/Bill Type/Item count/Bill Amount - Bill Amount computed client-side
        as the sum of each item's totAmnt, since DMSBAPLDATA's header row has no stored total of
        its own), click a row to expand its Part/Labour line items (Item Code/Description/Type/
        Qty/Rate/Issue Type/CGST/SGST/IGST/Total). Column layout takes its cue from BAPL DMS's own
        repair-bill-list.html you pasted (Bill No/Date/Party Name/Reg No/ChassisNo/Location/Bill
        Type/Bill Amount) - a few LIVE-DMS-only columns (Job No, Status, Prepared/Modified by) have
        no equivalent in DMSBAPLDATA's synced copy and are left out rather than guessed.
      - web/src/pages/staff/MaterialTransferPage.tsx - PLACEHOLDER, see note below.

    Frontend (edited):
      - web/src/components/StaffLayout.tsx - added "Material Transfer" and "Repair Bill" to the
        sidebar NAV_ITEMS (visible to every signed-in staff role, same as "Reports & Search" - no
        role restriction, since nothing about this data is role-specific the way Parts/Admin are).
      - web/src/App.tsx - added routes: /material-transfer, /repair-bill (both inside the existing
        StaffLayout/RequireStaff wrapper, same as every other staff page).
      - web/src/types/index.ts - added DmsBaplDataRepairBill / DmsBaplDataRepairBillItem TypeScript
        interfaces (camelCase, matching ASP.NET Core's default JSON casing) - kept deliberately
        distinct from the existing BaplDmsRepairBill/BaplDmsInvoiceLineItem interfaces, which are a
        different shape sourced from the LIVE BAPLDMSvad database, not DMSBAPLDATA.
      - web/src/styles/global.css - added one small `.text-end { text-align: right; }` rule for
        the new page's amount/qty columns (nothing existing used right-alignment before this).

    IMPORTANT - "Material Transfer" is a placeholder, not wired to any data:
    Unlike Repair Bill, you didn't give me a table name, column names, or even confirmation that a
    Material Transfer table exists in DMSBAPLDATA at all - the AutoGeniusSync source you pasted
    only covers RepairBill/RepairBillItem. Guessing table/column names against a REAL production
    database risks either a hard SQL error or, worse, silently wrong results, so I didn't invent
    one. The sidebar link and route both exist and the page loads (matching "add 2 sidebar option"),
    but it just explains this and asks for the real table. To finish it: run
    `select * from <table>` against DMSBAPLDATA for whichever table holds your Material Transfer
    documents and send me the table + column names (and whether it should be Zomato-scoped by
    PartyName the same way Repair Bill is) - I'll wire it up the same way as this section.

    NOT verified locally: this sandbox has no network access to nuget.org (package restore is
    blocked by this environment's proxy policy), so I could not run `dotnet build` here to confirm
    the C# compiles - I reviewed it carefully by hand against BaplDmsService.cs's own working
    patterns (same SqlConnection/SqlCommand/SqlDataReader style, same Policies/Program.cs DI
    conventions) but please do a build on your end before deploying. The frontend DID build clean -
    `npx tsc --noEmit` passed with no errors after these changes.

28. "now material tranfer using location wise which dealer login that location wise which already
    we done w1..wn series for / select * from DMS_MaterialTransfer [...] select * from
    DMS_MaterialTransferItem [...] select * from DMS_MaterialTransferLabor [...] give for this
    option like this BAPLDMSvadConnection"
    -------------------------------------------------------------------
    "Material Transfer" is now fully wired up (was a placeholder in section 27) - real table/column
    names from DMSBAPLDATA's dbo.DMS_MaterialTransfer / DMS_MaterialTransferItem /
    DMS_MaterialTransferLabor (all three confirmed via the `select *` output you shared), scoped by
    LocCode - i.e. the SAME per-dealer W1..Wn DMS workshop-location resolution already built for
    the Parts & Inventory page's "DMS Parts Inventory" panel (GET /api/bapl-dms/workshops), reused
    as-is rather than reinvented, per "which already we done w1..wn series for".

    Backend (edited - extended the same DmsBaplDataService/DmsBaplDataController from section 27,
    since Material Transfer lives in the same DMSBAPLDATA database as Repair Bill):
      - Services/DmsBaplDataService.cs - added DmsBaplDataMaterialTransferRow/
        DmsBaplDataMaterialTransferItemRow/DmsBaplDataMaterialTransferLaborRow records (field
        shapes mirrored 1:1 from the AutoGeniusSync.Models.DmsMaterialTransfer/
        DmsMaterialTransferItem/DmsMaterialTransferLabor classes you pasted) and
        GetMaterialTransfersAsync(locCode) - three queries (header, then items batched by header
        id, then labour batched by item id - same "batch the child rows" shape as
        GetRepairBillsAsync from section 27), filtered `WHERE LocCode = @locCode` (exact match,
        same convention as BaplDmsService.GetPartsInventoryAsync's `DealerLocation = @loc`). Empty/
        no locCode -> empty result, same "nothing selected yet" rule as DMS Parts Inventory - never
        an unscoped scan across every dealer. The DMS_MaterialTransfer.Action column (AutoGeniusSync's
        JSON audit-trail blob) is deliberately left out of the shape - sync bookkeeping, not
        something the page needs to show.
      - Controllers/DmsBaplDataController.cs - added GET /api/dms-bapl-data/material-transfers?locCode=...,
        same auth gate and 502-on-real-DMSBAPLDATA-error convention as the Repair Bill endpoint.

    Frontend (edited):
      - web/src/types/index.ts - added DmsBaplDataMaterialTransfer/DmsBaplDataMaterialTransferItem/
        DmsBaplDataMaterialTransferLabor interfaces.
      - web/src/pages/staff/MaterialTransferPage.tsx - REPLACED the section-27 placeholder with a
        real page: fetches this dealer's own workshop location(s) the exact same way PartsPage
        does (GET /api/bapl-dms/workshops?dealerId=..., auto-selects the first one, a dropdown if
        more than one), then lists that location's material transfer documents (Doc No/Date/
        Dealer/Location/Technician/Item count), expandable per row to show each item (Item Name/
        Description/Type/Qty/Rate/MRP/computed Amount = qty*rate - discount + gst) plus any labour
        lines attached to that item.

    NOT verified locally, same caveat as section 27: no nuget.org access in this sandbox, so
    `dotnet build` could not be run here - reviewed by hand against this file's own section-27
    patterns (which follow BaplDmsService.cs's established style). `npx tsc --noEmit` passed clean
    after these changes.

29. [Two screenshots of an external "Employee Master"/"Manage Employee" reference app, plus a
    `select * from Users` schema dump of this app's real Users table] + "i want to create user
    page for creating user for define W1 location list like attached in that form only in that i
    wants only wants feilds ..Employee Name,State,City,Pincode (State,City,Pincode for this 3
    wants dependancy which i state select that under city with search functionality in dropdown,
    and that city pincode), Mobile No.,DOJ(dd-mm-yyyy),Designation(in that dropdown add option
    select , Supervisor, Mechanic),Work Area(here all worklocation shown w1...wn all for that user
    define and same checkbox add according to screenshot for that user we can define multiple
    location for when this user login only that location regarding all page jobcard , material
    transfer,repairbill , data he can see he can create job),Email/Login Id. , Password and then
    save and in that page grid also all user can edit delete that all functionality create and
    give me"
    -------------------------------------------------------------------
    New "Add Employee" card on the existing Admin: Users page (web/src/pages/staff/
    AdminUsersPage.tsx), backed by a Work-Area location-scoping mechanism enforced server-side on
    every page that shows job data. This reuses the exact same W1..Wn DMS workshop-location list
    (GET /api/bapl-dms/workshops) already wired up for Parts & Inventory and Material Transfer in
    sections 27-28, rather than building a second location source.

    FIELDS - exactly the list you asked for, nothing extra:
      Employee Name, State (dropdown), City (typeahead), Pincode, Mobile No., DOJ (date picker,
      stored/sent as ISO yyyy-MM-dd, displayed as an HTML date input - browsers render this in the
      user's own locale, e.g. dd-mm-yyyy in India), Designation (dropdown: Supervisor / Mechanic),
      Work Area (checkbox list with Select All / Clear All / Search, matching your reference
      screenshot), Email/Login Id, Password. A Dealer picker appears only for Corporate/System
      Admin (a Dealer Admin's own employees are always created under their own dealer - there's
      nothing to pick).

    DECISION - State/City/Pincode "dependency" (Fact + Interpretation, flagged per policy on never
    inventing data): you asked for these three to cascade (pick State -> City list narrows -> City
    determines Pincode). There is no verified India State/City/Pincode master dataset anywhere in
    this codebase or in either connected database (JobCardScannerDb, BAPLDMSvad, DMSBAPLDATA) - I
    checked. Fabricating one (or worse, a plausible-looking but wrong one) risks silently bad
    addresses on real employee records, which the org's accuracy rule explicitly rules out. So this
    ships as: State is a fixed, correct reference dropdown (28 states + 8 union territories, not
    sourced from any of your databases since none was needed - this is just the standard list);
    City is free-text with typeahead (an HTML datalist, currently empty - it's wired so a real
    city-list source can be dropped in later); Pincode is a plain 6-digit-validated free-text
    field. None of the three currently constrain each other. Recommendation: if you have (or your
    BAPL/DMS side has) a real Pincode master table, point me at it and I'll wire true cascading
    dropdowns - India Post's own PIN code API is the usual public source if there's no internal one.

    DECISION - Designation vs. Role (Interpretation, worth understanding before you rely on it):
    your screenshot's "Designation" field is a job title for display, but this app's real
    authorization is driven by a separate `StaffRole` enum with 8 values and policy tiers checked
    on every page/endpoint. Rather than add "Supervisor"/"Mechanic" as two more StaffRole values
    (a much larger, riskier change touching every [Authorize] policy in the app), Designation is
    stored as its own field for display and MAPPED to an existing Role at save time:
      Supervisor -> WorkshopManager
      Mechanic   -> ServiceAdvisor
    IMPORTANT finding that shaped this mapping: I checked Program.cs's policy definitions before
    picking these, because the obvious-sounding mapping ("Mechanic" sounds like "Technician") would
    have been wrong. `StaffRole.Technician` is excluded from every named authorization policy in
    this app (ServiceAdvisorUp, WorkshopManagerUp, etc.) - a Technician can sign in but cannot
    create a job card, view Material Transfer, or view Repair Bill. Since you explicitly required
    "when this user login ... he can create job", mapping Mechanic to Technician would have shipped
    a user who can log in but can't do the one thing you asked for, and it wouldn't have been
    obvious until someone actually tried. Mechanic maps to ServiceAdvisor instead - the lowest role
    that actually satisfies every policy this page's linked features need.

    WORK AREA - how the location scope actually works (mechanism, so support requests make sense
    later): the checked LocCodes are stored as a JSON array string on a new User.WorkLocationCodes
    column, stamped into that user's auth token as an `app_work_locations` claim on their NEXT
    sign-in (both the Local/Dealer-JWT login path and the Azure AD path were updated in parallel -
    a location change while someone is already signed in takes effect the next time they log in,
    not immediately), and enforced server-side (not just hidden in the UI) in three places:
      - GET /api/jobcards (list) and GET /api/jobcards/{id} - filtered/blocked to the caller's
        assigned locations.
      - POST /api/jobcards (create) - 403 if the job card's Service Location isn't one of the
        caller's assigned locations.
      - GET /api/dms-bapl-data/material-transfers - 403 if locCode isn't one of the caller's
        assigned locations (or missing entirely, for a scoped user).
    An employee with NO Work Area boxes checked is unrestricted (identical to how every user
    behaved before this feature existed) - Work Area is an optional narrowing, not a mandatory
    field, matching "for that user we can define multiple location" rather than "must define at
    least one."

    GAP - Repair Bill was deliberately NOT location-scoped (Fact, disclosed rather than faked):
    DMSBAPLDATA's DMS_RepairBill table (used by the Repair Bill page from section 27) has no
    LocCode column - only a free-text Location name string, with no confirmed 1:1 mapping to the
    W1..Wn LocCode values used everywhere else. Matching on the free-text name would be fragile
    (whitespace/casing/renames silently break it) and risks showing a scoped user someone else's
    bills, which is worse than the current behavior of not scoping it at all. If DMSBAPLDATA gets a
    LocCode column added to Repair Bill (or you can confirm an exact Location-name-to-LocCode
    mapping), tell me and I'll extend the same enforcement there.

    GRID - Edit / Delete (Fact): the existing grid at the bottom of Admin: Users now has Designation,
    City/State, and Work Area (location count) columns, plus Edit and Delete buttons alongside the
    existing Activate/Deactivate toggle. Edit reopens the Add Employee card pre-filled (password
    field stays blank - leaving it blank on save keeps the existing password unchanged). Delete is
    a new HARD delete endpoint (DELETE /api/users/{id}) - distinct from the existing Deactivate,
    which just disables login. Delete refuses to let you delete your own account, and asks for
    confirmation before sending the request; there's no "undo" once it's gone, so Deactivate is the
    safer everyday choice and the grid's Delete button intentionally still requires a confirm
    dialog. Recommendation: if any deleted employee might have job cards, photos, or worklogs
    already attached to their UserId, confirm with your team whether those foreign keys are
    nullable/cascade-safe in your actual production schema before using Delete on anyone with
    activity history - I did not audit every FK reference to Users.Id in this pass, since the
    request was specifically about the create/edit/delete UI, not a data-retention policy.

    OPEN QUESTION - who can reach this page at all (flagging, not deciding for you): Admin: Users
    (and its sidebar link) is currently restricted to CorporateAdmin/SystemAdmin only - this was an
    earlier, deliberate restriction already in the code (see the comment in
    web/src/components/StaffLayout.tsx) predating this Employees feature, and I left it as-is
    rather than silently loosening an access-control decision I didn't make. The practical effect:
    a Dealer Admin cannot get to this "Add Employee" form to manage their own dealer's staff today,
    only HQ Corporate/System Admin can - even though the API-level policy on UsersController is
    already the broader DealerAdminUp. If Dealer Admins are meant to manage their own employees
    (which "for that user we can define multiple location" and the Dealer picker's dealer-scoped
    behavior both suggest), tell me and I'll widen both the sidebar link and the /admin/users route
    guard to include DealerAdmin - it's a one-line change in two files, just not one I'll make
    silently on a page that currently only HQ can open.

    Backend (new fields/endpoint, all additive - no existing column dropped or renamed):
      - Models/MasterData.cs - added State, City, Pincode, DateOfJoining, Designation,
        WorkLocationCodes to the User entity (all nullable - every existing user row is
        unaffected).
      - Program.cs - extended the self-healing startup migration block with idempotent
        `IF NOT EXISTS (... sys.columns ...) ALTER TABLE [dbo].[Users] ADD ...` statements for
        all six new columns, matching this project's existing no-EF-Migrations-folder convention.
      - Dtos/Requests.cs - CreateUserRequest/UpdateUserRequest extended with the same six fields
        (all optional/nullable) plus an optional Password on UpdateUserRequest for changing a
        Local-login password from the Edit form.
      - Controllers/UsersController.cs - Create/Update persist the new fields and apply the
        Designation -> Role mapping (Update only overrides Role from Designation when the caller
        didn't also explicitly send a Role); new DELETE /api/users/{id} (self-delete blocked,
        dealer-scoped exactly like Update already is).
      - Auth/DealerJwtTokenService.cs and Auth/AppClaimsTransformation.cs - both stamp the new
        app_work_locations claim (kept in sync - Local logins mint claims at token-issue time,
        Azure AD logins get theirs stamped per-request by AppClaimsTransformation, so both paths
        needed the same addition).
      - Services/ICurrentUserService.cs / CurrentUserService.cs - new WorkLocationCodes property,
        fails open (returns "unrestricted") if the claim is ever malformed, so a bad claim can
        never lock someone out entirely.
      - Controllers/JobCardsController.cs - List/Get/Create enforcement described above.
      - Controllers/DmsBaplDataController.cs - MaterialTransfers enforcement described above.

    Frontend (edited):
      - web/src/pages/staff/AdminUsersPage.tsx - new "Add Employee"/"Edit Employee" card (all
        fields above), INDIA_STATES constant, Designation dropdown, dealer-scoped Work Area
        checkbox panel (Select All/Clear All/Search) reusing GET /api/bapl-dms/workshops exactly
        as PartsPage.tsx and MaterialTransferPage.tsx already do, Edit/Delete wired into the
        existing grid. The old "Add staff user manually" card is kept, renamed to "Add staff user
        manually (Azure AD)" with updated guidance pointing corporate/Azure-AD hires there and
        dealer/workshop employees to the new card instead.

    NOT verified locally (backend): same caveat as sections 27-28 - this sandbox has no network
    access to nuget.org, so `dotnet build` could not be run here. All ten backend files were
    reviewed by hand against this project's own established patterns (claims-transformation shape,
    self-healing-migration shape, controller auth/error conventions) - please run a real build on
    your end before deploying.

    VERIFIED (frontend): `npx tsc --noEmit -p web/tsconfig.json` passed with zero errors after
    every change in this section, including the full AdminUsersPage.tsx rewrite.

30. [Screenshot of the section-29 "Add Employee" card, showing the Work Area box with an unwanted
    horizontal scrollbar under the checkbox list, and the Select All/Clear All buttons stretched
    into oversized rectangles] + "ui not fixed properly fix this otherwise create seperate page
    with grid and mobile no. 10 digit"
    -------------------------------------------------------------------
    ROOT CAUSE of the reported UI bug (found, not guessed): the Work Area toolbar (Select All /
    Clear All / Search / "N of M selected") reused this app's shared `.form-row` class - which is
    a CSS GRID with `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))`, meant for
    label+input field pairs. Applied to a row of small buttons instead, it forced each one into an
    oversized 200px+-wide grid cell - exactly the stretched "Select All"/"Clear All" boxes visible
    in your screenshot - and the checkbox list's `overflowY: 'auto'` with no matching `overflowX`
    left the horizontal axis at the browser's implicit "auto" (per the CSS overflow spec, an axis
    left at its default becomes 'auto' once the other axis is set to a scrolling value), which is
    what surfaced as the stray horizontal scrollbar under the list.

    FIX applied (both parts, not just one) - AND moved to its own page:
      - The toolbar row is now an explicit flex layout (not `.form-row`), so the buttons render at
        their normal compact size and the search box grows to fill the remaining space - matching
        every other compact button row already in this app (e.g. the Suggest Part/Labour rows on
        Job Card Detail).
      - Both the checkbox list and its outer bordered box now explicitly set overflowX to hidden,
        closing off the CSS quirk above for good rather than relying on there being no overflow.
      - Per "otherwise create separate page with grid" - rather than just patching the bug in place,
        Employees is now its OWN sidebar page/route (web/src/pages/staff/EmployeesPage.tsx),
        separate from Admin: Users. Admin: Users had grown to five stacked cards (Azure AD sync,
        BAPL bulk import, DMS Logins, manual Azure-AD add, and the Employees card) - splitting
        Employees out gives the Add/Edit form and its grid the whole page to themselves, which is
        also just better information architecture (matches how Material Transfer/Repair Bill
        already got their own pages in section 27 rather than being tabs inside Job Cards).
        Admin: Users is now back to exactly its pre-section-29 shape (Azure sync, BAPL import, DMS
        Logins, manual Azure-AD add + its original plain grid) - nothing else on that page changed.

    ACCESS - resolves the open question flagged in section 29's delivery, without touching the
    existing HQ-only page: the new /employees route (and its sidebar link) is gated to
    DealerAdmin/CorporateAdmin/SystemAdmin - the exact same DealerAdminUp floor UsersController's
    API already enforces - so a Dealer Admin can now actually reach this to manage their own
    dealer's staff. Admin: Users itself is untouched and stays CorporateAdmin/SystemAdmin-only, so
    no existing restriction was loosened - this is a new, correctly-scoped page, not a widened old
    one.

    MOBILE NO. - now enforced as exactly 10 digits (Fact, matches standard Indian mobile number
    length): the input strips any non-digit character as you type and stops accepting more after
    10 digits (same pattern already used for the 6-digit Pincode field), and Save is blocked with
    an inline error if a partial number was left in the field. Left blank, Mobile No. is still
    optional, same as before - only a non-empty value is required to be exactly 10 digits.

    Frontend (edited/new):
      - web/src/pages/staff/EmployeesPage.tsx - NEW - the Add/Edit Employee card and Employees
        grid, moved out of AdminUsersPage.tsx with the toolbar/overflow fixes and the 10-digit
        Mobile No. validation described above. Same fields, same Work Area/location-scoping
        behavior as section 29 - only the layout and the page it lives on changed.
      - web/src/pages/staff/AdminUsersPage.tsx - reverted to its pre-section-29 shape: the
        Employees card, its state/handlers, and the enriched grid columns/Edit/Delete buttons were
        all removed (they live in EmployeesPage.tsx now); the grid is back to Name/Email/Role/
        Dealer/Active/Activate-Deactivate.
      - web/src/App.tsx - new /employees route, gated to DealerAdmin/CorporateAdmin/SystemAdmin.
      - web/src/components/StaffLayout.tsx - new "Employees" sidebar link, same role gate.

    No backend changes in this section - everything here was a frontend layout/routing fix; the
    Work Area/location-scoping mechanism, the Designation->Role mapping, and every backend
    enforcement point from section 29 are unchanged.

    VERIFIED: `npx tsc --noEmit -p web/tsconfig.json` passed with zero errors after this section's
    changes (both the new EmployeesPage.tsx and the reverted AdminUsersPage.tsx).

31. [Large pasted backend console log: repeated `IDX10517 ... kid is missing` /
    `SecurityTokenSignatureKeyNotFoundException` / `IDX10223 ... token is expired` lines from the
    AzureAd JWT bearer handler, ending in the frontend showing "Access not set up yet" / "Could not
    load your JobCardScanner profile. Contact your admin." and the note "...login page not open" -
    plus local URLs (backend Swagger on :5263, web app on :5173), no explicit question asked]
    -------------------------------------------------------------------
    DIAGNOSIS (Fact, traced through the actual code, not guessed from the log alone):

    Most of the `[AzureAd JWT] Token REJECTED - ... kid is missing` lines are EXPECTED, harmless
    noise, not the bug - every staff authorization policy in this app tries BOTH the AzureAd and
    DealerJwt bearer schemes on every single request (Program.cs, `RoleUp`/`Policies.Staff`:
    `.AddAuthenticationSchemes(AuthSchemes.AzureAd, AuthSchemes.DealerJwt)`). A real "Dealer /
    Workshop Login" token (DealerJwtTokenService.cs) is signed with a plain HMAC secret and never
    gets a "kid" header at all, so the AzureAd handler - which only knows how to check Azure AD's
    own RSA keys by kid - always rejects it and logs exactly this line. This is already documented
    in Program.cs as a deliberate 2026-09-03 diagnostic, and it fires on every request from anyone
    using the local login, whether or not anything is actually wrong.

    The REAL failure was the very next line each time: `IDX10223: Lifetime validation failed. The
    token is expired. ValidTo (UTC): '9/17/2026 9:09:35 PM'` - that's the DealerJwt handler
    correctly rejecting the SAME token as genuinely expired. DealerJwtTokenService issues an 8-hour
    token by default (`DealerAuthJwt:ExpiryMinutes`, defaults to 480) with no refresh mechanism at
    all - unlike the Azure AD path, where `web/src/api/client.ts` calls MSAL's
    `acquireTokenSilent()` before every request and it transparently renews the access token behind
    the scenes using MSAL's own refresh token. A Dealer/Workshop login has nothing playing that
    role: once 8 hours pass (e.g. a browser tab left open overnight, matching the ~7-hour gap
    between the token's ValidTo and the log's timestamps), every single request 401s from then on.

    Compounding it: `getDealerSession()`/`isAuthenticated` in StaffAuthContext.tsx only check
    whether a session OBJECT still exists in localStorage - never whether the JWT inside it has
    actually expired. So the app kept believing the person was signed in, `RequireStaff.tsx` never
    took its "not authenticated -> redirect to /login" branch, and the person was stuck forever on
    the dead-end "Access not set up yet" card instead of being sent back to a working login screen
    - exactly matching "...login page not open" in the message.

    FIX (frontend only - no backend change, this was a session-lifecycle bug, not an auth-config
    bug): web/src/api/client.ts now has a `staffApi` response interceptor - on any 401 where a
    Dealer/Workshop session is on file, it clears that stale session and hard-navigates to /login
    (a full page reload, so MSAL/StaffAuthContext reinitialize from nothing, same as the existing
    manual Sign Out already does). A 401 while signed in via Azure AD with NO dealer session on
    file is deliberately left untouched - that's the OTHER, intentional meaning of "Access not set
    up yet": a real Microsoft account that authenticated fine but has no matching JobCardScannerDb
    User row yet, which should keep showing "contact your admin", not bounce to /login (redirecting
    that case would just loop, since MSAL already considers them signed in).

    NOT a bug, for the record (Interpretation, so it isn't mistaken for one later): the Azure AD
    Client ID/Tenant ID/Audience/Scope across backend appsettings.json and web/.env were checked
    and are internally consistent (frontend SPA app registration's own Client ID, correctly
    distinct from the backend API's own Client ID/Audience, same Tenant ID, matching scope) - this
    was not a misconfigured app registration.

    RECOMMENDATION (not applied - a product decision, not a bug fix): DealerAuthJwt:ExpiryMinutes
    is a config value (appsettings.json), so if 8 hours is shorter than a typical workshop shift
    plus admin/office use, it can simply be raised there - no code change needed. A proper refresh-
    token flow for the Dealer/Workshop login (so a session renews itself the way MSAL's does,
    instead of just living longer before hitting the same wall) would be a larger change; flagging
    it rather than building it silently, since it's a scope/priority call for you to make.

    Frontend (edited):
      - web/src/api/client.ts - added the `staffApi` response interceptor described above.

    VERIFIED: `npx tsc --noEmit -p web/tsconfig.json` passed with zero errors after this change.
    Could not be verified end-to-end against a real expired Dealer JWT in this sandbox (no backend
    process running here to log into) - please confirm on your end that leaving a Dealer/Workshop
    tab open past its token's expiry now lands cleanly back on /login instead of the old dead-end
    card.

32. "and which we create page for craete user in that all location shown of workshop dont add
    feild for dealer selection" + "...which Work Area we created employee when we login this in
    jobcard in material transfer, Repair bill that worklocation only selected data shown in jobcard
    also which Work Area we create user for only 1 location or multiple only tht location bind for
    this and also i want change whole project ui login page... [see section 33 for the UI part] ...
    and this Work Area for employee login for 'CorporateAdmin', 'SystemAdmin' this role bind
    properly"
    -------------------------------------------------------------------
    Two separate, concrete asks pulled out of this message (the UI-redesign part is section 33 -
    that one needs your input before starting, see below):

    (a) EMPLOYEES PAGE - removed the "Dealer" field entirely, per "dont add feild for dealer
    selection". Corporate/System Admin (`hasRole('CorporateAdmin', 'SystemAdmin')` - confirmed this
    IS the correct, already-correctly-wired role gate, nothing was broken here) now see and can
    pick from EVERY dealer's Work Area locations directly (GET /api/bapl-dms/workshops with no
    dealerId param - already built for exactly this: "Omit dealerId to search every dealer's
    workshops by name/code"). A Dealer Admin is unaffected - they still only ever see/assign their
    OWN dealer's locations, automatically, no field needed (never had one). Since a Corporate/
    System-Admin-created employee's Work Area can now span more than one dealer, that employee's
    Dealer field is simply left unset (shown as "All" in the grid, the same convention already used
    there) rather than forcing a single arbitrary dealer onto them - Work Area's LocCodes, not the
    Dealer field, are what every enforcement point actually checks, so this costs nothing
    functionally. Editing an EXISTING employee still keeps whatever dealer it already had (never
    silently cleared).

    (b) WORK AREA BINDING, CONFIRMED + ONE GAP CLOSED - "for only 1 location or multiple only tht
    location bind": this was already correct everywhere it was built (Job Card list/detail/create
    and Material Transfer both filter with `allowedLocations.Contains(...)` against the caller's
    full WorkLocationCodes array, so 1 assigned location or several both work identically - nothing
    to fix there). Repair Bill was the one gap, flagged but not closed back in section 29 because
    DMS_RepairBill has no LocCode column. Re-examined this because you asked for it again: DMS_
    RepairBill DOES carry a DealerCode, and a workshop LocCode is always exactly {DealerCode}+"W"+
    a number (confirmed - BaplDmsService already relies on this same fact to recognise "W" locations
    at all). So Repair Bill can now be scoped to the DEALER a caller's assigned location(s) belong
    to, by stripping that "W<n>" suffix back off - an exact match on a real key, not a guess.
    Disclosed limitation, unchanged from before: this is DEALER-level, not per-workshop - a caller
    scoped to only one of a dealer's several W1/W2/etc. workshops will still see that whole dealer's
    repair bills, not just that one workshop's, because Repair Bill's own data has no finer-grained
    location field to filter on. Deliberately did NOT attempt fuzzy-matching the free-text Location
    column against workshop names to get finer granularity - a wrong fuzzy match could leak another
    dealer's data entirely, which is worse than this exact-but-coarser cut.

    Backend (edited):
      - Controllers/DmsBaplDataController.cs - RepairBills now filters its result set by the
        caller's Work Area, mapped to dealer codes as described above. MaterialTransfers unchanged
        (already correct).

    Frontend (edited):
      - web/src/pages/staff/EmployeesPage.tsx - removed the Dealer field/state/fetch entirely;
        Work Area's workshop fetch now branches on `isCorporateOrSystem` (all dealers) vs not
        (caller's own dealer via profile, unchanged); Save no longer requires "select a dealer
        first" for Corporate/System Admin, and sends dealerId as whatever an edited employee
        already had (or null for a brand-new one they create).

    VERIFIED: `npx tsc --noEmit -p web/tsconfig.json` passed with zero errors. Backend change not
    verified with `dotnet build` (same sandbox limitation as every prior backend section - no
    nuget.org access here) - reviewed by hand, please build on your end before deploying.

33. UI REDESIGN REQUEST - NOT STARTED, NEEDS YOUR INPUT: the same message asked to restyle the
    whole JobCardScanner web app (including the login page) to match a screenshot of a different
    BGauss app ("BTL Activity/Proposal Approval" - dark navy sidebar with a green active-link
    highlight, a row of colored "quick action" cards, icon-badge KPI tiles, a purple "ADMIN" pill
    and avatar in the top navbar). This is a real, sizeable design-system change - it touches
    global.css's color tokens, every KPI/card component, the sidebar and topbar chrome, and a full
    login-page rebuild - so rather than guess at exact colors/spacing from one screenshot and
    possibly redo it, I'm holding this for your confirmation on scope before starting (see my chat
    reply for the specific questions - do you want it applied everywhere at once or rolled out
    starting with Login + Dashboard, and how literally should the reference screenshot's palette
    be copied vs. treated as a style reference).

34. WORK AREA - "SELECT WORKSHOP" DROPDOWN NOW ONLY SHOWS YOUR OWN LOCATION(S) (Job Card wizard,
    Material Transfer, Parts & Inventory - web AND mobile): you reported that the New Job Card
    wizard's "Select workshop..." dropdown was still listing every one of a dealer's workshops
    (all 9 of CUS0288's), even for a user like "vishal" whose Employees-page Work Area is set to
    only one location (CUS0288W1) - and you pasted the Users table proving the WorkLocationCodes
    column was correct, so the bug was purely in what the dropdown was CHOOSING to show, not in
    what was saved.

    ROOT CAUSE: /api/auth/me (the endpoint every page calls right after login to get "who is this
    user") never returned WorkLocationCodes at all - only the Users table and the server-side
    enforcement inside JobCardsController.Create/DmsBaplDataController already knew a user's Work
    Area. So no page had any way to filter its OWN workshop dropdown down to just that user's
    location(s); every one of them just asked BAPL DMS for "every workshop this dealer has" and
    showed all of them. The backend was already correctly REJECTING a submission for an
    out-of-scope location - this was purely "the UI is offering a choice it's only going to
    reject," not a security gap.

    FIX:
      - Backend: AuthController.Me() now also returns WorkLocationCodes (deserialized from the
        same JSON column UsersController already reads/writes), reusing the exact same
        deserialize-tolerantly-on-bad-data pattern UsersController uses.
      - Frontend types: CurrentUser (web/src/types/index.ts AND mobile/src/types/index.ts) gained
        a `workLocationCodes: string[]` field. Empty array = unrestricted (Corporate/System Admin,
        or a legacy user with no Work Area set) - unchanged full list in that case.
      - Every page that fetches /api/bapl-dms/workshops now filters the result down to only
        `profile.workLocationCodes` when that array is non-empty, before putting it in the
        dropdown/auto-selecting the first entry:
          Web:    JobCardWizardPage.tsx, MaterialTransferPage.tsx, PartsPage.tsx
          Mobile: JobCardWizardScreen.tsx, PartsScreen.tsx
        (Parts & Inventory wasn't explicitly named in your message but has the identical picker,
        so it's included for consistency - flagging this in case you wanted it left as-is.)
      - Repair Bill has no per-workshop dropdown at all (dealer-wide by design, see section 32), so
        nothing to change there.
      - Mobile-only fix-up: StaffAuthContext.tsx's dealerUserToProfile() builds an instant
        first-paint CurrentUser directly from the cached login session, before /api/auth/me
        resolves - it now sets workLocationCodes to [] (unrestricted) for that split-second window,
        since the cached session never carried this field; the real /api/auth/me call that follows
        moments later overwrites it with the user's actual Work Area, same pattern already used
        there for dealerBaplDmsCode.

    NOT changed: Job Card/Material Transfer's SERVER-SIDE enforcement (already correct, unchanged);
    which locations get saved against a user (Employees page, unchanged from section 32).

    Backend (edited):
      - Controllers/AuthController.cs - Me() now returns WorkLocationCodes; added the
        DeserializeLocationCodes helper.

    Frontend (edited):
      - web/src/types/index.ts - CurrentUser + workLocationCodes.
      - web/src/pages/staff/JobCardWizardPage.tsx, MaterialTransferPage.tsx, PartsPage.tsx -
        workshop fetch now scopes to profile.workLocationCodes.
      - mobile/src/types/index.ts - CurrentUser + workLocationCodes.
      - mobile/src/screens/JobCardWizardScreen.tsx, PartsScreen.tsx - same scoping as web.
      - mobile/src/auth/StaffAuthContext.tsx - dealerUserToProfile() fallback fix-up above.

    VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors in BOTH web/ and
    mobile/. Backend change not verified with `dotnet build` (same sandbox limitation as every
    prior backend section) - reviewed by hand, please build on your end before deploying.

    STILL OPEN / NEEDS YOUR INPUT (not touched this round):
      a) The "Grid Button" part of your last message ("...in employees page Grid Button add in row
         of Add Employee last on that button click saved data shown which are below show Name
         Email Designation Dealer City/State Work Area Active that only shown when click on grid =
         click") - I want to confirm exactly what you mean before building it. My best guess: a
         "View" button on each row of the Employees grid that, on click, expands/opens that one
         employee's full saved details (Name, Email, Designation, Dealer, City/State, Work Area,
         Active) - please confirm or correct this.
      b) Section 33's whole-project UI redesign request - still not started, still needs your
         answer on scope (everywhere at once vs. Login+Dashboard first, and how literally to copy
         the reference screenshot's palette) before I start, since it's a large, hard-to-undo
         design-system change.

35. EMPLOYEES GRID - "VIEW" BUTTON PER ROW: per your last message's second ask ("Grid Button add
    in row of Add Employee last on that button click saved data shown which are below show Name
    Email Designation Dealer City/State Work Area Active that only shown when click on grid =
    click") and your follow-up confirming "expand row inline" - each Employees grid row now has a
    "View" button (last, after Edit/Deactivate/Delete). Clicking it expands that row in place
    (toggles to "Hide" to collapse it again) showing that employee's full saved details: Name,
    Email, Designation, Dealer, City/State, Work Area, Active. The one difference from the grid's
    own columns: the grid's Work Area column only ever showed a count ("2 locations") since there's
    no room for more - the expanded view instead lists every one of that employee's actual
    locations by name and code, resolved from the same workshop list already fetched for the
    Add/Edit Employee card above (covers every dealer's workshops for Corporate/System Admin, or
    just your own dealer's otherwise - always enough to resolve any employee row you can see).

    Frontend (edited):
      - web/src/pages/staff/EmployeesPage.tsx - added expandedId state, the View/Hide button, and
        the expanded detail row.

    VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors.

36. UI REDESIGN - FIRST PASS (sidebar active highlight, topbar avatar + role pill, colored quick-
    action cards): per your request to restyle the whole app to match BGauss's own "BTL Activity/
    Proposal Approval" dashboard (dark navy sidebar + green active-link highlight, colorful
    icon-badge KPI tiles, a purple "ADMIN" pill + avatar in the topbar, colored quick-action
    cards) and your follow-up choosing "apply everywhere at once" for scope. IMPORTANT CAVEAT
    upfront: I no longer have that reference screenshot in view in this session (it was shared a
    few messages back and this reply is picking the conversation back up after a context reset) -
    what follows is built from the detailed description of it captured earlier (dark navy sidebar,
    green active link, icon-badge KPI tiles, purple ADMIN pill + avatar, colored quick-action
    cards), not a pixel-for-pixel copy of the image. Please treat this as a first pass and tell me
    specifically what's off (exact colors, spacing, an element I've missed) so the next round can
    tighten it up, or re-share the screenshot if you'd like me to match it more literally.

    What changed:
      - Sidebar: the active nav link now gets a tinted-green background + a solid green left rail
        (new --nav-active token) instead of the old plain navy-on-navy highlight - this is the one
        piece the reference app's sidebar reads as "on" at a glance.
      - Topbar: added an initials avatar circle + a small role "pill" next to your name, both
        colored by role TIER (not one color per individual role) - CorporateAdmin/SystemAdmin/
        DealerAdmin = purple ("admin" tier, matching the reference app's purple ADMIN pill),
        WorkshopManager = blue ("manager" tier), everyone else (Service Advisor/Technician/Parts/
        Cashier) = teal ("staff" tier). Same avatar+pill pairing now also appears at the top of the
        profile dropdown.
      - Dashboard "Quick links": were plain grey buttons, now a grid of colored cards (new
        .quick-action-card/.quick-action-grid), one accent color each cycling the same 6-color
        palette the KPI tiles already use, each with a small icon.
      - KPI tiles (Dashboard) and the login page (navy hero + BGauss volt-green accent) were
        already close to the reference look from an earlier reskin pass (colorful icon-badge tiles,
        dark navy + green-accent branding) - left as-is rather than redone, since re-guessing new
        colors for something that already mostly matches risked making it worse, not better.

    NOT changed (flagging, not forgotten):
      - Nothing on the mobile (Expo) app - "sidebar/navbar" as described is a web-app concept; the
        mobile app uses its own tab/stack navigation, which wasn't part of what you referenced.
      - No other page's cards/tables were restyled - the KPI/quick-action treatment only exists on
        the Dashboard today (grepped the codebase to confirm no other page has its own KPI grid),
        so "everywhere" here means every element of the type you called out, not a rewrite of every
        page's layout from scratch.

    Frontend (edited):
      - web/src/styles/global.css - new --nav-active/--role-* tokens; sidebar active-link style;
        .avatar-circle/.role-pill; .quick-action-card/.quick-action-grid.
      - web/src/components/StaffLayout.tsx - roleTier()/initialsOf() helpers; avatar + role pill in
        the topbar trigger and the profile dropdown header.
      - web/src/pages/staff/DashboardPage.tsx - Quick links section now renders colored
        quick-action cards instead of plain buttons.

    VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors. This is a pure CSS/
    markup change (no new dependencies, no backend involved) - no `dotnet build` caveat applies
    here, but please do a visual pass on your end since I can't screenshot/preview this app from
    this sandbox.

37. UI REDESIGN - MATCHED TO THE ACTUAL BTL SCREENSHOT (superseding section 36's guesswork): you
    shared the actual "BGAUSS BTL Activity/Proposal Approval" dashboard screenshot this round, so
    this pass replaces section 36's best-guess-from-description version with one built by looking
    directly at it. Specific things matched:

      - KPI tiles: icon badge is now a CIRCLE (was a rounded square), and the label under the value
        is uppercase, bold, letter-spaced small text ("TOTAL PROPOSALS" style) instead of the
        plain-case grey text it was.
      - "ACTION NEEDED" badge: the reference's orange pill sitting on top of a card that needs the
        viewer to act (its "Pending Approval" tile) - added as .kpi-badge-action, and applied to
        the three Dealer Dashboard tiles that represent something waiting on this dealer (Waiting
        for Parts, Waiting Customer Approval, Pending Job Cards) and the Corporate Dashboard's
        Pending Vehicles tile.
      - Role pill: the reference's "ADMIN" badge is a solid filled purple pill with white text, not
        a soft tint - .role-pill switched from soft-background to solid-fill to match exactly.
      - Avatar: the reference's circle avatar is a color independent of the role pill (teal, not
        purple) - realized this is almost certainly per-user, so the topbar avatar now uses this
        user's own saved AvatarColor (User.AvatarColor - already stored per account, e.g. set via
        BAPL import/UsersController) when there is one, only falling back to a role-tier color for
        an account with none set. Topbar layout also now puts the role pill directly beside the
        avatar (both right-aligned) rather than stacked under the name, matching where the
        reference puts its ADMIN pill + avatar.
      - Added a whole new "action card" row (icon-in-circle + bold title + muted subtitle, one card
        filled solid navy) at the TOP of both dashboards, directly copying the reference's own
        4-card header row layout (New Proposal / Review Proposals / Download Report [navy] / Manage
        Users & Activity):
          Dealer Dashboard: New Job Card / Job Cards / Reports & Search [navy, featured] / Employees
          (Employees only shown to DealerAdmin/Corporate/System Admin, New Job Card only to roles
          that can actually create one - same gating the old button/links already had).
          Corporate Dashboard: Job Cards / Reports & Search [navy, featured] / Manage Users &
          Activity / Admin: Workflow - "Manage Users & Activity" is even the same label BTL uses.
        This replaces both the old "+ New Job Card" header button AND the old plain "Quick links"
        card at the bottom of the Dealer Dashboard - they covered the same destinations this one
        row now covers, in the reference's own visual language, so keeping both would have been
        redundant.

    NOT changed (still deliberately out of scope, same reasoning as section 36): the mobile app
    (no sidebar/navbar concept there), and no other page's tables/cards - this pass is Dashboard +
    the shared topbar/sidebar/global tokens, the same surfaces the screenshot itself shows.

    Frontend (edited):
      - web/src/styles/global.css - circular .kpi-icon, uppercase .kpi .label, new
        .kpi-badge-action/.kpi-highlighted, solid-fill .role-pill, new .action-card/
        .action-card-featured/.action-card-grid.
      - web/src/components/StaffLayout.tsx - role pill + avatar reordered and avatar now uses
        profile.avatarColor.
      - web/src/pages/staff/DashboardPage.tsx - new ACTION_CARDS/CORPORATE_ACTION_CARDS row on both
        dashboards; actionNeeded badges on the relevant KPI tiles; removed the now-redundant
        "+ New Job Card" button and "Quick links" card.

    VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors. Pure frontend CSS/markup
    - no backend involved, no `dotnet build` caveat. I still can't screenshot/preview this app from
    this sandbox, so please take a look and tell me if anything needs adjusting - particularly the
    exact icon choices (I mapped BGauss/JobCardScanner concepts to icons that felt equivalent to
    the reference's, not identical emoji-for-emoji).

38. UI REDESIGN - SIDEBAR ICON RAIL, EXACT NAVY, COMPACT KPI ROW, UPPERCASE FORM LABELS, GRID ICON
    BUTTON: you sent three more reference screenshots (RSM Proposal Form page, a "Grid" toggle
    button close-up, and the Dashboard again) plus specific instructions - addressed one by one:

      - "still ui colour --dd-navy: #0a2540" - --navy is now exactly #0a2540 (was #101828), with
        --navy-light/--navy-lighter stepped up proportionally so hovers/borders on the dark chrome
        stay in proportion. This affects the sidebar, topbar, and every "featured" navy card/badge
        that already used this token - no page needed individual edits for this.
      - "navbard side bar all ui page shown same like this" - your screenshots show the SAME
        reference app's sidebar in two states: a narrow always-visible ICON RAIL (its normal state)
        and the wider labeled panel (opened on demand). JobCardScanner's sidebar was a fully-hidden
        overlay drawer before now - it's rebuilt to match both states: on desktop it's now ALWAYS
        visible, defaulting to a 64px icon-only rail (every nav item got an icon), and the hamburger
        button expands it to the familiar 240px labeled panel and back. The active item is now a
        SOLID green filled tile (was a soft green tint) in both states, matched directly against
        your screenshots. Mobile (narrow screens) is unchanged - still a fully-hidden drawer, since
        there's no spare width for a persistent rail on a phone.
      - "small kpi card adjust in 1 line" - KPI tiles are noticeably more compact now (smaller
        icon/padding/font), so a full row of 7-9 tiles fits on one line at typical laptop/desktop
        widths instead of wrapping to a second row.
      - Form field labels ("DEALER *", "STATE *" in your Proposal Details screenshot) are now
        uppercase/bold/letter-spaced - was plain-case grey text before. This is a global `label`
        style, so it applies to every form field on every page automatically, not just one form.
      - "table data shown there like screenshot grid shown after click grid all saved data shown ...
        this data in grid button" - the Employees grid's per-row "View"/"Hide" text button is now
        an icon-only "Grid" button (▦, matching your reference screenshot's own small icon-button
        style) - same expand-in-place behavior as before (still shows Name, Email, Designation,
        Dealer, City/State, Work Area, Active), just restyled to match.

    A NOTE ON SCOPE - please read before the next round: "all page ui like this" is now largely
    true automatically, because every page already shares this same sidebar/topbar/label/button/
    card styling from one global stylesheet - I didn't have to touch each page individually for
    the sidebar, navy color, or label changes above, they apply everywhere at once. What I have NOT
    done is rebuild each individual page's own layout/content (the RSM Proposal Form's specific
    field arrangement, the Grid-view-of-saved-Activities screen, etc.) to visually clone every
    detail of the reference app's other screens - JobCardScanner's pages have different fields and
    workflows than BTL's, so "the same" there would mean redesigning each page's content from
    scratch, not just re-skinning shared chrome. If there's a SPECIFIC JobCardScanner page that
    still looks off after this pass, please point to that one page/screenshot and I'll take it
    from there - "still not looking attractive" without a specific page is hard for me to act on
    further from this sandbox, since I can't render/screenshot the app myself to compare.

    Frontend (edited):
      - web/src/styles/global.css - --navy hex; sidebar rail (desktop) + solid-green active state;
        compact .kpi sizing; uppercase `label`; new .btn-icon.
      - web/src/components/StaffLayout.tsx - icon per NAV_ITEMS; nav-icon/nav-label/logout-label
        spans; sidebar-brand-mark monogram.
      - web/src/pages/staff/EmployeesPage.tsx - per-row View/Hide button restyled to an icon-only
        Grid button.

    VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors. Pure frontend CSS/markup,
    no backend involved. I still can't screenshot/preview this app from this sandbox - please take
    a look, especially the new sidebar behavior (click the hamburger to confirm it expands/collapses
    smoothly and every icon is recognizable), and tell me what still needs adjusting.

================================================================================
39. SIDEBAR: HAMBURGER REMOVED, CLICK-ANYWHERE-ON-SIDEBAR TO TOGGLE + REG NO
    SEARCH FIX + JOB CATEGORY DEFAULT - FINDING
================================================================================

You sent a video showing the 3-line hamburger button being clicked to open the
sidebar, and asked for that button to be removed - clicking the sidebar itself
(anywhere on it) should open/close it instead. You also asked for the Job Card
reg-no search to work the way chassis-no search already does (partial text,
e.g. "p6", surfacing matches), and separately flagged that Job Category shows
B2B by default on http://localhost:5173/jobcards/new.

--------------------------------------------------------------------------------
A) HAMBURGER REMOVED - CLICK THE SIDEBAR ITSELF TO OPEN/CLOSE
--------------------------------------------------------------------------------
This is now a SMALL, targeted change on top of section 38's rail (not another
full redesign pass), as you asked ("only this code give"):

  - The hamburger button (the "☰" in the topbar) is gone completely - it no
    longer exists in the markup or the CSS.
  - The sidebar is now ALWAYS the 64px icon rail, on every screen size
    (previously this was desktop-only from section 38; mobile still had the
    old fully-hidden drawer - now unified to one behaviour everywhere).
  - Clicking anywhere on the sidebar's own background (not on a nav link or
    the logout link) toggles it open (240px, labels visible) and closed (64px,
    icons only) - a mouse cursor and a tooltip ("Click to expand"/"Click to
    collapse") on the sidebar make this discoverable.
  - Clicking an actual nav link or Logout still just navigates/signs out, as
    before - it does not also fight over the open/closed state (this needed a
    small guard so the two clicks - the link's own onClick, and the sidebar's
    new toggle - don't cancel each other out; see the code comment in
    StaffLayout.tsx above handleSidebarClick for the exact reasoning).
  - Clicking anywhere in the main content area while the sidebar is open still
    closes it too (unchanged from before).

Frontend (edited):
  - web/src/styles/global.css - --sidebar is now always the 64px rail with a
    `cursor: pointer`; removed the old desktop-only media query that used to
    gate the rail; removed .hamburger-btn entirely; .main's margin-left is now
    unconditional (64px collapsed / 240px open) at every width, not just desktop.
  - web/src/components/StaffLayout.tsx - removed the hamburger <button>;
    <aside> now has onClick={handleSidebarClick}, a new handler that toggles
    sidebarOpen unless the click landed on a nav link or the logout link
    (checked via closest('a, button')).

VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors.

--------------------------------------------------------------------------------
B) REGISTRATION NUMBER SEARCH FIX
--------------------------------------------------------------------------------
Fact: I re-read the existing chassis/reg-no search code (both the New Job Card
wizard's vehicle lookup and the Job Cards list's search box) and the SQL
already included RegNo in every relevant WHERE clause - there was no missing
column or dead code path. So this isn't a case of reg-no search being absent;
it's a case of it silently failing to match in specific situations.

Interpretation: the most likely cause is registration-number formatting. A reg
no is commonly typed or stored with different spacing/hyphenation for the same
vehicle - "MH12AB1234" vs "MH12 AB 1234" vs "MH-12-AB-1234". Chassis numbers
don't have this problem (no natural separators), which is exactly why chassis
search "just works" while reg-no search can miss a real, present row when the
formatting you type doesn't exactly match what's stored.

Fix: every reg-no comparison now strips spaces and hyphens from BOTH sides
before comparing, so formatting differences no longer cause a miss:
  - New Job Card wizard's vehicle lookup (exact match on Enter/selecting a
    result) and its live-suggestions-as-you-type search - both in BAPL DMS.
  - The Job Cards list's search box (the `q` parameter) - JobCardScanner's
    own database.
Chassis number comparisons are untouched everywhere - they never had this
issue, so there was nothing to fix there.

Backend (edited):
  - backend/JobCardScanner.Api/Services/BaplDmsService.cs -
    LookupVehicleAsync and SearchVehiclesAsync: RegNo comparisons now compare
    REPLACE(REPLACE(RegNo,' ',''),'-','') on both sides.
  - backend/JobCardScanner.Api/Controllers/JobCardsController.cs - List
    action's `q` search: the RegNo branch of the OR now does the same
    strip-and-compare, matching the pattern above. JobCardNumber/customer
    name/mobile search is unchanged (no formatting-inconsistency problem there).

NOT VERIFIED BY BUILD: dotnet build is not available in this sandbox (blocked
by proxy/nuget.org policy), so these three methods have been checked carefully
by hand for correct syntax and EF Core translatability (.Replace() on a string
column translates to SQL REPLACE, and this pattern is already proven working
in BaplDmsService.cs from this same fix) but have NOT been compiled. Please
run a real build/test on your end before deploying, and if you can, please
test reg-no search specifically with a formatting mismatch (e.g. search
"MH12AB1234" for a vehicle stored as "MH12 AB 1234") to confirm the fix.

--------------------------------------------------------------------------------
C) JOB CATEGORY DEFAULT - FINDING (no code change made)
--------------------------------------------------------------------------------
Fact: I checked both the web New Job Card wizard (JobCardWizardPage.tsx) and
the Android app's equivalent screen (JobCardWizardScreen.tsx). In both, Job
Category is declared as `useState<'B2C' | 'B2B'>('B2C')` - it defaults to B2C
- and the ONLY places that ever change it are the B2C/B2B toggle buttons
themselves (i.e. a user has to actively click "B2B" for it to become B2B).
There is no auto-fill, no chassis-lookup side effect, and no other code path
anywhere that sets it to B2B automatically.

Interpretation: since the current source already defaults to B2C with no way
for it to silently become B2B on its own, what you're seeing at
http://localhost:5173/jobcards/new is most likely either (a) a version of the
code from before this default was set to B2C, if an older build is still what
localhost:5173 is actually serving, or (b) the toggle was clicked (even
unintentionally) earlier in that browser session and something is persisting
the choice - though I found no localStorage/sessionStorage/cookie code for
this field, so (b) seems less likely than (a).

Recommendation: please do a hard refresh (or restart the dev server / clear
the browser cache) and check again. If B2B still shows by default after that,
please tell me and I'll take another pass - at that point it would help to
know whether it happens on a totally fresh browser profile too, which would
rule out any cached/local state on your machine.

No code change was made for this - the current code is already correct, and
I did not want to make a speculative edit to code that isn't actually wrong.

================================================================================
40. JOB CATEGORY NOW DEFAULTS TO B2B (CORRECTION) + NEW "VEHICLE SALE" SIDEBAR PAGE
================================================================================

You clarified section 39's Job Category finding: you don't want B2C as the default - you want
B2B to be the default. And you asked for a new sidebar option, "Vehicle Sale", reading from
DMSBAPLDATA's DMS_VehicleSales table (query you ran directly: `select * from DMS_VehicleSales
where SoldTo like '%Zomato%'`), placed right after Job Cards in the sidebar.

--------------------------------------------------------------------------------
A) JOB CATEGORY DEFAULT -> B2B
--------------------------------------------------------------------------------
Changed on both web and Android - New Job Card now opens with B2B pre-selected instead of B2C.
Still fully editable via the same B2C/B2B toggle buttons as before; nothing else about that field
changed.

Frontend (edited):
  - web/src/pages/staff/JobCardWizardPage.tsx - jobCategory's initial useState value: 'B2C' -> 'B2B'.
  - mobile/src/screens/JobCardWizardScreen.tsx - same change, mirrored.

VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors (web).

--------------------------------------------------------------------------------
B) NEW "VEHICLE SALE" SIDEBAR PAGE
--------------------------------------------------------------------------------
Added as a new sidebar item directly below Job Cards, following the exact same pattern already
used for Material Transfer and Repair Bill: a read-only page backed by a new
GET /api/dms-bapl-data/vehicle-sales?soldTo=... endpoint that queries DMSBAPLDATA's own
dbo.DMS_VehicleSales table (a search box defaults to "Zomato", same as Repair Bill's Party Name
box), scoped to your assigned Work Area dealer(s) the same way Repair Bill already is.

IMPORTANT - a column-schema note, please read before relying on this page:
You pasted two different things for this table - (1) the actual result of a `select *` you ran
directly against DMSBAPLDATA, showing columns Id, LedgerId, ChassisNo, ItemCode, ItemName,
ItemColor, DealerId, LocationCode, SaleDate, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, RegNo
(and SoldTo must exist too, since your WHERE clause filtered on it even though it wasn't in the
columns you pasted - most likely just scrolled out of view), and (2) a much larger C# model/DTO/
controller from what looks like a separate sync service ("AutoGeniusSync") with ~60 columns
(DealerName, InvoiceNo, Location, LocCode, Gender, SoldTo, AccountType, addresses, GST/FAME
subsidy amounts, battery/charger/controller numbers, etc.).

Fact: these two shapes don't match - the AutoGeniusSync model is MISSING several fields that ARE
confirmed live in your own query (RegNo, LedgerId, ItemCode, ItemName, ItemColor, DealerId,
LocationCode, CreatedBy, UpdatedBy), which means it can't be a 1:1 description of the exact table
you queried.

Recommendation: rather than guess and risk the query breaking outright (SQL Server errors on a
column that doesn't exist, unlike a wrong value which just looks off), this page and its backend
query use ONLY the columns you directly confirmed via your own `select *`. If DMS_VehicleSales
does carry more useful columns (e.g. SaleType, NetAmount, InvoiceNo), please run
`SELECT TOP 1 * FROM DMS_VehicleSales` and share every column name shown (even with blank/NULL
values) and I'll extend the page to show them.

Page shows: Chassis No, Reg No, Item Name, Color, Sold To, Dealer, Location, Sale Date - sorted
newest sale first, searchable by Sold To (defaults to "Zomato").

Backend (edited):
  - backend/JobCardScanner.Api/Services/DmsBaplDataService.cs - new DmsBaplDataVehicleSaleRow
    record + IDmsBaplDataService.GetVehicleSalesAsync + its implementation (raw SQL against
    dbo.DMS_VehicleSales, same SqlConnection/SqlCommand pattern as the two existing methods in
    this file).
  - backend/JobCardScanner.Api/Controllers/DmsBaplDataController.cs - new
    GET /api/dms-bapl-data/vehicle-sales?soldTo=Zomato action, with the same Work Area dealer-level
    scoping as the existing RepairBills action (matches your assigned WorkLocationCodes, stripped
    to their owning dealer code, against the row's DealerId).

Frontend (new/edited):
  - web/src/pages/staff/VehicleSalePage.tsx - new page (search box + results table), directly
    modeled on RepairBillPage.tsx.
  - web/src/types/index.ts - new DmsBaplDataVehicleSale interface matching the confirmed columns.
  - web/src/App.tsx - new route /vehicle-sale.
  - web/src/components/StaffLayout.tsx - new sidebar item "Vehicle Sale" (🚗), placed directly
    after "Job Cards" as requested. No role restriction, same as Material Transfer/Repair Bill.

NOT VERIFIED BY BUILD: the backend SQL/DbConnection code is unverified by `dotnet build` (not
available in this sandbox) - checked carefully by hand and follows the exact working pattern
already proven in this same file for Repair Bill/Material Transfer, but please build and test on
your end, and please try Search with a few different Sold To values to confirm real data comes
back.

Frontend VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors.

================================================================================
41. VEHICLE SALE PAGE - COLUMN FIX (your "Invalid column name" error)
================================================================================

You ran section 40's build and got: "Invalid column name 'LedgerId'/'ItemCode'/'ItemName'/
'ItemColor'/'DealerId'/'LocationCode'/'SaleDate'/'CreatedBy'/'CreatedDate'/'UpdatedBy'/
'UpdatedDate'/'RegNo'." Every column I'd used except Id, ChassisNo and SoldTo was rejected.

Fact: this proves section 40's column list was wrong, and - importantly - it proves the OPPOSITE
of what I'd assumed. I had deliberately avoided the larger AutoGeniusSync.Models.DmsVehicleSale
schema you'd also pasted, reasoning it didn't match your `select *` grid. The error shows that
model IS the real shape of DMS_VehicleSales - it's what actually produced the column list, and your
original grid must have been scrolled/cut off before showing the columns that matter (it's a ~65
column table, easy to lose columns off the right edge of a grid view).

Fix: rebuilt the query and the whole page around the AutoGeniusSync model's full field list -
dealer/invoice/location details, customer contact, GST breakdown (CGST/SGST/IGST), FAME II subsidy
amounts, battery/charger/controller numbers, institutional/scheme names, and more.

Confirmed-live so far: Id, ChassisNo, SoldTo (these didn't error before). Everything else in this
version is inferred from the model you shared, not yet independently exercised against the live
table - if ANY of the new columns still come back "Invalid column name", please paste the exact
error again (it lists every bad column in one message) and only those need dropping/fixing, not
another full rebuild.

Page now shows a compact main row (Invoice No, Invoice Date, Dealer, Chassis No, Model/Color, Sold
To, Sale Type, Net Amount) with a click-to-expand detail panel per row - Location/City/State,
Executive, Financed By, Vehicle Type/Group, Motor No, Battery/Charger/Controller numbers, full GST
breakdown, FAME II + State FAME II, Institutional/Scheme/Segment names, Booking Date, Reference No,
customer mobile/email/address, and Remarks.

Backend (edited):
  - backend/JobCardScanner.Api/Services/DmsBaplDataService.cs - DmsBaplDataVehicleSaleRow rebuilt
    to the full AutoGeniusSync.Models.DmsVehicleSale field set; GetVehicleSalesAsync's SQL and
    reader mapping rewritten to match (SELECT list uses the model's own property spelling - SQL
    Server matches column names case-insensitively by default, so this should resolve correctly
    even if the real column casing differs slightly, e.g. "SGSTPer" vs "Sgstper").
  - backend/JobCardScanner.Api/Controllers/DmsBaplDataController.cs - Work Area scoping now
    compares against DealerCode (was the old, wrong DealerId field name).

Frontend (edited):
  - web/src/types/index.ts - DmsBaplDataVehicleSale interface rebuilt to match.
  - web/src/pages/staff/VehicleSalePage.tsx - rebuilt with the compact-row + expand-detail layout
    described above (same click-to-expand convention as Repair Bill's line items).

VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors. Backend still not
build-verified (no `dotnet build` in this sandbox) - please build, then run Search and click a row
open to confirm the detail panel populates, and tell me immediately if any column still errors.

================================================================================
42. DOWNLOAD REPORT (EXCEL/PDF) + IMPORT EXCEL (BULK FILTER) + PAGINATION -
    VEHICLE SALE, MATERIAL TRANSFER, REPAIR BILL
================================================================================

Two requests, both applied identically to all three DMSBAPLDATA pages (Vehicle Sale, Material
Transfer, Repair Bill):
  1. "vehicle sale . material transfer, repair bill shown download report excel pdf download
     button insert in starting row download report in all page"
  2. "add pagignation in each page and import excel option add in each"

--------------------------------------------------------------------------------
A) DOWNLOAD REPORT - EXCEL + PDF
--------------------------------------------------------------------------------
Each page now has "Download Excel" and "Download PDF" buttons at the top (right under the page
description, before the search box - the "starting row"). Both export exactly the rows currently
loaded/filtered on screen - same data you're already looking at, generated entirely in the
browser (no new backend endpoint):
  - Vehicle Sale: Invoice No, Invoice Date, Dealer, Chassis No, Item Model, Color, Sold To, Sale
    Type, Location, City, State, Executive, Net Amount, FAME II, CGST/SGST/IGST %, Customer
    Mobile, Reference No, Booking Date.
  - Repair Bill: Invoice No, Invoice Date, Dealer, Party Name, Reg No, Chassis No, Location, Bill
    Type, Items count, Bill Amount (bill-level, not a line-item breakdown - matches the collapsed
    table's one-row-per-bill).
  - Material Transfer: Doc No, Doc Date, Dealer, Location, Technician, Doc Type, Items count
    (document-level, same reasoning as Repair Bill).

New dependencies added to web/package.json: xlsx (SheetJS, for the .xlsx file) and jspdf +
jspdf-autotable (for the .pdf file) - run `npm install` after unzipping this over your project so
these are actually installed before building.

--------------------------------------------------------------------------------
B) IMPORT EXCEL - A READ-ONLY BULK FILTER, NOT A DATA IMPORT
--------------------------------------------------------------------------------
IMPORTANT - please read this before using it: these three pages are documented everywhere in this
codebase as read-only to DMSBAPLDATA ("this app never writes to DMSBAPLDATA"). "Import Excel" here
does NOT create or change any record - it's a bulk LOOKUP FILTER over the rows already loaded on
screen. You upload a small Excel/CSV with a list of values in its first column, and the page keeps
only the rows matching one of those values:
  - Vehicle Sale: matches against Chassis No.
  - Repair Bill: matches against Chassis No OR Reg No (either list works).
  - Material Transfer: matches against Doc No (no chassis field exists at the document level here).

Typical use: paste in a list of chassis numbers from a fleet partner and see only their sales/
bills/transfers, then Download Excel/PDF to get just that filtered set. A "Clear" link appears next
to the download buttons once a filter's active. Starting a new Search (Sold To / Party Name /
workshop location) automatically drops any active import-filter, so it never silently carries over
onto an unrelated result set.

Fact: I interpreted "import" this way because a real data-import into DMSBAPLDATA would be a
fundamentally different, much bigger change - this app has never written to DMSBAPLDATA anywhere,
and doing so risks corrupting AutoGeniusSync's own synced copy or creating records BAPL DMS itself
doesn't know about. If you actually meant "let me upload an Excel to CREATE new
sales/bills/transfers," please say so explicitly and I'll scope that as its own piece of work
rather than guess further - it would need real design (which fields, validation, where it writes,
who's allowed) before touching code.

--------------------------------------------------------------------------------
C) PAGINATION
--------------------------------------------------------------------------------
All three pages now paginate at 25 rows/page (Prev/Next + "showing X of Y" footer under each
table) - client-side, since all three already load their full filtered result set into memory in
one API call (none of the endpoints has server-side paging). A new search, or applying/clearing an
import-filter, resets back to page 1 automatically so you're never stranded on an empty later page.

Frontend (new):
  - web/src/lib/exportReport.ts - exportReportToExcel/exportReportToPdf helpers (SheetJS / jsPDF +
    autoTable), shared by all three pages.
  - web/src/lib/usePagination.ts - client-side pagination hook, shared by all three pages.
  - web/src/components/ReportDownloadButtons.tsx - the Excel/PDF button pair.
  - web/src/components/ImportExcelButton.tsx - the file-picker + parse-first-column control.
  - web/src/components/Pagination.tsx - the Prev/Next footer.

Frontend (edited):
  - web/src/pages/staff/VehicleSalePage.tsx, RepairBillPage.tsx, MaterialTransferPage.tsx - wired
    up all three: download buttons + import filter + pagination, each using its own report-column
    list and its own match-key for the import filter (see part B above).
  - web/package.json - added xlsx, jspdf, jspdf-autotable dependencies.

VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors, and a full `npm run build`
succeeds for every file this round touched (the only build errors present are pre-existing, from
two logo/background image files not included in this sandbox - unrelated to this work, present
before this round too).

================================================================================
43. IMPORT VEHICLE SALE REPORT (REAL FILE FORMAT) + BUTTON COLORS + HIDE
    "SOLD TO" FIELD + 100-ROW PAGINATION DEFAULT
================================================================================

Your message: "this excel format i want to import in my project and button color add Sold To
zomato hide this then count add in pageination count add 100 in 1 page all", with an uploaded
file (Vehicle_Sale_Report2026-Sep-18_15_22.xlsx - a real BAPL DMS/ERP "Vehicle Sale Report"
export, 53,133 rows x 47 columns). Four separate asks, each below.

--------------------------------------------------------------------------------
A) IMPORT NOW ACCEPTS THE REAL "VEHICLE SALE REPORT" FILE FORMAT
--------------------------------------------------------------------------------
Fact: the file you uploaded is NOT the same shape as DMS_VehicleSales (the DMSBAPLDATA table this
page searches) or as this page's own Download Excel/PDF output. It's a separate BAPL ERP report
with its own 47 columns (Model Code, Model Description, OEM Model Name, Chasis No, Reg No, Dealer
Name, Sale Date, Total Amount, etc.) and no shared key back to DMS_VehicleSales's row Id - I
confirmed this by parsing your actual file directly.

Vehicle Sale's "Import Excel" changed from the simple bulk-FILTER used on Repair Bill/Material
Transfer (narrow existing rows to a pasted list) to a full REPLACE: click "Import Vehicle Sale
Report", pick your file, and the page's table/pagination/Download Excel/Download PDF all switch
to show the imported file's rows instead of DMSBAPLDATA's - a "Clear import" link takes you back
to the live DMSBAPLDATA results. Columns are matched by header name (case/spacing-insensitive, so
"Chasis No" as spelled in your file still matches), not by fixed position, so a reordered or
slightly re-worded export should still import correctly - if a column's header doesn't match
anything expected, that field just comes through blank on the imported rows rather than the whole
import failing.

Interpretation - please spot-check this: your file has no "Sold To" column (this page's whole
premise, per the "Vehicle sale from DMSBAPLDATA select * from DMS_VehicleSales where SoldTo like
'%Zomato%'" request that created it). The closest available field is the report's "Name" column
(the invoiced customer/party name) - I mapped Sold To -> Name as a best-effort approximation, but
in the sample rows I checked from your actual file this is mostly individual retail customer names
("Hadamat Singh Keshar Singh", "Ravi chawla", etc.), not institutional buyers like Zomato. This is
NOT the same meaning as DMSBAPLDATA's real SoldTo field. Recommendation: open a handful of imported
rows (click to expand - an "Source: Imported from <filename>" line marks them) and confirm Sold To
reads how you expect before relying on it; if you need a true Zomato-fleet filter over this report
format specifically, tell me which of its 47 columns should drive that and I'll wire it in properly
rather than guessing further.

Fact - large-file performance: parsing your actual 53,133-row file takes roughly 10-12 seconds in
the browser (measured directly against your file). The Import button now shows "Parsing..." and is
disabled while this runs, with the actual parse deferred a tick so that message reliably paints
before the browser locks up on the parse - previously there'd have been no feedback at all for
that whole window.

Fact - PDF export cap: PDF generation (jsPDF/autoTable) renders every row as real paginated pages,
so exporting a 53,000-row PDF would produce a multi-thousand-page file that can take minutes and
substantial memory, or hang the tab outright. Download PDF now caps at the first 2,000 rows on
ANY of the three DMSBAPLDATA pages (not just an imported Vehicle Sale file - this protects Download
PDF generally), with the PDF's own subtitle and filename saying "_first2000" so it's obvious it's
partial. Download Excel has no such cap (SheetJS writes 50,000+ rows in about a second) - use
Excel when you need the full dataset.

--------------------------------------------------------------------------------
B) BUTTON COLORS
--------------------------------------------------------------------------------
Download Excel, Download PDF, and Import buttons (all three pages) are now color-coded instead of
all using the same default gray button style: Excel buttons green, PDF buttons red, Import buttons
blue. New CSS classes (.btn-excel / .btn-pdf / .btn-import) in web/src/styles/global.css.

--------------------------------------------------------------------------------
C) VEHICLE SALE'S "SOLD TO" FIELD HIDDEN
--------------------------------------------------------------------------------
The "Sold To" input box (previously editable, defaulting to "Zomato") is removed from the page.
The query still runs with "Zomato" as a fixed filter behind the scenes - unchanged from what the
page has always shown - it's just no longer an editable/visible field. A "Refresh" button replaces
it to re-run the same DMSBAPLDATA query on demand. If you actually need to search a different
"Sold To" value sometimes (not just hide the box), let me know and I'll add that back as a proper
control rather than a hidden constant.

--------------------------------------------------------------------------------
D) PAGINATION: 100 ROWS PER PAGE BY DEFAULT, ON ALL PAGES
--------------------------------------------------------------------------------
Default page size changed from 25 to 100 rows, applied to all three DMSBAPLDATA pages (Vehicle
Sale, Material Transfer, Repair Bill). It's also now a visible "Rows per page" dropdown (25 / 50 /
100 / 200) next to the Prev/Next controls, rather than a fixed number, so it can be changed on the
fly without needing another round of code changes if 100 turns out to be too many/few for a given
page.

Frontend (edited):
  - web/src/types/index.ts - DmsBaplDataVehicleSale gets two new optional fields: regNo (the real
    VSR report has one; DMS_VehicleSales does not) and isImported (marks rows that came from a
    file import rather than DMSBAPLDATA, for the detail panel's "Source:" line).
  - web/src/pages/staff/VehicleSalePage.tsx - header-matching Excel parser (mapVsrRow/
    normalizeHeader/makeRowGetter) for the real Vehicle Sale Report format; full dataset-replace
    import state (importedRows/importedFileName/importing) instead of Repair Bill/Material
    Transfer's simple ID-list filter; Sold To input removed in favor of a fixed constant + Refresh
    button; new Reg No column in the table.
  - web/src/pages/staff/RepairBillPage.tsx, MaterialTransferPage.tsx - no import-logic changes,
    just pick up the new button colors and the 100-row pagination default automatically (Pagination
    and usePagination are shared components).
  - web/src/lib/usePagination.ts - default page size 25 -> 100; also now returns pageSize/
    setPageSize so each page can offer the dropdown.
  - web/src/components/Pagination.tsx - added the "Rows per page" 25/50/100/200 dropdown.
  - web/src/components/ReportDownloadButtons.tsx - buttons now use .btn-excel/.btn-pdf.
  - web/src/components/ImportExcelButton.tsx - now takes a required headerCandidates prop and
    matches columns by header name (falls back to column A, with an on-screen note, if no header
    matches) instead of always assuming column A; button now uses .btn-import; shows a short status
    line ("Matched N values from the "X" column") next to the button.
  - web/src/lib/exportReport.ts - added the PDF_ROW_CAP = 2000 cap described in part A.
  - web/src/styles/global.css - .btn-excel/.btn-pdf/.btn-import color classes.
  - web/package.json - unchanged from section 42 (xlsx, jspdf, jspdf-autotable already added).

VERIFIED: `npx tsc --noEmit -p tsconfig.json` passed with zero errors, and a full `npm run build`
succeeds for every file this round touched - the only build errors present are the same 4
pre-existing ones from two logo/background image files not included in this sandbox (unrelated,
present before this round too). Also directly Node-tested the real uploaded file against the new
parsing/mapping code (XLSX.read + sheet_to_json + mapVsrRow) to confirm timing (~10-12s) and to
confirm actual Sold To values coming through are individual customer names, not "Zomato" - see the
caveat in part A. Backend is unchanged this round (no .cs files touched), so no new build-
verification gap beyond what section 42 already flagged.

================================================================================
44. NEW SIDEBAR PAGE: "SERVICE HISTORY" (DMSBAPLDATA'S DMS_SERVICEHISTORY),
    SINGLE CHASSIS/REG SEARCH BOX
================================================================================

Your message: "here i want after Jobcards this table Servive History From DMSBAPLDATA databse
and like screen shot when search chasis or reg in 1 input box dont add filter by in 1 input box
we can search chassis no. or reg no and search", with two screenshots of the legacy
mydmsconnect.com "Vehicle History Card Report" page, an uploaded PDF sample of that report, a real
5-row `select * from DMS_ServiceHistory where PartyName like '%Zomato%'` result, and your
AutoGeniusSync DTOs/controller/EF model source. Once mid-build you added: "grid show like other
page job cards with pagination and all only now" - a plain grid + pagination like Vehicle
Sale/Repair Bill/Material Transfer, not the legacy page's expandable card layout.

--------------------------------------------------------------------------------
A) WHAT THIS PAGE IS
--------------------------------------------------------------------------------
New "Service History" entry in the sidebar, placed immediately after "Job Cards" (before Vehicle
Sale) per your instruction. It reads DMSBAPLDATA's dbo.DMS_ServiceHistory - synced job history,
same read-only convention as every other DMSBAPLDATA page here.

ONE search box - deliberately not the legacy page's "Filter By: Chasis No / Reg No" dropdown. You
type a Chassis No. or Reg No. and hit Search/Enter; the backend checks the typed value against
BOTH columns itself (`ChassisNo LIKE @search OR RegNo LIKE @search`), so there's nothing to pick
before searching. There's no default listing the way Vehicle Sale/Repair Bill default to "Zomato" -
a chassis/reg lookup only means something once something's typed - so the page starts empty and
only queries on demand.

--------------------------------------------------------------------------------
B) A CONTEXT GAP I HIT MID-BUILD, WORTH KNOWING ABOUT
--------------------------------------------------------------------------------
Partway through building this, a session context reset dropped the exact column list from your
originally-pasted DmsServiceHistory.cs model and the 5-row sample - I still had my own summary of
having verified 62-vs-63 fields, but not the literal column names anymore. Rather than guess DB
column names for a live query (this codebase already has one cautionary tale of that - Vehicle
Sale's first version - see section on DMS_VehicleSales above), I asked you to re-paste the model,
which you did in full plus the live header/row pair. Every column below is confirmed against that
re-paste, cross-checked field-by-field against the live row - nothing here is guessed.

That re-paste also resolved the earlier "63 live columns vs 62 model properties" discrepancy: it
was never a missing/mystery column - the live table has one extra column, "Status" (sitting between
UpdatedAt and RepairType), that your own DmsServiceHistory.cs model deliberately doesn't map,
since JobStatus (a DB-computed, PERSISTED column) is the field actually meant to be read. This page
follows the model's own choice and leaves "Status" out too.

--------------------------------------------------------------------------------
C) WHAT'S NOT ON THIS PAGE, AND WHY
--------------------------------------------------------------------------------
Fact: DMS_ServiceHistory carries job-level TOTALS only (Parts/Accessory/Oil/Labour/OutsideWork/
TotalWOTax/GSTAmount/IGSTAmount/NetTotal) - there is no part/labour code/description/HSN/SAC
line-item child table behind it in DMSBAPLDATA, unlike DMS_RepairBill (which has
DMS_RepairBillItem). The legacy report PDF you shared shows a per-job Item Detail / Labour Detail /
Battery Detail breakdown - that isn't available from this table (confirmed against your own pasted
ServiceHistoryController.cs and DmsServiceHistory.cs, neither of which reference any such child
table), so it isn't shown here. Per your later "grid ... like other page" instruction, this page is
a flat one-row-per-job grid with pagination, matching Vehicle Sale/Repair Bill/Material Transfer -
no expandable detail panel, since there's no extra detail behind a row to expand into.

Backend (new):
  - backend/JobCardScanner.Api/Services/DmsBaplDataService.cs
      + DmsBaplDataServiceHistoryRow record (62 confirmed columns/types)
      + IDmsBaplDataService.GetServiceHistoryAsync(searchTerm, ct)
      + GetServiceHistoryAsync(): named-column SELECT from dbo.DMS_ServiceHistory, WHERE
        IsRowTotal = 0 AND (ChassisNo LIKE @search OR RegNo LIKE @search) - IsRowTotal excludes
        AutoGeniusSync's own subtotal/summary pseudo-rows (same convention your pasted
        ServiceHistoryController.cs applies on every one of its own endpoints). Blank/whitespace
        search returns an empty list without querying DMSBAPLDATA at all.
  - backend/JobCardScanner.Api/Controllers/DmsBaplDataController.cs
      + GET /api/dms-bapl-data/service-history?search=... - 400 on a blank search, 502 with the
        real error message on a genuine DMSBAPLDATA problem, same dealer-level Work Area scoping
        (WorkshopSuffix-stripped DealerCode allow-list) as RepairBills/VehicleSales above it.

Frontend (new/edited):
  - web/src/types/index.ts - new DmsBaplDataServiceHistory interface (camelCase mirror of the
    backend record).
  - web/src/pages/staff/ServiceHistoryPage.tsx (NEW) - single search box (Chassis No. or Reg No.,
    Search button + Enter key), results grid, ReportDownloadButtons (Excel/PDF), Pagination
    (100/page default) - same shared components as the other three DMSBAPLDATA pages.
  - web/src/components/StaffLayout.tsx - new "Service History" nav item added right after "Job
    Cards" (before "Vehicle Sale"), no role restriction - same as its sibling DMSBAPLDATA pages.
  - web/src/App.tsx - new route: /service-history -> ServiceHistoryPage.

VERIFIED: `npx tsc --noEmit` (full project) passed with zero errors. `npm run build` fails with the
same pre-existing errors as every prior round in this sandbox (two missing logo/background image
files, unrelated to this change - see section 43's own VERIFIED note; confirmed those two files
are simply absent from web/src/assets here, not something this round removed). Backend (.cs)
changes are NOT independently compiler-verified in this sandbox (no working `dotnet build` here,
same disclosed limitation as every backend change in this project) - reviewed carefully by hand
against the confirmed column list, but please do a real `dotnet build` on your side before
deploying.

================================================================================
45. SERVICE HISTORY PAGE - REVISED: CHASSIS/REG TYPEAHEAD DROPDOWN (LIKE JOB
    CARD'S SEARCH BOX) + "VEHICLE INFO" SUMMARY CARD + FULL HISTORY GRID BELOW
================================================================================

Your feedback after section 44 shipped: "when i serach P or reg no. any initial not showing and
whole data show in grid without search and after any search only this cahssis no or reg no", then,
with the legacy mydmsconnect.com page's own Chasis No/Reg No dropdown screenshotted: "like in
jobcard in search by chassisno. how it after p6 search or reg no. search in dropdown suggetion and
that chasiis data in form show like attached pdf format with any search cahssis all data shown in
below grid" - and finally, confirming the match style with those same screenshots: "LIKE".

--------------------------------------------------------------------------------
WHAT WAS WRONG AND WHAT CHANGED
--------------------------------------------------------------------------------
Fact: the section 44 version was a plain text box - type a value, hit Search, get a flat grid.
Since DMS_ServiceHistory is matched with `LIKE '%value%'` (substring, matches anywhere in the
string), typing a short/partial value could match a large share of chassis numbers at once (most
contain common letters somewhere in the middle) - which is what you ran into, not a broken query.
Your screenshots of the legacy page's own Chasis No/Reg No search confirmed this same LIKE/
substring behavior is the reference system's actual, intended design (typing "P6" or "R" there
also returns a long dropdown list for the same reason) - so the fix isn't to change the match style,
it's to add the same DROPDOWN the legacy page (and this app's own Job Card wizard) already has, so
you pick ONE real vehicle from the list instead of reading an unfiltered flat grid.

This page's search box now reuses the EXACT SAME typeahead your Job Card wizard's "Search by
chassis no. / registration no." box already has - same endpoint, same 2-character minimum, same
300ms debounce, same dropdown row format (Chassis No + Reg No + Model, with Sale Date underneath).
No backend change was needed for the dropdown itself - GET /api/bapl-dms/vehicle-suggestions
already existed for the wizard and is reused as-is.

Selecting a suggestion (or typing a full chassis/reg no. and hitting Search/Enter) now shows:
  - A "Vehicle Info" summary card up top: Chassis No, Reg No, Model, Brand, and the most recent
    visit's Party Name/Mobile/Dealership + a Total Visits count. NOTE: this is NOT a field-for-field
    copy of the legacy PDF's own "Vehicle Info" box (Sold Through/Booking/Lead Date) - those are
    Vehicle SALE fields from DMS_VehicleSales, a different table (see the separate "Vehicle Sale"
    sidebar page for that data), not anything DMS_ServiceHistory itself carries. Nothing here is
    invented to visually match the PDF - only fields this table actually has are shown.
  - Every DMS_ServiceHistory row for that exact chassis/reg (every past service visit) listed in a
    grid below, paginated the same as the other DMSBAPLDATA pages - this satisfies "any search
    cahssis all data shown in below grid".

Frontend (edited):
  - web/src/pages/staff/ServiceHistoryPage.tsx - rewritten: typeahead state/effect/dropdown JSX
    copied from JobCardWizardPage.tsx's own pattern (GET /api/bapl-dms/vehicle-suggestions?q=...
    &take=20), selecting a suggestion immediately runs the DMS_ServiceHistory search
    (GET /api/dms-bapl-data/service-history?search=<exact value>) via the same endpoint section 44
    built; "Vehicle Info" card added above the results grid (uses the .form-row/label styling
    already used by Vehicle Sale's expanded-detail panel); grid below trimmed to the columns that
    make sense once there's a Vehicle Info card above it (Job No/Date/Dealer/Party/Job Head-Type/
    KMS/Mechanic/Supervisor/Status/Net Total).
  - No backend changes this round - reuses GET /api/bapl-dms/vehicle-suggestions (pre-existing,
    built for the wizard) and GET /api/dms-bapl-data/service-history (built in section 44) as-is.
  - No types.ts changes - reuses the pre-existing BaplDmsVehicleSuggestion interface (already there
    for the wizard) alongside section 44's DmsBaplDataServiceHistory.

VERIFIED: `npx tsc --noEmit` (full project) passed with zero errors. `npm run build`'s only failures
are the same pre-existing missing-image errors noted in sections 43/44 (unrelated). No backend (.cs)
files touched this round, so no new build-verification gap beyond what's already disclosed.

================================================================================
46. FIX: SERVICE HISTORY'S DROPDOWN WAS CLIPPED TO A TINY SCROLLABLE SLIVER
================================================================================

Your report, with a screenshot: "this also override fix this" - the chassis/reg typeahead dropdown
added in section 45 was rendering as a tiny, barely-visible scrollable box with cut-off text instead
of a normal dropdown list under the input.

Fact - root cause: the search box sits inside a `.card`-styled container, and `.card`'s own CSS (in
web/src/styles/global.css) sets `overflow-x: auto` so wide tables scroll inside their card instead
of the whole page scrolling sideways. Per the CSS spec, when only one of overflow-x/overflow-y is
set to something other than `visible`, the browser computes the OTHER axis as `auto` too if it was
`visible` - so this card silently also got `overflow-y: auto`, which clipped the dropdown (an
absolutely-positioned child that extends below the card's own height) down into a tiny scrollable
sliver instead of letting it float freely below the input.

Fixed by adding `overflow: 'visible'` as an inline style on just this one card (inline styles beat
the class for the same property) - this un-clips the dropdown without touching the shared `.card`
rule every other page still needs for its own wide-table horizontal scrolling.

Frontend (edited):
  - web/src/pages/staff/ServiceHistoryPage.tsx - one line: the search box's wrapping `.card` div
    now also sets `overflow: 'visible'`.

VERIFIED: `npx tsc --noEmit` passed with zero errors; `npm run build`'s only failures are the same
4 pre-existing missing-image errors from before this work.

================================================================================
47. DASHBOARD: "ALL PAGES" LANDING GRID - ONE-CLICK LINK TO EVERY PAGE
================================================================================

Your message: "in dashboardpage add this all page landing page linking".

Both the Dealer Dashboard and Corporate Dashboard already had a top row of 4 hand-picked shortcut
cards (New Job Card, Job Cards, Reports & Search, Employees / Admin: Users, Admin: Workflow). Added
a new "All Pages" section right below that row, with one card per sidebar page (Job Cards, Service
History, Vehicle Sale, Parts & Inventory, Material Transfer, Repair Bill, Reports & Search,
Employees, Admin: Users, Admin: Workflow) - same card look as the existing shortcut row.

To avoid keeping a second, easily-drifting list of every page/route/icon/role rule, this reuses
StaffLayout.tsx's own NAV_ITEMS (now exported) as the single source of truth - a page's role gating
here always matches its sidebar visibility automatically, including for anything added later. Each
card also got a short one-line subtitle (a new optional `subtitle` field on NAV_ITEMS, sidebar
itself doesn't render it, only this new dashboard grid does).

Frontend (edited):
  - web/src/components/StaffLayout.tsx - NAV_ITEMS and its NavItem interface are now exported (were
    private to this file); added an optional `subtitle` per item for the dashboard cards.
  - web/src/pages/staff/DashboardPage.tsx - imports NAV_ITEMS, filters out /dashboard itself
    (ALL_PAGES), renders it as a new "All Pages" action-card-grid section (same role-based filter -
    hasRole - as the existing ACTION_CARDS row) in BOTH DealerDashboard and CorporateDashboard,
    right below their existing 4-card shortcut row.

VERIFIED: `npx tsc --noEmit` passed with zero errors; `npm run build`'s only failures are the same
4 pre-existing missing-image errors from before this work. No backend changes.

================================================================================
48. SERVICE HISTORY'S DROPDOWN NOW SEARCHES DMS_SERVICEHISTORY ITSELF, NOT THE
    JOB CARD WIZARD'S CHASSISDETAILS TABLE
================================================================================

Your message: "its taken from jobcard i want fetch data in service history from Select * from
DMS_ServiceHistory where PartyName like '%Zomato%'" (with the sample row and your
ServiceHistoryController.cs/DmsServiceHistory.cs re-pasted for reference).

Fact: section 45's typeahead reused the Job Card wizard's own suggestions endpoint
(/api/bapl-dms/vehicle-suggestions) for speed, since it already existed. But that endpoint searches
BAPL DMS's LIVE ChassisDetails table (a sale/stock record) - a different database from DMSBAPLDATA
entirely. That meant the dropdown could suggest a sold vehicle with zero service visits (picking it
would just show "no service history found"), or miss a vehicle whose ChassisDetails row doesn't
cleanly match one in DMS_ServiceHistory. Not correct for a page whose whole point is showing service
history.

Fixed by adding a dedicated suggestions endpoint that queries DMS_ServiceHistory itself, grouped by
ChassisNo (one suggestion per distinct vehicle, most-recently-serviced first) - every suggestion the
dropdown now shows is guaranteed to have at least one real DMS_ServiceHistory row behind it. The
dropdown's second line now reads "Last service: <date>" instead of "Sale date" (that field doesn't
exist in this table - it was borrowed from the wizard's ChassisDetails shape).

Backend (new):
  - backend/JobCardScanner.Api/Services/DmsBaplDataService.cs
      + DmsBaplDataServiceHistorySuggestion record (ChassisNo, RegNo, Model, LastJobDate)
      + IDmsBaplDataService.SearchServiceHistoryVehiclesAsync(q, take, ct)
      + SearchServiceHistoryVehiclesAsync(): `SELECT ChassisNo, MAX(RegNo), MAX(Model),
        MAX(JobDate) FROM DMS_ServiceHistory WHERE IsRowTotal = 0 AND (ChassisNo LIKE @q OR RegNo
        LIKE @q) GROUP BY ChassisNo ORDER BY MAX(JobDate) DESC` - same 2-character minimum as the
        wizard's typeahead, capped at 50 results (default 20).
  - backend/JobCardScanner.Api/Controllers/DmsBaplDataController.cs
      + GET /api/dms-bapl-data/service-history/suggestions?q=...&take=... - always returns 200
        (empty array on a connection problem, same as a too-short query) rather than a 502, since a
        typeahead shouldn't show an error banner for that.

NOTE - Work Area scoping: unlike the main service-history search (which filters by your assigned
Work Area's dealer codes), this suggestions endpoint does NOT scope by dealer - same tradeoff the
wizard's own vehicle-suggestions endpoint already accepts, and no sensitive data is in a suggestion
row (only Chassis/Reg/Model/last-service-date). If you pick a suggestion for a vehicle serviced
outside your allowed dealers, the actual search below correctly comes back empty rather than leaking
that dealer's data - just flagging this so it's a known, deliberate choice, not an oversight.

Frontend (edited):
  - web/src/types/index.ts - new DmsBaplDataServiceHistorySuggestion interface.
  - web/src/pages/staff/ServiceHistoryPage.tsx - typeahead now calls
    /api/dms-bapl-data/service-history/suggestions instead of /api/bapl-dms/vehicle-suggestions;
    dropdown shows "Last service" instead of "Sale date".

VERIFIED: `npx tsc --noEmit` passed with zero errors. Backend (.cs) changes are reviewed by hand
only - no `dotnet build` available in this sandbox - please build on your side before deploying.

================================================================================
49. BGAUSS LOGO IN SIDEBAR + NAVBAR, LOGIN LOGO CENTERED, DASHBOARD ACTION-CARD
    ROW REMOVED (DUPLICATED "ALL PAGES"), AND A NEW "LABOUR MASTER" SIDEBAR PAGE
================================================================================

Four separate requests bundled into one delivery since they landed in the same turn:

--------------------------------------------------------------------------------
49a. Real BGauss logo (sidebar + navbar), replacing the "JobCardScanner" wordmark
--------------------------------------------------------------------------------

Your message: "in place of JobCardScanner i wnt add web\src\assets\BGauss_Logo.png remove header
JobCardScanner and also in navbar add logo give me" - following on from your own local edit that
broke the build with `import bgaussLogo from '../../assets/BGauss_Logo.png'` (wrong relative depth
for StaffLayout.tsx, which lives at src/components/ - one level up from src/, not two).

  - web/src/components/StaffLayout.tsx
      + `import bgaussLogo from '../assets/BGauss_Logo.png'` (corrected path)
      + Sidebar: removed the "JobCardScanner" <h1> (and the emoji "sticker" placeholder from the
        prior round) entirely, replaced with `<img src={bgaussLogo} className="sidebar-logo" />` -
        shown only when the sidebar is expanded, same visibility rule the old wordmark had.
      + Topbar: added the same logo at the far left, ahead of the "< Back" button, via a new
        `<img className="topbar-logo" />`.
  - web/src/styles/global.css
      + New `.sidebar-logo` (max-height 40px, object-fit: contain, hidden when the sidebar is
        collapsed) - replaces the now-removed `.sidebar-brand-sticker*` rules from the prior round.
      + New `.topbar-logo` (max-height 28px, object-fit: contain) for the slimmer navbar bar.

--------------------------------------------------------------------------------
49b. Login page logo centered
--------------------------------------------------------------------------------

Your message: "login page in midlle that css alos add in bloble.css" (login page logo, centered;
that CSS also added in global.css).

  - web/src/pages/staff/LoginPage.css
      + `.jcs-hero-logo` gets `align-self: center` - centers just the logo within the dark hero
        panel; the heading text and scooter image stay left-aligned as before.
  - web/src/styles/global.css
      + Same `.jcs-hero-logo { align-self: center; }` rule added here too, per your explicit ask -
        NOTE: LoginPage.css is the file that actually governs the login page (it loads after
        global.css, so it wins on equal specificity) - the global.css copy is a reference/backstop,
        not the one doing the work day to day.

--------------------------------------------------------------------------------
49c. Dashboard: removed the duplicated top action-card row
--------------------------------------------------------------------------------

Your message (after a clarifying question, since "remove 4 kpi cards" was ambiguous - the 9 KPI
number-tiles further down the page, or something else): "in below Live workshop operations overview
which 4 cards are there im talking about that New Job Card, Job Cards, Reports & Search, Employee" -
i.e. the DEALER DASHBOARD's top ACTION_CARDS row (New Job Card / Job Cards / Reports & Search /
Employees), not the KPI number tiles.

  - web/src/pages/staff/DashboardPage.tsx
      + Removed the `ACTION_CARDS` array and its render block from `DealerDashboard()` entirely -
        the "All Pages" grid right below it already links to Job Cards, Reports & Search and
        Employees, and "New Job Card" is one click from the Job Cards page itself, so the two rows
        were showing largely the same destinations twice.
      + Removed the now-unused `StaffRole` type import (only `ACTION_CARDS`' `roles?: StaffRole[]`
        field used it).
      + Scoped to the Dealer Dashboard only - `CORPORATE_ACTION_CARDS` (Corporate Dashboard, a
        different subtitle/section) is untouched, since your clarification specifically named
        "Live workshop operations overview" (the Dealer Dashboard's own subtitle).

--------------------------------------------------------------------------------
49d. NEW: "Labour Master" sidebar page (import / edit / delete / export)
--------------------------------------------------------------------------------

Your message: "i want create 1 sidebar option also in that Labour Master after Service History ...
i want 1. Partwise 2. Without partwise ... i attached excel format when select this dropdown then
import this both format and in that edit delete export in excel format ... duplicate data dont add
update same data and dont override this data give for both ... just want Effective Date *, Rate
Type *, Upload Excel *(import) in below grid shown ... and create table query in DMSBAPLDATA
database give this ... in dashboard page add this kpi card this sidebar menu option of Labour
master".

FACT (confirmed by opening the two .xlsx files you attached):
  Without Partwise headers: Sr. | Labor Code | Job Descriptions | Model | Labour Rate | IGST |
    CGST | SGST | Tier | Categeory
  Partwise headers: Sr. | Part Code | Part Name | Labor Code | Job Descriptions | Model |
    Labour Rate | IGST | CGST | SGST | Tier | Categeory
  IGST/CGST/SGST are a plain decimal fraction in the sheet (0.18), not a percentage (18) - stored
  and edited as-is, no unit conversion.

ARCHITECTURE NOTE (read this before running anything): every other DMSBAPLDATA page in this app
(Service History, Vehicle Sale, Material Transfer, Repair Bill) is READ-ONLY by explicit convention
- see each "...Connection" comment in appsettings.json. Labour Master is the one exception: you
explicitly asked for its two new tables to live IN DMSBAPLDATA, and this feature DOES write to
them (import/update/delete). That's only possible because DMSBAPLDATAConnection happens to use the
same "admin" SQL login as JobCardScannerDb (same AWS RDS instance, just a different Database=
name), so that login already has write permission there. Nothing here touches the EXISTING synced
tables (DMS_ServiceHistory, DMS_RepairBill, etc.) - only the two new tables below. If DMSBAPLDATA's
credentials are ever locked to genuinely read-only, this feature would need its own writable
connection string instead (e.g. pointed at JobCardScannerDb) - worth a deliberate decision, not a
surprise runtime failure.

RUN THIS FIRST - the SQL script that creates the two new tables (idempotent, safe to re-run):
  backend/JobCardScanner.Api/Sql/2026-09-19_labour-master-tables.sql
    - dbo.LabourMasterWithoutPartwise (LabourCode, JobDescription, Model, LabourRate, Igst, Cgst,
      Sgst, Tier, Category, EffectiveDate, IsActive, CreatedBy/CreatedDate, UpdatedBy/UpdatedDate)
      + a UNIQUE index on (LabourCode, Model, Tier) - the database's own backstop against a
      duplicate slipping in outside the app.
    - dbo.LabourMasterPartwise (same shape plus PartCode/PartName) + a UNIQUE index on
      (PartCode, LabourCode, Model, Tier).

Backend (new):
  - backend/JobCardScanner.Api/Services/LabourMasterImportService.cs
      + Raw ADO.NET (SqlConnection/SqlCommand), same style as DmsBaplDataService.cs - reads
        DMSBAPLDATAConnection, parses the uploaded .xlsx with ClosedXML (already a dependency here
        via ExcelExportService.cs - no new NuGet package needed, unlike the DMS reference code you
        pasted which uses EPPlus).
      + Import is an UPSERT keyed on LabourCode+Model+Tier (Without Partwise) or
        PartCode+LabourCode+Model+Tier (Partwise), case-insensitive: unseen key -> INSERT; existing
        key with a changed rate/GST/category/effective-date -> UPDATE (only that row, in place);
        existing key with NOTHING changed -> left alone entirely, no UpdatedDate churn. This is
        what "duplicate data dont add update same data and dont override this data" means in code -
        no duplicate rows ever accumulate from re-importing the same or an overlapping file.
      + Whole import runs in one SQL transaction - if anything fails partway through, EVERYTHING
        rolls back (no half-imported file).
      + Numeric cells (Rate/GST/Tier) are read via ClosedXML's raw numeric accessor rather than
        formatted text, so a percentage-formatted GST cell in a real production file (displaying
        "18%" while storing 0.18) still parses correctly - verified against your actual sample
        files' plain-decimal values either way.
      + Manual Edit/Delete methods for the grid's own buttons, independent of import.
  - backend/JobCardScanner.Api/Controllers/LabourMasterController.cs
      GET  /api/labour-master/without-partwise?search=...
      GET  /api/labour-master/partwise?search=...
      POST /api/labour-master/without-partwise/import  (multipart: File, EffectiveDate)
      POST /api/labour-master/partwise/import           (multipart: File, EffectiveDate)
      PUT  /api/labour-master/without-partwise/{id}
      PUT  /api/labour-master/partwise/{id}
      DELETE /api/labour-master/without-partwise/{id}
      DELETE /api/labour-master/partwise/{id}
      Gated to [Authorize(Policy = Policies.WorkshopManagerUp)] on EVERY action including plain
      reads - labour rates are pricing data (confidential per your org's own instructions), so this
      is narrower than the other DMSBAPLDATA pages (which any staff role can view). NOT explicitly
      specified in your request - flagging this as a deliberate default; tell me if a wider or
      narrower audience should see this page.
  - backend/JobCardScanner.Api/Dtos/Requests.cs
      + LabourMasterImportForm, LabourMasterWithoutPartwiseUpdateRequest, LabourMasterPartwiseUpdateRequest
  - backend/JobCardScanner.Api/Program.cs
      + `builder.Services.AddScoped<ILabourMasterImportService, LabourMasterImportService>();`

Frontend (new):
  - web/src/pages/staff/LabourMasterPage.tsx
      + Exactly three import fields, no more: Effective Date *, Rate Type * (Partwise / Without
        Partwise - no "--Select--" placeholder), Upload Excel * - no OEM Model field, per your
        explicit "i dont want feild of ... OEM Model *".
      + The same Rate Type selector also drives which grid renders below (columns differ - Partwise
        has Part Code/Part Name, Without Partwise doesn't).
      + Grid: Search box, Edit (opens an inline edit card above the grid, same pattern
        EmployeesPage.tsx already uses for its Add/Edit form - no modal library in this app), Delete
        (window.confirm, same as EmployeesPage's own delete), Download Excel/PDF (reuses
        lib/exportReport.ts + ReportDownloadButtons - same client-side export every other
        DMSBAPLDATA page already uses).
      + Import shows a result banner: "Imported N rows: X new, Y updated, Z unchanged (no
        duplicates added)."
  - web/src/types/index.ts
      + LabourMasterWithoutPartwise, LabourMasterPartwise, LabourMasterImportResult interfaces.
  - web/src/components/StaffLayout.tsx
      + New NAV_ITEMS entry "Labour Master" (icon (calculator)), placed immediately after "Service
        History" per your request, gated to `roles: ['WorkshopManager', 'DealerAdmin',
        'CorporateAdmin', 'SystemAdmin']` - matching the backend policy exactly.
  - web/src/App.tsx
      + New route /labour-master, wrapped in the same RequireRole used by /employees and
        /admin/users, with the same role list as the sidebar gate above.

"in dashboard page add this kpi card this sidebar menu option of Labour master": no extra code
needed for this part - DashboardPage.tsx's "All Pages" grid (added in section 47) already reuses
NAV_ITEMS as its single source of truth, so adding "Labour Master" to NAV_ITEMS above makes it
appear there automatically, role-gated the same way, for every user who can also see it in the
sidebar.

VERIFIED: `npx tsc --noEmit` passed with zero errors. Backend (.cs) changes are reviewed by hand
only - there is still no `dotnet build` available in this sandbox, so please build/test on your
side before deploying, and run the SQL script above against DMSBAPLDATA BEFORE deploying the API
(the endpoints will 502 with a clear "invalid object name" error if the tables don't exist yet).
