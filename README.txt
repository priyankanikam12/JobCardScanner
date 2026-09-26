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

============================================================================
SECTION 98 (2026-09-25) - Attendance page (web + Android)

WHAT YOU ASKED: "give attendance page for all dealer which i shared in
morning scanario that give give only this page for android and web...only
this page give now"

WHAT I ACTUALLY DID FIRST: searched this entire session, including the raw
pre-compaction transcript file, for any mention of "attendance" or
"morning" before writing a single line of code. Found nothing - no
screenshot, field list, spec, or existing Attendance controller/table/
model anywhere in this project's history as shared with me. I asked you
how to proceed (paste the spec / build a standard version / check the
existing backend first) and you chose "Build a standard version". Everything
below is therefore a STANDARD, ASSUMED design - not copied from your real
requirements - please treat it as a draft to correct, not a finished spec.

NEW FILES

  backend/JobCardScanner.Api/Models/Attendance.cs
    New entity: one row per staff member per calendar day per dealer.
    Status is a 4-value enum (Present / Absent / HalfDay / OnLeave).
    ASSUMPTION: "staff" = the existing Users table (same table
    JobCardsController.Technicians() already reads, filtered by
    Active + DealerId) - I did NOT invent a separate Employee table.

  backend/JobCardScanner.Api/Controllers/AttendanceController.cs
    Four endpoints, [Route("api/attendance")], same
    [Authorize(Policy = Policies.X)] + isOrgWideRole (CorporateAdmin/
    SystemAdmin see every dealer, everyone else locked to their own
    _currentUser.DealerId) pattern already used throughout
    JobCardsController - reused deliberately so this page behaves
    consistently with the rest of the app:
      GET  /api/attendance/dealers-summary?date=   - "all dealer" landing
           view: one row per dealer with present/absent/halfDay/onLeave/
           notMarked counts.
      GET  /api/attendance?date=&dealerId=          - one dealer's full
           staff roster + that day's marks (drill-down).
      POST /api/attendance/mark                     - upsert one person's
           attendance for a day.
      GET  /api/attendance/summary?date=&dealerId=  - counts for one
           dealer (not currently called by the pages below, but there if
           you want a compact header tile row later).

  sql/2026-09-25_create_attendance_table.sql
    CREATE TABLE script for the new Attendance table. ASSUMES SQL Server
    with Guid (UNIQUEIDENTIFIER) primary keys on Users/Dealers, matching
    every Guid usage already visible in JobCardsController. Also assumes
    you'll add `public DbSet<Attendance> Attendance { get; set; }` to your
    JobCardScannerDbContext yourself - I don't have that file in this
    session, so I didn't touch it. If Status needs to be stored as an
    NVARCHAR (as the SQL script does) rather than EF Core's default int,
    add `modelBuilder.Entity<Attendance>().Property(a => a.Status)
    .HasConversion<string>();` to your OnModelCreating.

  web/src/pages/staff/AttendancePage.tsx
    All Dealers table (org-wide roles) -> click a dealer -> staff roster
    with Present/Absent/Half Day/On Leave buttons per person (click =
    saved immediately, same "click = committed" pattern as the Complaint
    buttons in SECTION 97) + optional check-in/check-out time inputs for
    Present/Half Day. Reuses staffApi from '../../api/client' and
    profile.dealerId from useStaffAuth() exactly as JobCardWizardPage.tsx
    already does, so this should drop in cleanly.
    NOT DONE - NEEDS YOU: no <Route> was added to your router (I don't
    have that file) and no sidebar/nav link was added. Add something like
    <Route path="/attendance" element={<AttendancePage />} /> wherever
    your other staff routes live, plus a nav link - tell me the path/label
    you want if you'd rather I picked something other than "/attendance".

  mobile/src/screens/AttendanceScreen.tsx
    Same flow and same three endpoints as the web page, built as a plain
    React Native (no UI kit) screen. READ THE FILE'S OWN DOC COMMENT - the
    caveat here is bigger than anywhere else in this bundle: I have NEVER
    seen a real file from your mobile app in this session
    (JobCardWizardScreen.tsx was confirmed unrecoverable earlier), so the
    API client import (`'../api/client'`), the auth hook
    (`useAuth()` / `profile.dealerId`), and "no UI kit, just
    StyleSheet.create" are all GUESSES at your mobile app's real
    conventions, clearly marked as such inline. The business logic and
    endpoint calls are solid; the wiring around them almost certainly
    needs fixing to match your actual mobile codebase. Also not wired into
    any navigator - I don't have that file either.
    Date is hard-coded to "today" on mobile (no date picker) since I don't
    know if @react-native-community/datetimepicker or similar is already
    in your app - say the word and I'll add one once I know which.

NOT INVENTED, FLAGGED INSTEAD - CONFIRM BEFORE YOU TRUST THIS
  - Whether "staff" for attendance purposes should really be every Active
    user at a dealer (my assumption) or only certain roles (e.g. exclude
    admins, include only Technician/Supervisor/ServiceAdvisor). Currently
    it's everyone Active at that DealerId.
  - The 4 status values (Present/Absent/HalfDay/OnLeave). If you track
    attendance differently (shifts, multiple punches/day, a "Late" state,
    photo/GPS-tagged check-in) tell me and I'll redesign the model - it's
    a new table, so changing it now is cheap.
  - No leave-request/approval workflow, no CSV/Excel export, no monthly
    view, no past-date editing restriction (any date up to today can be
    marked/re-marked by anyone with access right now - add a lock if you
    need one).
  - Route path/nav placement (web) and navigator wiring (mobile) - both
    left for you since I don't have the relevant files.

TYPE-CHECK / BUILD NOTE (same caveat as every other section)
  No live TypeScript or .NET project in this container - verified by hand
  (brace/paren/bracket balance on every new file) but this is genuinely
  new backend surface (new table, new DbContext wiring, new migration) so
  please run `dotnet build`, apply the SQL script to a non-prod database
  first, and run `npx tsc` on both web and mobile before merging.

============================================================================
SECTION 99 (2026-09-25) - Attendance compile-error fixes, from your real DbContext

You pasted the real JobCardScannerDbContext.cs (first time I've seen it in
this session) - thank you, that resolved the DbSet CS1061 errors on your
end already (you'd added the DbSet<Attendance> and OnModelCreating config
yourself). It also surfaced one real bug and one real gap:

FIXED: CS0266 "Cannot implicitly convert Guid? to Guid" on
  existing.MarkedByUserId = _currentUser.UserId. Your real code confirms
  _currentUser.UserId is Guid? (nullable), and this codebase's existing
  actor FKs (JobCard.CreatedById, JobCardStageHistory.ChangedById) already
  follow that nullable convention. Attendance.MarkedByUserId is now
  Guid? to match - updated in Models/Attendance.cs and the SQL script
  (MarkedByUserId is now NULL-able).

FLAGGED, NOT YET FIXED - NEEDS YOUR INPUT: your DbContext's own comment on
  DbSet<Technician> says technicians were moved to their OWN table on
  2026-09-24 ("the new 'Technician Employee' master list (login-less) -
  deliberately its own table, not a User row"). AttendanceController's
  roster queries only read _db.Users right now, which means Technicians
  are currently MISSING from the Attendance page entirely - probably the
  majority of who you actually want to mark attendance for on a workshop
  floor. I don't have Technician.cs (its Id type, Active flag, or any
  other fields), so I haven't guessed at merging it in rather than risk
  another round of compile errors from wrong field names. Paste
  Technician.cs and I'll update List()/DealersSummary()/Summary()/Mark()
  in AttendanceController.cs to pull staff from BOTH Users and
  Technicians.

============================================================================
SECTION 100 (2026-09-25) - App.tsx has no /attendance route (that's the redirect)

Confirmed from your real App.tsx: it ends with
  <Route path="*" element={<Navigate to="/dashboard" replace />} />
and no /attendance route was ever added, so hitting that URL falls straight
into this catch-all. Not a bug in anything shipped so far - the route just
needs adding (see the import+route lines given in chat).

FIXED (real bug, caught from your App.tsx's import style): every page in
  App.tsx is imported as a NAMED export (import { EmployeesPage } from
  './pages/staff/EmployeesPage'), but AttendancePage.tsx was written with
  `export default function AttendancePage()`. A named import against a
  default export resolves to undefined and silently breaks routing/
  rendering. Changed to `export function AttendancePage()` (named export)
  to match every other staff page in this project.

============================================================================
SECTION 101 (2026-09-26) - Self check-in/check-out with shifts (Android login/logout)

WHAT YOU ASKED: "this attendance page for android also wants when i login then this time was
login time and add in that shift when i login on 9 am then 1st shift 9 am to 6pm 1st shift and
then 6 pm to 12 2nd shift before log out chek out need to do that will update"

This is DIFFERENT from SECTION 98/99's AttendancePage.tsx/AttendanceScreen.tsx (a supervisor
manually marking OTHER people's attendance). This is self-attendance: the app records YOUR OWN
login as check-in and YOUR OWN logout as check-out, auto-assigning a shift from the login time.
Both flows write to the SAME Attendance table/row per person per day - a self check-in and a
supervisor's manual mark for the same person/day are the same record, not two separate ones.

NEW

  backend/JobCardScanner.Api/Models/Attendance.cs
    Added `AttendanceShift? Shift` (Shift1/Shift2 enum) - null for anything created only through
    the existing manual Mark() endpoint, only ever set by the new self check-in below.

  backend/JobCardScanner.Api/Controllers/AttendanceController.cs
    Two new endpoints:
      POST /api/attendance/check-in  - for the currently signed-in USER (not an arbitrary
        employeeId - this is always "myself"). Computes IST from a fixed UTC+5:30 offset, decides
        Shift1 (09:00-18:00) vs Shift2 (18:00-24:00) from the login moment, sets Status=Present,
        and only sets CheckInTime/Shift on the FIRST login of the day (a later same-day login just
        re-confirms Present without moving the check-in time).
      POST /api/attendance/check-out - for the currently signed-in user, sets CheckOutTime to now.
        Tolerant of a missing check-in row (creates one) rather than erroring, since logout must
        never be blocked by this.

  sql/2026-09-25_create_attendance_table.sql - Shift column added directly (if you haven't run it
    yet, this is now the version to run).
  sql/2026-09-26_add_attendance_shift_column.sql - run this INSTEAD, ONLY if you already ran the
    original create script before this change.

  mobile/src/services/attendanceCheckin.ts - two small helper functions
    (checkInAfterLogin/checkOutBeforeLogout) that call the two endpoints above. NOT wired into your
    real login/logout screens - I don't have those files in this session (same limitation as
    AttendanceScreen.tsx). Call checkInAfterLogin() right after a successful sign-in and
    await checkOutBeforeLogout() at the very start of your sign-out handler, before clearing the
    auth token. Both swallow their own errors on purpose - see the file's doc comment for why
    logout must never be blocked by a failed network call.

CONFIRMED LIMITATION (from your own DbContext, not a guess): Technicians are a separate,
  login-less table (your own comment: "the new Technician Employee master list (login-less)...
  deliberately its own table, not a User row"). They never sign into the app, so this self
  check-in/check-out can never apply to them - only to Users (people with real logins: Service
  Advisors, Workshop Managers, Supervisors, Admins, etc). If Technicians also need attendance
  tracked, that still only works through the supervisor-marked web page (SECTION 98) unless/until
  Technicians get real app logins - tell me if you want an Android version of that supervisor page
  built too (AttendanceScreen.tsx from SECTION 98 already exists but has its own big caveat - see
  its doc comment).

ASSUMPTIONS - NOT INVENTED, FLAGGED, NEED YOUR CONFIRMATION:
  - IST via fixed +5:30 offset (no OS timezone database lookup) - safe since India has no DST, but
    confirm your server's clock is actually accurate/NTP-synced, since this offset is applied
    blindly to whatever DateTime.UtcNow returns.
  - Shift 1 = 09:00-18:00, Shift 2 = 18:00-24:00, exactly as you described. A login BEFORE 09:00
    (not covered by your description) is currently counted as Shift 1 - tell me if an early
    arrival should be handled some other way (a "Shift 0"? rejected? still Shift 1 as I did?).
  - What happens after midnight but before 9am was also left undefined by your description - right
    now that literally can't happen since Shift2's window (18:00-24:00) already covers up to
    midnight and anything after rolls into "before 09:00" -> Shift 1 above for the NEXT calendar
    day. Confirm that's what you want for someone still logged in working past midnight.
  - Logging in always sets Status=Present, overriding a supervisor's earlier manual mark for that
    day (e.g. OnLeave) - tell me if manual marks should instead take precedence.
  - The web AttendancePage.tsx (SECTION 98) does not yet display the Shift column - tell me if you
    want it added there too.

============================================================================
SECTION 102 (2026-09-26) - Zomato API integration (new controller + shared doc)

WHAT YOU ASKED: share 3(/4 - you selected all 4 options I offered) APIs with Zomato, live at
https://3.88.172.79, plus a document for the Zomato team like the ANV Web one you attached.

WHY A NEW CONTROLLER: JobCardsController/RepairBillDocsController/MaterialTransferDocsController
are all gated by your staff Azure AD/dealer login ([Authorize(Policy = Policies.Staff/
ServiceAdvisorUp)]) - an external system like Zomato can't use that. The ANV Web document you
attached uses a completely different scheme (a static X-API-Key header, no login), so this mirrors
that pattern in a brand-new controller instead.

NEW FILE

  backend/JobCardScanner.Api/Controllers/ZomatoIntegrationController.cs
    [AllowAnonymous], own X-API-Key check (CheckApiKey()) reading configuration key
    "Zomato:ApiKey" - NOT hardcoded, and NOT the same key as ANV Web's. Four endpoints:
      POST /api/zomato/jobcards              - creates a job card, resolving-or-creating the
        Customer/Vehicle from whatever Zomato sends (dealerCode/chassisNo/customerMobile/etc.) -
        Zomato has no way to know your internal GUIDs, unlike a signed-in staff user.
      GET  /api/zomato/jobcards/{jobCardNumber} - status lookup.
      GET  /api/zomato/repair-bills            - bills where staff set Party Name = "Zomato"
        (reuses RepairBillDocsController.Combined's own existing party="Zomato" default - not a
        new idea, just a new access point to it).
      GET  /api/zomato/material-transfers      - transfers where staff set Party Name = "Zomato".

BEFORE THIS CAN GO LIVE - TWO THINGS ONLY YOU CAN DO:
  1. Add a real API key: appsettings.json (or an environment variable/User Secrets)
       "Zomato": { "ApiKey": "<the real key>", "SystemUserId": "<a real Users.Id guid>" }
     SystemUserId is a NEW requirement: JobCard.CreatedById is a required FK, and there's no
     signed-in staff user for an API call, so you need to create ONE User row once (e.g. Name
     "Zomato API", Active, no real login) and put its Id here. Until BOTH values are set, every
     endpoint returns 503 rather than silently working with a fake identity.
  2. Confirm https://3.88.172.79 actually has a valid TLS certificate installed. A bare IP over
     HTTPS very often means self-signed, which most HTTP clients (including whatever Zomato's
     backend uses) reject by default - flagged in the document's Section 0 too.

NOT INVENTED, FLAGGED INSTEAD:
  - How a Zomato-originated job card is tagged: JobCardSource has no "Api"/"Zomato" value today,
    so Source defaults to "Others" and ServiceType to "PaidService"/Priority to "Normal" - all
    three are one-line changes if you want a dedicated source value later.
  - Linking a job card created via this API to a LATER Repair Bill/Material Transfer for Zomato
    billing is NOT automatic - staff still have to type Party Name as exactly "Zomato" on that
    bill/transfer for it to appear in the two GET feeds above. This API doesn't touch that step.
  - Security posture: API key only, no IP allowlist - same level as your existing ANV Web
    integration, explicitly called out as a trade-off in the document's Section 0, not a silent
    assumption.

NEW FILE (deliverable for Zomato, not code)

  Zomato_Integration_Data_API.docx - mirrors your attached ANV Web document's structure exactly
    (cover table, per-endpoint Method/Endpoint/curl/Sample Response). Base URL is
    https://3.88.172.79. The X-API-Key value is a clearly-marked PLACEHOLDER
    ("<TO BE PROVIDED BY BGAUSS - PENDING>") - you said you'd give me the real key but it wasn't in
    your last message, so nothing fake was put in its place. Send me the real key and I'll swap it
    in and rebuild the document before you forward it to Zomato.

TYPE-CHECK / BUILD NOTE
  New backend surface, not build-checked (no live .NET project in this container) - please run
  `dotnet build` and test all four endpoints against a non-prod database before this reaches
  Zomato, especially the Create Job Card resolve-or-create logic.

============================================================================
SECTION 103 (2026-09-26) - ZomatoIntegrationController.cs: 3 real compile errors fixed

You pasted 3 real Roslyn errors from ZomatoIntegrationController.cs. Two were a genuine C# gotcha,
one was a wrong guess on my part - fixed differently:

FIXED (CS0119 x2, lines ~166/188): the GET endpoint action was named `JobCardStatus(string)` -
  IDENTICAL to the `JobCardStatus` ENUM already used elsewhere in this same class (`JobCardStatus.
  Closed`, `JobCardStatus.Open`). Inside a class, a method whose name matches a type name shadows
  that type for plain "Name.Member" lookups anywhere else in the SAME class - so every bare
  `JobCardStatus.Whatever` in this file was resolving to the method instead of the enum. Renamed the
  action to `GetJobCardStatus` - no route/behavior change, purely a rename.

NOT FIXED THE SAME WAY (CS0117, line ~184): `Source = JobCardSource.Others` - your compiler
  confirms `Others` isn't a real member of your `JobCardSource` enum. I had guessed that name; I have
  never actually seen your real JobCardSource enum's member list anywhere in this session, so rather
  than guess a second time, the `Source` assignment is now REMOVED from the object initializer
  entirely (see the comment left in its place) - a Zomato-created job card will get whatever value
  0 maps to on your real enum (typically its first-declared member) until you tell me the real
  member names, or paste JobCardSource.cs, and I'll set the correct one.

SECURITY NOTE - real appsettings.json pasted in chat, with live secrets
  You pasted your full, real appsettings.json in this conversation. It contains, in plain text:
  the JobCardScannerDb SQL admin password (AWS RDS), BaplConnection's password (Azure SQL,
  "baplfinal" ERP warehouse), BAPLDMSvadConnection's password (Azure SQL, BAPLDMSvad), the
  AzureAdGraph app registration's ClientSecret, the CustomerPortalJwt and DealerAuthJwt signing
  secrets, and the BaplImport default dealer password. I have not echoed any of these values back
  above, have not put them in any file I'm delivering, and won't use them anywhere beyond
  acknowledging they exist. Per the same guidance already given earlier this session for the
  BAPLDMSvad/DMSBAPLDATA connection strings: treat everything in that paste as exposed the moment
  it entered this chat, and rotate it - the SQL passwords with whoever administers those two SQL
  Server instances, the AzureAdGraph ClientSecret via Azure Portal -> App registrations ->
  JobCardScanner API -> Certificates & secrets, and the two JWT Secret values (which just need to be
  new random strings, not tied to any external system). This is standard rotation hygiene for any
  secret that's been pasted into a chat tool, independent of anything else in this session.

  CONFIRMED FROM THAT FILE: there is no "Zomato" section in your real appsettings.json yet - so
  every Zomato endpoint will currently return 503 "This integration is not yet configured", exactly
  as designed (safe-by-default). To turn it on, add a new top-level section, e.g.:
    "Zomato": {
      "ApiKey": "<the real key you generate for Zomato - not chosen by me>",
      "SystemUserId": "<the Id (Guid) of a real Users row you create, e.g. Name \"Zomato API\">"
    }
  Same rotation-hygiene note applies once you generate the real ApiKey - don't paste it into this
  chat either; put it directly into appsettings.json / User Secrets / an environment variable on
  your machine, and just tell me once it's set (no need to show me the value).

FILE TOUCHED
  backend/JobCardScanner.Api/Controllers/ZomatoIntegrationController.cs (only the 3 spots above)

============================================================================
SECTION 104 (2026-09-26) - Mobile Attendance files: real api/client.ts fixes the TS2305 error

You pasted the real mobile/src/api/client.ts (first real mobile file in this whole session) plus
the current content of AttendanceScreen.tsx and attendanceCheckin.ts. Confirmed: your real client.ts
exports a NAMED `apiClient` (an axios instance built with `axios.create({ baseURL })`, auth attached
by its own request interceptor from a cached Dealer JWT or Azure AD token) - there is no export
named `api` at all, which is exactly why you hit "Module has no exported member 'api'".

FIXED (both files, same change)
  mobile/src/screens/AttendanceScreen.tsx
  mobile/src/services/attendanceCheckin.ts
    `import { api } from '../api/client'` -> `import { apiClient } from '../api/client'`, and every
    `api.get(...)` / `api.post(...)` call renamed to `apiClient.get(...)` / `apiClient.post(...)`.
    No other logic changed in either file.

STILL A GUESS, NOT YET FIXED: AttendanceScreen.tsx's `import { useAuth } from '../auth/AuthContext'`
  and its use of `profile.dealerId`. Your real client.ts confirms an `AuthContext` (Azure AD) and a
  separate `StaffAuthContext`/`dealerAuthService` (Dealer/Workshop login) both exist on mobile, but
  I still haven't seen either context file itself, so the hook name and the `profile.dealerId` field
  are still unverified. If this is your next compile error, paste whichever of those two files
  actually exposes the signed-in user's dealerId/role on mobile and I'll fix it the same way.

SECURITY NOTE (informational only - nothing sensitive in this specific paste)
  Unlike the appsettings.json paste in SECTION 103, api/client.ts itself contains no secrets (no
  base URL value, no keys) - EXPO_PUBLIC_API_BASE_URL is read from environment/build config, not
  hardcoded here. Nothing to rotate from this file.

FILES TOUCHED
  mobile/src/screens/AttendanceScreen.tsx
  mobile/src/services/attendanceCheckin.ts

============================================================================
SECTION 105 (2026-09-26) - Zomato API: matching the real UI business rules (partial - 2 pieces blocked)

You pasted the full real MaterialTransferCreatePage.tsx, RepairBillPage.tsx, JobCardWizardPage.tsx
and JobCardDetailPage.tsx, then asked me to make the Zomato-facing API match this real business
logic instead of my earlier simplified version, plus showed a 503 testing
GET /api/zomato/material-transfers in Swagger. I asked 3 clarifying questions before touching
code (this is a live, external-facing, financial/inventory API - not a place to guess a second
time after the JobCardSource mistake in SECTION 103). Your answers:
  1. 503 cause: confirmed expected (no "Zomato" config section yet) - you'll add the real
     Zomato:ApiKey/SystemUserId yourself; no code change needed from me for this.
  2. Material Transfer/Repair Bill scope: you want Zomato to be able to POST its own Material
     Transfer (not just GET ones staff already created) - Repair Bill POST wasn't picked, so that
     stays GET-only for now.
  3. Job Card creation: "replicate the real validations server-side" - closer to the staff wizard's
     own rules, not the simplified version.

DONE THIS ROUND - POST /api/zomato/jobcards now validates like the real wizard
  ZomatoIntegrationController.cs, CreateJobCard: Job Type + Service Head are now REQUIRED and
  validated against the SAME catalog the staff wizard uses (web/src/data/serviceCatalog.ts's real,
  confirmed data - Job Type ids 1-4 = Accidental/Major/Minor/Running Repair; Service Head ids
  1=Accidental, 2=M1/3=M2 under Major, 4=D1/5=D2 under Minor, 6=Running Repair) - mirrors the
  wizard's own serviceDetailsValid gate. Complaints is now a real list (at least one required,
  same as the wizard) instead of a single optional string - the old single-string field
  (ComplaintDescription) still works too, merged into the same list, so nothing already integrated
  against this API breaks.
  New request fields Zomato must now send: jobTypeId, serviceHeadId, complaints: ["...", ...]
  (see the updated Word document, rebuilt below, for the exact new sample request body).

  FLAGGED, NOT CONFIRMED: BaplJobType/BaplJobTypeId/BaplServiceHeadId/BaplServiceHeadName are set
  on the new JobCard by INFERENCE (JobCardDetailPage.tsx reads jc.baplJobType/jc.baplServiceHeadName
  off the API using this exact naming pattern everywhere else in this codebase), not because I've
  read JobCard.cs's own property list - if your next compile error is CS0117 on any of these four,
  that's expected and will tell me the real names in one shot, same as the JobCardSource fix.

NOT DONE - GENUINELY BLOCKED, NEED 2 SPECIFIC FILES BEFORE I CAN DO THIS SAFELY

  (a) DMS/Vehicle-Sale chassis validation on job card creation. The real wizard validates a
      chassis against Vehicle Sale (BaplConnection, via IDmsBaplDataService.
      LookupVehicleForWizardAsync - added in SECTION 96) BEFORE letting a job card be created, and
      pulls real vehicle data (controller no., battery no., insurance expiry, etc.) from that
      source rather than trusting hand-typed fields. I know this method EXISTS (I named it myself
      in SECTION 96) but I do not have its actual C# signature/return type in this session - I only
      have the TypeScript caller (JobCardWizardPage.tsx), not the backend method itself. Guessing a
      method signature is exactly the mistake that caused the JobCardSource compile error - I'm not
      repeating it on a call I'd be adding fresh into a live external API. Paste
      IDmsBaplDataService.cs (or just the LookupVehicleForWizardAsync method's signature/return
      type) and I'll wire this in properly.

  (b) POST /api/zomato/material-transfers (Zomato creates its own Material Transfer). This is a
      much bigger piece than it looks: the real create page's own save() function confirms the
      backend's real POST /api/material-transfer-docs request shape (jobCardId/location/
      transferType/items[] with itemCode/qty/rate/hsnCode/issueType/itemType/rackNo/bin/serialNo/
      mrp/...) - I have that DTO shape with confidence, since it's taken directly from your real,
      currently-working frontend file. What I do NOT have is MaterialTransferDoc.cs (the entity)
      or MaterialTransferDocsController.cs's own Create() method - so I don't know its numbering
      scheme (is there an IMaterialTransferNumberingService I'd need to inject, the same way
      IJobCardNumberingService already works for Job Cards?), which fields are required vs
      optional, or the real Status enum's member names (Draft/Confirmed/Cancelled were used on your
      real MaterialTransferCreatePage.tsx, but I don't know if those are the ACTUAL enum member
      spellings or just what that page happens to display). Given SECTION 103's JobCardSource
      lesson, and that this endpoint would move real inventory/billing data for an external
      partner, I'd rather ask than build this on 3 more guesses that could each be wrong. Paste
      MaterialTransferDoc.cs and MaterialTransferDocsController.cs's Create() method and I'll build
      this properly in one pass instead of iterating through compile errors on a live API.

  Both (a) and (b) are real, scoped, one-time asks - once I have those 2 files this becomes a
  normal, confident build like everything else in this bundle, not more back-and-forth.

FILE TOUCHED
  backend/JobCardScanner.Api/Controllers/ZomatoIntegrationController.cs

============================================================================
SECTION 106 (2026-09-26) - Real ApiKeys config + more Job Card fields from your real wizard payload

FIXED - API key check now matches your real appsettings.json
  You pasted your real "ApiKeys" section - ONE shared config block keyed by partner name
  (Shadowfax/Internal/Zomato/ANVWeb/Cogzim), not the "Zomato": { "ApiKey": "..." } nested shape I
  had guessed in SECTION 102. CheckApiKey() now reads `_config["ApiKeys:Zomato"]` instead of
  `_config["Zomato:ApiKey"]` - nothing else needed on your side; the real key you pasted for Zomato
  works as-is once it's in appsettings.json under this same "ApiKeys" section.

  FLAGGED, NOT YET DONE: having 5 partners share one "ApiKeys" section strongly suggests there's
  already a shared checking mechanism behind Shadowfax/ANVWeb/Cogzim (a base controller/attribute/
  middleware) - CheckApiKey() here is still its own bespoke copy, not a reuse of that. If one of
  those already has this logic, paste that controller and I'll switch this one to reuse it instead
  of a 5th duplicate implementation.

  SECURITY NOTE: you pasted 5 real partner API keys in this chat (Shadowfax/Internal/Zomato/
  ANVWeb/Cogzim). These are lower-severity than the SQL/JWT/Graph secrets flagged in SECTION 103
  (each only unlocks its own integration's endpoints, not your database or staff logins), but
  they're still live credentials that were just typed into a chat tool - I haven't echoed them
  back above and won't use them anywhere. Rotating them isn't urgent the way the SQL/JWT ones were,
  but is still good hygiene whenever convenient.

  "Zomato:SystemUserId" is UNCHANGED and UNRELATED to this fix - it's a separate config value (not
  an API key) I introduced myself for attributing a Zomato-created job card's CreatedById to a real
  Users.Id - still needs to be added on its own, see SECTION 102 for the exact steps.

DONE - 4 more real fields added to POST /api/zomato/jobcards ("still ... have many missing feilds")
  Compared the request against your real JobCardWizardPage.tsx's own submit() payload (pasted in
  full last round) and added the confirmed gaps: batteryLevelAtCheckIn, customerConsentNotes,
  baplManualJobNo, baplCouponNo (all optional; baplCouponNo auto-derives from the chassis's last 13
  characters when not sent, same rule the real wizard's own useEffect uses). See the updated Word
  document's Section 1 sample request body for the new shape.

  DELIBERATELY STILL NOT ADDED, each for a specific reason (see the request DTO's own doc comment
  for the full list): baplJobCategory (its real type - string vs enum - isn't confirmed, and
  guessing wrong risks a type-mismatch compile error, not just a missing-field one); Service
  Location/customerLedgerId (blocked on the same DMS lookup as SECTION 105(a)); Supervisor/
  Technician/serviceAdvisorId (meaningless with no signed-in staff user behind a Zomato-created
  job card); Job Source (the staff wizard itself no longer collects this either).

FILES TOUCHED
  backend/JobCardScanner.Api/Controllers/ZomatoIntegrationController.cs
  Zomato_Integration_Data_API.docx (Section 0 auth wording + Section 1 sample request body)

============================================================================
SECTION 107 (2026-09-26) - Rebuilt against the REAL JobCardsController.cs/
MaterialTransferDocsController.cs/RepairBillDocsController.cs; new POST for Material Transfer

You pasted all three real backend controllers in full - this resolves both blockers from SECTION
105 ((a) the DMS Vehicle Sale lookup signature, (b) the real Material Transfer DTO/entity/
numbering) and lets every earlier "INFERRED, not confirmed" field become a checked FACT.

CORRECTED - two guesses the real JobCardsController.Create() proved wrong
  baplCouponNo (added in SECTION 106) is REMOVED. Your real Create() method's object initializer
  does not reference BaplCouponNo anywhere, even though JobCardWizardPage.tsx's real submit() does
  send one - it's a genuinely dead field on the real create flow. This directly matches your words
  "have unused feilds also". baplJobCategory (never added, flagged as "type unconfirmed") is
  CONFIRMED unused too, same story, for a stronger reason now: even the right type wouldn't matter,
  since the real Create() never wires it to the entity either. Neither is in the request DTO any
  more.

DONE - real DMS Vehicle Sale enrichment wired into POST /api/zomato/jobcards
  IDmsBaplDataService.LookupVehicleForWizardAsync(chassisNo, dealerCode, ct) - real signature now
  confirmed from DmsBaplDataService.cs - is called best-effort before the Vehicle row is resolved-
  or-created. On a match: VehicleModel/RegNo fall back to the DMS row's ItemModel-or-Oemmodel/RegNo
  when Zomato didn't send them, and BaplServiceLocation/BaplServiceLocationCode (real, wired fields
  - confirmed from the real Create()) are set from the DMS row's Location/LocCode. A miss (chassis
  not in DMS_SaleBill, or DMS unreachable) never blocks job card creation - logged and skipped,
  same convention every other DMS read in this app follows.

  NOT resolved: BaplCustomerLedgerId - the wizard sources this from a different field
  (baplVehicleHit?.customerLedgerId) this session has never seen the lookup for, and the real
  Create() doesn't even wire BaplCustomerLedgerId to the entity regardless (same "confirmed
  unused" story as baplCouponNo/baplJobCategory above).

DONE - POST /api/zomato/material-transfers (per your "Yes - Zomato should POST its own Material
Transfer" answer)
  Built against the real CreateMaterialTransferRequest/MaterialTransferDoc/MaterialTransferDocItem
  shapes and IJobCardNumberingService.NextMaterialTransferNumberAsync, both now confirmed from your
  real MaterialTransferDocsController.cs. Same PartUploads.BalQty stock-decrement logic, ported
  from that controller's own ApplyStockAndBuildItemsAsync. Design choices (all disclosed in the
  action's own doc comment): Zomato sends a jobCardNumber (not a raw GUID) and this resolves it
  server-side; partyName is ALWAYS forced to "Zomato" regardless of what's sent, since both GET
  endpoints only ever return rows with that exact PartyName; location falls back to the linked job
  card's own BaplServiceLocationCode when not sent; technicianId is always null.

  ASSUMPTION flagged: MaterialTransferDocItem.ItemReceived's real type was never directly
  confirmed in the pasted source (only ever passed through, never assigned a literal) - modelled
  as bool? here. A CS0029 on this one field specifically will confirm the real type.

DONE - GET /api/zomato/repair-bills and GET /api/zomato/material-transfers enriched
  Both now match the real, fuller ToRow() projections from RepairBillDocsController.cs/
  MaterialTransferDocsController.cs - JobCardId/JobCardNumber/PartyName/Remarks/ItemCount and
  richer per-item fields (HsnCode/RackNo/Bin/SerialNo/Mrp/ValidDays/ItemReceived/ItemType for
  Material Transfer; DiscountType/DiscountValue/TaxableAmount/Cgst-Sgst-Igst Pct/
  ExtendedBatteryWarrantySchemeId/IsUnderExtendedWarranty for Repair Bill) - directly answering
  "still ... have many missing feilds".

FIXED - a real bug from SECTION 105/106 this round's compile-error-free re-read caught
  ZomatoIntegrationController.cs was missing `using JobCardScanner.Api.Services;` even though its
  constructor already injected IJobCardNumberingService (declared in that namespace, confirmed
  from every real controller pasted this round) - this would have been a CS0246 the moment you
  compiled, layered on top of anything else. Added, along with IDmsBaplDataService for the new DMS
  enrichment above.

STILL OPEN, NOT YET RESOLVED - flagging rather than silently deciding either way:
  JobTypeId/ServiceHeadId are still REQUIRED for Zomato (your "Replicate the real validations
  server-side" answer from SECTION 105). The real JobCardsController.Create() you just pasted
  shows these are actually OPTIONAL for staff now (the 2026-09-24 DMS-write-back-removal change
  dropped the requirement - only the wizard's OWN client-side gate still enforces them). I have
  NOT loosened Zomato's validation to match this without asking first - tell me whether Zomato
  should also be allowed to omit these two.

  BaplServiceTypeId/BaplServiceTypeName are real, wired fields (confirmed from the real Create()),
  but still NOT added for Zomato - serviceCatalog.ts's own doc comment confirms its SERVICE_TYPES
  catalog is orphaned (ids point at an old Service Head list) and the wizard no longer shows this
  picker at all, so there's no trustworthy catalog to validate against today.

  "Zomato:SystemUserId" - still needs a real User row + its Id in config, unchanged from SECTION
  102/106.

FILES TOUCHED
  backend/JobCardScanner.Api/Controllers/ZomatoIntegrationController.cs (full rebuild)
  Zomato_Integration_Data_API.docx (new Section 5 - Create Material Transfer; Sections 1/3/4 sample
    bodies updated to match the field changes above; version bumped to 1.3)

  NOTE: JobCardsController.cs/MaterialTransferDocsController.cs/RepairBillDocsController.cs - the
  three real files you pasted this round - are NOT included in this zip. They were used only as
  reference to rebuild ZomatoIntegrationController.cs against their real, confirmed fields; nothing
  in them was changed, and you already have the real files, so there's nothing to merge back for
  those three.

============================================================================
SECTION 108 (2026-09-26) - Real Zomato API key in the Word doc; GetJobCardStatus enriched from
the real JobCardDetailPage.tsx

DONE - real API key now in Zomato_Integration_Data_API.docx
  You pasted your real appsettings.json (again) and said to use the real "ApiKeys:Zomato" value.
  The document's X-API-Key line now shows the real key instead of the placeholder - version
  bumped to 1.4. SECURITY NOTE: this document, once you actually send it to Zomato, hands them a
  live credential - same as it was always going to, just no longer a placeholder. The DB/JWT/Graph
  secrets in that same appsettings.json paste are the same ones already flagged in SECTION 103 -
  not re-flagging at the same length here, but the same advice stands (rotate when convenient, and
  keep this file out of source control if it isn't already .gitignore'd).

DONE - GET /api/zomato/jobcards/{jobCardNumber} enriched from the real JobCardDetailPage.tsx
  You pasted the real JobCardDetailPage.tsx - grepped its `jc.*` field references directly (not
  guessed) to find what's actually shown there, then added the fields that make sense for an
  external partner tracking its own job's status: odometerAtCheckIn, batteryLevelAtCheckIn,
  customerName/customerMobile, vehicleModel/regNo/chassisNo, baplJobType/baplServiceHeadName/
  baplServiceLocation/baplServiceLocationCode/baplManualJobNo, assignedTechnicianName, and the
  complaint list.

  DELIBERATELY NOT ADDED: partSuggestions/labourSuggestions/worklogs/inspections/
  qcChecklistItems/photos/stageHistory - these are internal workshop/billing detail. Returning
  partSuggestions/labourSuggestions specifically would mean exposing your dealer's part/labour
  pricing to Zomato through the job-status endpoint, which is a bigger decision than "add a
  missing field" - tell me explicitly if Zomato needs estimate/pricing visibility here and I'll
  scope that properly (e.g. a total estimate figure, not line-by-line pricing) rather than
  dumping the raw internal arrays.

ASKED, NOT YET BUILT - your "we can post bulk data for material transfer and repair bill give me
post and get and jobcard also" raises two things I want to confirm before building, given this
endpoint moves real inventory/billing data for an external partner:
  1) "Bulk" - does this mean POST should accept an ARRAY of multiple Material Transfer / Repair
     Bill documents in one call (batch create), instead of the current one-document-per-call
     design? Or did you mean something else by "bulk data" (e.g. just "the full data", not a
     literal batch-of-many-documents endpoint)?
  2) Repair Bill - your earlier explicit answer (SECTION 105) was GET-only for Zomato, no Repair
     Bill POST. This message reads like you may now want a Repair Bill POST too - confirming
     before building it, since reversing that is a real scope change, not just a missing field.
  See the chat for the actual question asked.

FILES TOUCHED
  backend/JobCardScanner.Api/Controllers/ZomatoIntegrationController.cs (GetJobCardStatus enriched)
  Zomato_Integration_Data_API.docx (real API key; Section 2 sample response enriched to match)

============================================================================
SECTION 109 (2026-09-26) - Batch POST for Material Transfer + NEW batch POST for Repair Bill,
per your confirmed answers to this round's clarifying questions

CONFIRMED ANSWERS (asked before building, since this moves real inventory/billing data):
  1) "Bulk" = array/batch create - Zomato sends a JSON ARRAY of documents in one call, not one
     document per call.
  2) Repair Bill POST should be added after all - reversing the SECTION 105 GET-only decision.

DONE - POST /api/zomato/material-transfers is now a BATCH endpoint
  Body is now a JSON array of the same per-document shape built last round. Each entry is
  validated and saved INDEPENDENTLY (bad job card / insufficient stock on one entry does not fail
  the others) - the response is an array of per-entry results, each with index/jobCardNumber
  echoed back, success true/false, and either the created transfer or an error message.

DONE - POST /api/zomato/repair-bills - NEW, also a BATCH endpoint
  Built against the real CreateRepairBillRequest/RepairBillDoc/RepairBillDocItem shapes and
  IJobCardNumberingService.NextRepairBillNumberAsync from RepairBillDocsController.cs. Same
  discount-then-GST calculation as the real controller (issueType "U/W"/"FSC" zeroes tax), same
  PartUploads.BalQty stock check for Part lines. CustomerId/VehicleId/RegNo/ChassisNo are resolved
  from the linked job card automatically - Zomato only sends jobCardNumber. partyName always
  forced to "Zomato". Starting status is always Performa.

  DELIBERATELY NOT PORTED: Extended Battery Warranty Scheme matching (audit-only metadata, never
  changes a billed amount) - both fields left null on every Zomato-created bill line. Tell me if
  Zomato specifically needs this populated.

CORRECTNESS FIX SPECIFIC TO BATCHING (not a change to real business logic - a fix for a problem
batching itself introduces): the real MaterialTransferDocsController/RepairBillDocsController
validate-and-decrement PartUploads.BalQty in the SAME pass per line, safe there because a failure
400s the WHOLE request before anything saves. A batch sharing one DbContext/one SaveChangesAsync
across many documents can't rely on that - a rejected document's PARTIAL in-memory stock
decrement could otherwise leak into another (successful) document's persisted save. Both new
batch stock-check helpers now validate a document's ENTIRE stock need (summed per Item Code)
BEFORE mutating anything for it - two documents in the same batch drawing on the same part still
correctly see each other's cumulative usage; only a rejected document's partial usage is
prevented from leaking through. Flagged in the code's own doc comments, not silently done.

FILES TOUCHED
  backend/JobCardScanner.Api/Controllers/ZomatoIntegrationController.cs (Material Transfer POST
    converted to batch; new Repair Bill POST batch endpoint added)
  Zomato_Integration_Data_API.docx (Section 5 updated to the batch/array shape; new Section 6 -
    Create Repair Bill batch; version bumped to 1.5)

============================================================================
SECTION 110 (2026-09-26) - Real routing bug found from your real JobCards data dump; fixed

You pasted 2 real rows straight out of the JobCards table (tab-separated - looks like a `select *`
result). This is valuable beyond just "give me a curl": it's the first real, confirmed data for
several fields I'd only ever guessed at or left unset.

CONFIRMED from your real data (FACT, not inferred):
  - JobCardNumber format is exactly JC/{dealerCode}/{FY}/{seq}, e.g. "JC/288/26-27/0011" - and
    CRITICALLY, it contains "/" characters. This exposed a real bug (see below).
  - JobCardStatus has a real member "InProgress" (both sample rows).
  - ServiceType has real members "Warranty" and "AccidentRepair" (one each in your 2 rows) - my
    ServiceType.PaidService default for Zomato-created job cards is still an assumption (neither
    of your 2 sample rows happens to show "PaidService"), but the enum name itself is now doubly
    confirmed correct.
  - JobCardSource (still unset for Zomato - see below) has a real member "WalkIn" (both rows). This
    is the first real member name I've seen for this enum since the original JobCardSource.Others
    guess failed to compile - "WalkIn" obviously isn't the right value for a Zomato-created job
    card (Zomato isn't a walk-in customer), so Source is STILL deliberately left unset here, but
    now you know exactly what I need: the actual member name you'd want used for an API/partner-
    created job card (e.g. "Api", "Partner", "B2B" - whatever your enum actually calls it, if
    anything does yet).

FIXED - real routing bug in GET Job Card Status
  Since a real job card number contains "/" (confirmed above), the original route -
  GET /api/zomato/jobcards/{jobCardNumber}, with jobCardNumber as a URL PATH SEGMENT - could never
  actually work for a real value. ASP.NET Core's router treats "/" as a segment separator, so
  "JC/288/26-27/0011" would be read as 4 separate path segments against a template that only
  declares one placeholder - the route simply wouldn't match, and every real lookup would 404
  before ever reaching the controller action. URL-encoding the slashes (%2F) doesn't reliably fix
  this either, since Kestrel decodes %2F before routing by default. FIXED by moving jobCardNumber
  to a query-string parameter instead: GET /api/zomato/jobcards/status?jobCardNumber=... - query
  values are never split into route segments, so this works correctly for any value, slashes
  included. This is a breaking change to this one endpoint's URL (nothing else changed) - update
  any test you've already run against the old path-segment URL.

  This bug had gone unnoticed because every job card number used in this doc's own examples so far
  (and in Swagger) still happened to demonstrate the shape, not a URL actually exercised end-to-end
  against a real number - your data dump is what caught it. Good catch to have surfaced now, before
  this reached Zomato.

FILES TOUCHED
  backend/JobCardScanner.Api/Controllers/ZomatoIntegrationController.cs (GetJobCardStatus route
    fixed)
  Zomato_Integration_Data_API.docx (Section 2 endpoint/curl/notes updated to the query-parameter
    shape; version bumped to 1.6)
