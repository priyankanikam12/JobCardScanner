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

   Note: "Technician Work Log" already auto-advances the Workflow Stage to
   "Work In Progress" when a technician's timer is started - this was
   already implemented (JobCardsController.StartWorklog calls
   WorkflowStageAutomation.AdvanceIfAheadAsync(..., "in_repair", ...)) and
   didn't need a change. If it isn't visibly happening for you: make sure
   the API you're running actually includes this (a rebuild from an older
   checkout wouldn't have it), and that a "Work In Progress"/in_repair stage
   is active for your dealer (Program.cs self-heals the global template on
   every startup, so this should always be true unless a dealer-specific
   override disabled it).

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
