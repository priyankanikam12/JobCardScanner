JobCardScanner - change bundle
===============================

NOTE ON THIS BUNDLE: this is a fresh delivery covering the change below only
(the session's earlier running bundle from SECTIONS 92-94 is not reattached
here - if you still need those, ask and I'll regenerate them). Merge this
file into your local project the same way as before: it REPLACES the
existing file at the same relative path.

--------------------------------------------------------------------------
SECTION 95 - Vehicle Sale: switch data source from DMSBAPLDATA to
             BaplConnection (DMS_SaleBill / DMS_SaleBillCustomer)
--------------------------------------------------------------------------

WHAT CHANGED
  backend/JobCardScanner.Api/Services/DmsBaplDataService.cs
    - GetVehicleSalesAsync (backing GET /api/dms-bapl-data/vehicle-sales,
      the "Vehicle Sale" sidebar page) no longer reads DMSBAPLDATA/
      DMS_IOT_DATA's DMS_VehicleSales table at all.
    - It now reads BaplConnection - the same "baplfinal" ERP warehouse
      BaplDealerService.cs already uses for Dealer/Item Master - joining
      dbo.DMS_SaleBill (one row per vehicle sold) to
      dbo.DMS_SaleBillCustomer (the buyer, via CustId) in a single query.
    - Reg No is now read directly from DMS_SaleBill.reg_number - a real
      column on this table. The old two-query workaround (a second,
      batched lookup against DMSBAPLDATA's DMS_ServiceHistory, added in
      the previous bundle's SECTION 92/92-CORRECTION) is removed entirely,
      since it's no longer needed and DMS_SaleBill never needed it in the
      first place.
    - Invoice No now reads DMS_SaleBill.salebill_no (the bill number).
      Invoice Date prefers the real InvoiceDate column, falling back to
      parsing salebill_date (a free-text "dd-MM-yyyy" string) when
      InvoiceDate is blank - your own sample data showed rows where
      InvoiceDate was NULL but salebill_date held a real date
      ("10-08-2022"), so this recovers those.
    - The "Zomato" default filter now matches
      DMS_SaleBillCustomer.first_name (the buyer's name) instead of the
      old DMS_VehicleSales.SoldTo column - same behavior, different
      source column, confirmed against your own
      "select * from DMS_SaleBillCustomer where first_name='Zomato...'"
      query.
    - No frontend changes needed - the JSON field names/shapes returned
      by this endpoint are unchanged, so VehicleSalePage.tsx (table,
      search, Excel/PDF export, Import Vehicle Sale Report) keeps working
      exactly as-is.

WHAT DIDN'T MAP (left null - not guessed)
  DealerName, CustDob, Gender, ExecutiveName, ColorCode, VehicleType,
  FinAmount, AcsryAmount, PreGstdiscAmount, PostGstdisc, ReferenceNo,
  BookingDate, TotalCount, ChargerNo2 have no equivalent column on
  DMS_SaleBill/DMS_SaleBillCustomer and are always null in this response
  now. See the doc comments right above each field in
  GetVehicleSalesAsync for exactly why each one was left out (a few near-
  miss columns like RegDiscAmnt/Group1/ReceiptGUID exist but weren't
  confident enough matches to reuse for a differently-named field -
  flagged individually in the code).

ASSUMPTIONS TO CONFIRM
  - VehicleGroup is mapped from DMS_SaleBill.Group1 - the closest-named
    column, but its exact business meaning wasn't independently confirmed.
    Tell me if that's wrong and I'll null it out or find a better source.
  - Both tables' IsDelete columns are treated as a standard soft-delete
    flag (0/NULL = active) and filtered out. IsBlock on DMS_SaleBill is
    NOT filtered (its meaning wasn't confirmed either) - let me know if
    blocked bills should also be excluded.
  - Ordering changed from "InvoiceDate DESC" to "CreatedOn DESC, Id DESC" -
    InvoiceDate is frequently NULL on older rows in this table, so sorting
    by it first would bury a lot of real sales at the bottom.

SECURITY NOTE - credentials pasted in chat
  You pasted BaplConnection's real password in this conversation
  (Server=sapdatawarehoue.database.windows.net, User Id=BaplReadOnlyUser).
  Per the same guidance already given for the two connection strings
  pasted earlier this session (BAPLDMSvad and DMSBAPLDATA/DMS_IOT_DATA):
  treat this as exposed and rotate it with whoever administers that Azure
  SQL server. I have not echoed it again and won't use it anywhere beyond
  what's already configured in your app's appsettings.json.

--------------------------------------------------------------------------
SECTION 96 - Job Card Wizard: chassis/reg-no lookup off BAPLDMSvad onto
             Vehicle Sale (BaplConnection); Job Type/Service Head/Service
             Type/Job Source/Complaints hardcoded; Service Location hidden
--------------------------------------------------------------------------

WHAT CHANGED

  backend/JobCardScanner.Api/Services/DmsBaplDataService.cs
    - Added LookupVehicleForWizardAsync(value, dealerCode) and
      SearchVehiclesForWizardAsync(q, dealerCode, take) - both read the
      same BaplConnection dbo.DMS_SaleBill/DMS_SaleBillCustomer tables
      GetVehicleSalesAsync already uses (SECTION 95), matching by
      chassis_no (exact) or reg_number (normalized - spaces/hyphens
      stripped from both sides before comparing, same convention
      JobCardsController.List's own RegNo search already uses).
    - Refactored the shared SELECT column list, FROM/JOIN clause and row
      mapper out of GetVehicleSalesAsync into private consts/a private
      method (VehicleSaleSelectColumns/VehicleSaleFromJoin/
      MapVehicleSaleRow) so all three methods read the exact same columns
      the exact same way - no behavior change to GetVehicleSalesAsync
      itself (still the "Vehicle Sale" sidebar page's data source).
    - New DmsBaplDataVehicleSuggestion record (ChassisNo, RegNo,
      ModelName, SaleDate) - the typeahead's lighter-weight shape,
      separate from the full DmsBaplDataVehicleSaleRow record.

  backend/JobCardScanner.Api/Controllers/JobCardsController.cs
    - Added IDmsBaplDataService as a constructor dependency (_dmsBaplData).
    - New GET /api/jobcards/vehicle-lookup?value=&dealerId= - replaces the
      wizard's old GET /api/bapl-dms/vehicle-lookup (BAPLDMSvad) call.
      dealerId (optional) is translated to that Dealer's
      BaplDmsDealerCode and used to scope the DMS_SaleBill match, same
      dealer-code convention already used elsewhere in this controller.
      "already has an open job card" is now a LOCAL-ONLY check against
      this app's own JobCardScannerDb (matches by VIN/chassis no. against
      this dealer's own not-yet-closed job cards) - there's no live DMS
      signal for this any more since DMS write-back to job cards was
      removed on 2026-09-24. A job card opened under a DIFFERENT dealer's
      DMS for the same chassis (if any existed) can't be detected here -
      not a new gap, the old BAPLDMSvad-backed check had the same
      per-dealer blind spot for a chassis serviced across dealers.
    - New GET /api/jobcards/vehicle-suggestions?q=&dealerId= - replaces
      the wizard's old GET /api/bapl-dms/vehicle-suggestions call, same
      dealerId scoping, 2-char minimum, capped at 20 results.
    - Both endpoints gated Policies.ServiceAdvisorUp, same floor as the
      rest of this controller's write/lookup actions.

  web/src/data/serviceCatalog.ts (NEW FILE)
    - JOB_TYPES / SERVICE_HEADS / SERVICE_TYPES / JOB_SOURCES / COMPLAINTS
      - transcribed VERBATIM from the real `select * from JobType` /
        ServiceHead / ServiceType / JobSource / ComplaintMaster result
        sets you pasted on 2026-09-25. This is real business data, not
        invented - see the file's own doc comment for the full source
        note, and for the two rows I excluded as junk/test data (my own
        editorial call, not confirmed by you - the doc comment says
        exactly which two and how to add them back if you want them).
    - serviceHeadsForJobType(jobTypeId) / serviceTypesForServiceHead(id) -
      plain filters, giving the wizard the same Job Type -> Service Head
      -> Service Type cascade shape as before, just resolved locally
      instead of via a live fetch.

  web/src/pages/staff/JobCardWizardPage.tsx
    - Chassis/reg-no lookup (lookupByChassisOrReg), the "search all
      dealers" fallback (searchGlobalChassis) and the typeahead
      (vehicleSuggestions effect) are now repointed at
      /api/jobcards/vehicle-lookup and /api/jobcards/vehicle-suggestions,
      passing dealerId (a Guid) directly instead of a derived BAPL dealer
      code - simpler now that the new endpoints resolve the dealer code
      server-side themselves. vehicleSearchDealerCode is kept only as a
      DISPLAY value (the "registered to dealer X, not this workshop" hint
      on a cross-dealer hit).
    - Job Type/Service Head/Service Type/Job Source/Complaints dropdowns
      now read from the new serviceCatalog.ts constants instead of
      fetching from /api/bapl-dms/job-types, /service-heads/{id},
      /service-types/{id}, /job-sources, /complaints - the Job Type ->
      Service Head -> Service Type cascade behavior (onJobTypeChange/
      onServiceHeadChange) is unchanged, just synchronous now instead of
      an async fetch. The old live-fetch error banner (baplMastersError)
      is gone since there's no fetch left to fail.
    - Service Location (workshop) picker is HIDDEN per your confirmed
      choice ("Hide entirely, auto-use dealer's default location") -
      replaced with a read-only text field showing whichever location got
      auto-selected. The underlying auto-select logic is UNCHANGED: still
      defaults to this dealer's lowest W-series workshop (W1 first) once
      the workshop list loads, and still gets overridden by the specific
      workshop tied to a chassis/reg-no hit when one exists. Supervisor/
      Technician dropdowns still scope off this auto-selected location
      exactly as before - onWorkshopChange (the manual picker's onChange
      handler) was removed since nothing calls it any more.
    - Customer complaints (Customer Voice) stays MULTI-SELECT (pick, Add,
      pick another, Add again) per your confirmed choice ("Keep
      multi-select, just hardcode the list") - now sourced from the fixed
      COMPLAINTS list instead of a live fetch.
    - Priority was ALREADY a hardcoded Normal/High/Urgent dropdown with no
      DMS dependency at all - no change needed there.
    - "DMS" wording that's no longer accurate was updated: the blue badge
      above the Job Card fields panel now reads "Service Details" instead
      of "DMS", and lookup error/not-found messages now say "Vehicle
      Sale" instead of "DMS" (e.g. "wasn't found in Vehicle Sale for this
      dealer" instead of "...in DMS...").

WHAT DIDN'T CHANGE
  - Dealer search/resolve (GET /api/bapl-dms/dealers, POST
    /api/bapl-dms/dealers/resolve), Service Location's underlying fetch
    (GET /api/bapl-dms/workshops), and Supervisor/Technician (GET
    /api/technicians/*) all still call their existing endpoints exactly
    as before - none of that is BAPLDMSvad-backed job-card data, so none
    of it was in scope for this change.
  - _baplDms (IBaplDmsService, BAPLDMSvad) is UNCHANGED in
    JobCardsController.cs - still injected, still used for whatever else
    already used it in this file (not the chassis/reg-no lookup any
    more).

FIELDS THE NEW VEHICLE-LOOKUP CAN'T SUPPLY (left null - not guessed)
  DMS_SaleBill/DMS_SaleBillCustomer has no equivalent for: previous
  odometer reading (vehiclePrevKms), insurance expiry, next service due
  date, warranty odometer/duration/expiry, or customerLedgerId. The
  wizard's own code already treats every one of these as optional
  (`?? null` / optional chaining throughout applyVehicleHit/createVehicle)
  from earlier BAPLDMSvad-lookup days, so this degrades gracefully - those
  fields just stay blank for a vehicle pulled from Vehicle Sale instead of
  erroring. No frontend code change was needed for this to work safely.

ANDROID (mobile/src/screens/JobCardWizardScreen.tsx) - NOT DONE YET
  This request was "for both web and android", but I don't have this
  file's current content in this session (it wasn't pasted, and isn't
  cached from anything read earlier). Paste its current content (or just
  the chassis-lookup/service-details section) and I'll make the matching
  change - same two new endpoints, same serviceCatalog.ts (or an RN
  equivalent) reused from the web side where practical.

TYPE-CHECK NOTE
  This container has no live TypeScript project (web/src/types/index.ts
  wasn't accessible this session either, so BaplDmsVehicleLookup/
  BaplDmsVehicleSuggestion's exact field definitions couldn't be
  re-verified). The new backend response shapes were built to match the
  field names those types already use elsewhere in this same file
  (chassisNo, registerNo, modelName, saleDate, customerName, ...), and
  every field the new endpoint doesn't supply was already handled as
  optional in the existing code. Still worth an `npx tsc --noEmit` /
  `npx oxlint` pass on your end before merging, same as always.

--------------------------------------------------------------------------
SECTION 97 - Job Card Wizard: match your screenshot (hide Service Type/
             Source/Supervisor/Technician), new Job Type/Service Head
             categorization, Priority relabeled, Complaints as buttons
--------------------------------------------------------------------------

WHAT CHANGED (all in web/src/pages/staff/JobCardWizardPage.tsx unless noted)

  web/src/data/serviceCatalog.ts
    - JOB_TYPES replaced with the categorization you gave directly: Accidental
      / Major / Minor / Running Repair (ids 1-4).
    - SERVICE_HEADS replaced to match: Accidental (id 1, under Accidental),
      M1/M2 (ids 2-3, under Major), D1/D2 (ids 4-5, under Minor), Running
      Repair (id 6, under Running Repair) - exactly the data you typed, not
      invented. If M1/M2/D1/D2 are placeholders for fuller names, send them
      and I'll swap them in.
    - SERVICE_TYPES is UNCHANGED (still the real ServiceType data from
      SECTION 96) but is now orphaned from the new Service Head ids above -
      harmless, since the Service Type field is no longer shown anywhere
      (see below), so nothing reads it against the new ids.

  Job Type -> Service Head
    - When a Job Type has exactly ONE Service Head (Accidental, Running
      Repair), that Service Head is now auto-selected the instant the Job
      Type is picked - shown as a read-only field, no "Select service
      head…" placeholder. Major/Minor still show a real dropdown (2 options
      each). Matches your instruction ("for 1. Accidental dependancy wants
      Accidental direct select in Service Head bi defualt Accidental dont
      give option Select Service head").

  Fields hidden to match your screenshot
    - Service Type, Source, Supervisor and Technician pickers are REMOVED
      from Service Details (only Job Type, Service Head, Priority, Service
      Location (read-only), Manual Job No., Battery level, Expected
      delivery and Complaints remain, matching your screenshot exactly).
    - The Supervisor/Technician fetch (GET /api/technicians/supervisors,
      GET /api/technicians) was removed along with the pickers.
    - baplSupervisorName/baplTechnicianName/baplJobSourceId/
      baplJobSourceName/selectedServiceTypeId are kept as state (POST
      /api/jobcards still has slots for them) but will always post as
      empty/null now, since nothing sets them any more.
    - ASSUMPTION, NOT CONFIRMED: I'm assuming the backend still accepts a
      job card without Supervisor/Technician/Source/Service Type (Job
      Type/Service Head/Service Location already became optional
      server-side on 2026-09-24). If the backend still hard-requires any
      of these, Create Job Card will fail with a validation error until
      that's relaxed too - test this before relying on it.
    - "Continue to Review" now only requires Job Type, Service Head,
      Expected delivery and at least one Complaint (previously also
      required Service Type/Service Location/Supervisor/Technician/Source,
      which no longer have pickers to fill them in).

  Priority
    - Dropdown now shows "1"/"2"/"3" instead of "Normal"/"High"/"Urgent",
      per your answer to my clarifying question - but still POSTS the same
      Normal/High/Urgent values to the backend (relabeling only). "Other"
      is NOT implemented: JobCardPriority looks like a fixed C# enum
      (JobCardsController.AssignJobCard does `req.Priority.Value` on it),
      and posting an arbitrary 4th value to a strict enum field would very
      likely fail server-side model binding and break Create Job Card
      entirely. Send me the backend's actual JobCardPriority definition
      (or confirm it now takes free text) and I'll wire up a real "Other"
      option safely.
    - The Review step's Priority line was updated to show the same 1/2/3
      label instead of the raw Normal/High/Urgent value.

  Customer complaints (Customer Voice) -> "Complaint"
    - Field relabeled "Complaint" per your "in below headeline Complaint"
      instruction.
    - Dropdown+Add replaced with a button grid (toggle multi-select) -
      showing ALL 8 real complaints, not just 5, per your answer to my
      clarifying question (no usage-frequency data exists to pick a
      genuine "top 5" from).
    - A manual free-text entry (input + Add) is back alongside the
      buttons, per your explicit "and manual type" - this reverses the
      2026-09-03 removal of free-text complaints for this one field only,
      since you asked for it back here specifically.

NOT DONE THIS SEGMENT - NEED MORE FROM YOU

  Vehicle Sale page pagination ("in Vehicle Salepage pagination add on
  start dont add in below fix this"): I don't have VehicleSalePage.tsx's
  current content in this session - it was never pasted here and isn't
  cached (confirmed: it shows only as a "file too large, already
  summarized away" placeholder in this session's history, even further
  back than everything else I recovered for SECTION 96). Paste its current
  content (or just the pagination section) and I'll move the controls to
  the top.

  Android (mobile/src/screens/JobCardWizardScreen.tsx): same as flagged in
  SECTION 96 - still not available in this session. Paste its content (or
  the chassis-lookup/service-details section) and I'll apply the matching
  changes from both SECTION 96 and this one.

TYPE-CHECK NOTE (same caveat as SECTION 96)
  No live TypeScript project in this container - verified by hand (brace/
  paren balance, cross-referencing every removed identifier for stray
  usages) but please still run your usual `npx tsc`/`npx oxlint` pass
  before merging.

--------------------------------------------------------------------------
STILL PENDING FROM EARLIER (unchanged, included below for reference)
  sql/2026-09-25_migrate_labourmaster_to_jobcardscannerdb.sql - the Labour
  Master data migration script, waiting on you to run it and confirm the
  row counts match before I repoint LabourMasterImportService.cs and
  remove the DMSBAPLDATA connection. Not required for today's Vehicle Sale
  change - Vehicle Sale no longer touches DMSBAPLDATA at all after this
  bundle, but Labour Master, Repair Bill, Material Transfer and Service
  History still do, so DMSBAPLDATA/DMSBAPLDATAConnection stays in place
  for now.
