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
   (placed right before Odometer (km), matching DMS's own form):
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
         attachment. It is NOT used for DMS's own repair-bill PDF
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
   card in DMS closed it there, but JobCardScanner's own list kept
   showing it as still open, because nothing ever synced DMS's status
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
   are soft-deleted in DMS itself (IsDelete = 1). The list/search code
   already excludes IsDelete = 1 rows everywhere (same as DMS's own
   convention), so this isn't a bug on our side - those four just don't
   exist in DMS anymore. Only id 80's job card (your "2 / DMS" row) is
   real from DMS's own point of view.

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

9) "DMS" renamed to just "DMS" everywhere it appeared in user-visible
   text (error messages, headings, placeholders, locked-field notices) -
   "from next dont add any where DMS only DMS". This was a plain
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
   "DMS" - e.g. Models/JobCard.cs, Models/MasterData.cs, Program.cs,
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
    cards shown from only 1 create". Since DMS became the sole source
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
