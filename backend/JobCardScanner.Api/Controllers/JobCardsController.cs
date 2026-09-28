using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using JobCardScanner.Api.Services.Integrations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

[ApiController]
[Route("api/jobcards")]
[Authorize(Policy = Policies.Staff)]
public class JobCardsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IJobCardNumberingService _numbering;
    private readonly IErpClient _erp;
    private readonly INotificationClient _notifications;
    private readonly IOtpService _otp;
    private readonly IAuditLogService _audit;
    private readonly IWebHostEnvironment _env;
    private readonly IBaplDmsService _baplDms;
    private readonly IInvoicePdfService _invoicePdf;
    private readonly IEstimatePdfService _estimatePdf;
    private readonly IEmailClient _email;
    private readonly ILogger<JobCardsController> _logger;
    // 2026-09-24 ("link with our labour-master, item-master and part-upload in that page and fetch
    // details"): Part Suggestion/Labour Suggestion's picker data now comes from these THREE local
    // services instead of DMS's live PartsInventory/LabourMaster (see PartsCatalog/LabourCatalog
    // below) - consistent with dropping DMS involvement from the job card flow generally. Distinct
    // from _baplDms above (BAPLDMSvad, the live job-card DMS this controller no longer writes to at
    // all) - these three read BAPL's separate reference/catalog data (baplfinal's C_ItemMaster,
    // DMSBAPLDATA's LabourMaster/PartWiseLabourMaster) or this app's OWN uploaded stock
    // (PartUploads), none of which is "the job card" itself.
    private readonly IBaplDealerService _baplDealer;
    private readonly ILabourMasterImportService _labourMaster;
    private readonly IPartUploadService _partUploads;
    // 2026-09-25 ("worklocation chassis no and reg no use from vehicle sale which we data fetch"):
    // backs the wizard's chassis/reg-no lookup and typeahead suggestions (VehicleLookupForWizard /
    // VehicleSuggestionsForWizard below), reading BaplConnection's DMS_SaleBill/DMS_SaleBillCustomer -
    // the same source DmsBaplDataService.GetVehicleSalesAsync uses for the "Vehicle Sale" sidebar
    // page (see that service's SECTION 95 migration notes). Replaces the wizard's previous use of
    // _baplDms (BAPLDMSvad)'s VehicleLookupAsync/VehicleSuggestionsAsync for this purpose - _baplDms
    // itself is unchanged and still used elsewhere in this controller (workshops, etc.).
    private readonly IDmsBaplDataService _dmsBaplData;

    public JobCardsController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IJobCardNumberingService numbering,
        IErpClient erp, INotificationClient notifications, IOtpService otp, IAuditLogService audit,
        IWebHostEnvironment env, IBaplDmsService baplDms, IInvoicePdfService invoicePdf,
        IEstimatePdfService estimatePdf, IEmailClient email, ILogger<JobCardsController> logger,
        IBaplDealerService baplDealer, ILabourMasterImportService labourMaster, IPartUploadService partUploads,
        IDmsBaplDataService dmsBaplData)
    {
        _db = db;
        _currentUser = currentUser;
        _numbering = numbering;
        _erp = erp;
        _notifications = notifications;
        _otp = otp;
        _audit = audit;
        _env = env;
        _baplDms = baplDms;
        _invoicePdf = invoicePdf;
        _estimatePdf = estimatePdf;
        _email = email;
        _logger = logger;
        _baplDealer = baplDealer;
        _labourMaster = labourMaster;
        _partUploads = partUploads;
        _dmsBaplData = dmsBaplData;
    }

    // ---------------- Part Suggestion / Labour Suggestion picker data (2026-09-24) ----------------
    /// <summary>GET /api/jobcards/parts-catalog?q=&locationCode= - replaces the old
    /// GET /api/bapl-dms/parts?locationCode= (DMS's live PartsInventory) as Part Suggestion's
    /// search source. Item code/description/HSN/MRP/GST come from ItemMasterController's own
    /// source (BAPL's C_ItemMaster, via IBaplDealerService.SearchItemMasterAsync - the same catalog
    /// Material Transfer/Repair Bill already price against); "available qty" is best-effort
    /// enriched from this dealer's own uploaded Part Upload data for the given location when a
    /// matching PartNo exists there (locationCode optional - omit it to search without a stock
    /// hint). Gated ServiceAdvisorUp, same floor as AddPartSuggestion itself.
    ///
    /// 2026-09-25 ("(avail. ) placeholder blank" - FACT/diagnosis: Job Type/Service Head/Service
    /// Type/Service Location became OPTIONAL on the wizard once DMS write-back was removed (see
    /// JobCardsController.Create's own 2026-09-24 doc comment) - so an increasing share of job
    /// cards carry no BaplServiceLocationCode at all, meaning the frontend never sends locationCode
    /// here (see JobCardDetailPage.tsx/PartSuggestionSection.tsx's own "locationCode is optional"
    /// comment), and availableQtyByCode stayed empty for every one of them): when locationCode is
    /// blank, this now falls back to this dealer's Part Upload stock summed ACROSS EVERY LOCATION
    /// they've uploaded for, instead of showing no quantity hint at all. INTERPRETATION / disclosed
    /// trade-off: for a dealer with more than one workshop location (W1, W2, ...) with genuinely
    /// different stock levels, this dealer-wide fallback can overstate what's actually on the shelf
    /// at the specific workshop this job is at - it is a best-effort hint, same as before, not a
    /// stock guarantee. Picking a Service Location on the job card (still optional) gives the exact
    /// per-workshop number instead of this fallback.</summary>
    [HttpGet("parts-catalog")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> PartsCatalog([FromQuery] string? q, [FromQuery] string? locationCode)
    {
        IReadOnlyList<BaplItemMasterRow> items;
        try
        {
            items = await _baplDealer.SearchItemMasterAsync(q, HttpContext.RequestAborted);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "PartsCatalog: could not read item master (q: {Q})", q);
            return StatusCode(502, new { message = ex.Message });
        }

        // 2026-09-28 ("for dealeradmin have all location access ... but under this dealer which
        // location have access only that location item/part code shown"): same Work Area location
        // scoping List()/Get() above already apply to job cards (see WorkLocationCodes' own doc
        // comment there, "Employees" page, 2026-09-17) - empty list = unrestricted (DealerAdmin,
        // and any other account with no Work Area assigned); a non-empty list restricts to those
        // specific workshop location(s) under this dealer.
        //
        // FACT/INTERPRETATION split, please confirm: BAPL's C_ItemMaster (the Item Master catalog
        // `items` above comes from) is dealer-wide reference data - one shared parts catalog, not
        // one row per workshop location - so there is no confirmed location field on it to filter
        // by. Only Part Upload (this dealer's own uploaded STOCK, which genuinely does have a
        // LocationCode per row - see Models/PartUpload.cs) can be scoped by location today. So a
        // location-restricted user below still sees the full Item Master catalog list (same as
        // DealerAdmin), but: (a) their Available Qty hint only counts stock uploaded at THEIR
        // allowed location(s), and (b) a part that exists ONLY because of an upload (no Item
        // Master match - see the 2026-09-28 fix below) is hidden unless that upload is at one of
        // their allowed locations. If you actually need the Item Master catalog LIST itself
        // narrowed per location (not just the stock/qty), tell me and I'll ask what field on
        // C_ItemMaster carries that, since I don't have that schema confirmed.
        var allowedLocations = _currentUser.WorkLocationCodes;
        // 2026-09-28 FIX - your real screenshots: Part Upload shows BalQty 9 (UTTAM NAGAR) + 24
        // (OKHLA) = 33 for 22C12110150AS, but Job Card's Part Suggestion showed "avail. 0" for the
        // exact same part right after the location-scoping above shipped. FACT/ASSUMPTION
        // correction: the version just above treated ANY account with a non-empty
        // WorkLocationCodes as location-restricted, on the ASSUMPTION that a DealerAdmin account
        // would normally carry an EMPTY WorkLocationCodes (unrestricted). That assumption looks
        // wrong for the account you tested with - Work Area locations on Admin -> Users appear
        // settable per ACCOUNT regardless of role, not tied to being DealerAdmin - so an account
        // whose Work Area doesn't happen to include CUS0288W1/W2 (where this part's stock was
        // actually uploaded) got zeroed out here, even though "dealeradmin have all location
        // access" was the explicit ask. FIXED: DealerAdmin now ALWAYS bypasses this restriction
        // regardless of what WorkLocationCodes happens to contain on that specific account -
        // same for CorporateAdmin/SystemAdmin, matching the existing isOrgWideRole convention
        // List()/Get()/Technicians() above already use - matching your literal request instead of
        // an assumption about how accounts are normally configured.
        //
        // If qty still shows 0 after this for a DealerAdmin (or non-restricted) account, the cause
        // is something else - most likely this account's DealerId not matching the PartUpload
        // rows' DealerId. Tell me the role you tested with, or open DevTools -> Network on this
        // page and paste the raw JSON GET /api/jobcards/parts-catalog?q=22C12110150AS returns (you
        // already have a second tab open here) so I can see availableQty directly instead of
        // guessing further.
        var isDealerAdminOrAbove = _currentUser.Role is StaffRole.DealerAdmin or StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var isLocationRestricted = allowedLocations.Count > 0 && !isDealerAdminOrAbove;

        Dictionary<string, decimal> availableQtyByCode = new(StringComparer.OrdinalIgnoreCase);
        // 2026-09-28 CORRECTION - your real compiler error (CS0234: "the type or namespace name
        // 'PartUploadRow' does not exist in the namespace 'JobCardScanner.Api.Dtos'"): my previous
        // pass here declared `uploads` as `List<Dtos.PartUploadRow>`, a type name I invented rather
        // than confirmed - it doesn't exist. Fixed by not naming the type at all (`var` below lets
        // the compiler infer whatever `_partUploads.GetAsync` actually returns) - `partUploadOnlyRows`
        // is declared outside the dealer-check block, defaulting to empty, so it's usable either way.
        var partUploadOnlyRows = new List<PartsCatalogRow>();
        if (_currentUser.DealerId.HasValue)
        {
            // locationCode narrows to one workshop when the job card has one; null/blank returns
            // this dealer's uploads across every location (see this method's doc comment above) -
            // summed per PartNo rather than a plain overwrite, since more than one location's row
            // can now match the same PartNo once locationCode isn't filtering them down to one.
            var uploads = await _partUploads.GetAsync(_currentUser.DealerId.Value, locationCode, null, HttpContext.RequestAborted);

            // Work Area location scoping (see this method's 2026-09-28 doc comment above) -
            // INTERPRETATION: PartUpload.LocationCode is a confirmed real column (Models/
            // PartUpload.cs), but whether IPartUploadService.GetAsync's return projection exposes
            // it as `.LocationCode` is inferred, not confirmed the same way PartNo/BalQty/
            // Description/HsnSacCode/BillPrice already were earlier in this file - if this doesn't
            // compile (a CS1061 naming the missing member), tell me the real property name.
            if (isLocationRestricted)
                uploads = uploads.Where(u => u.LocationCode != null && allowedLocations.Contains(u.LocationCode, StringComparer.OrdinalIgnoreCase)).ToList();

            foreach (var u in uploads)
                if (!string.IsNullOrWhiteSpace(u.PartNo) && u.BalQty.HasValue)
                    availableQtyByCode[u.PartNo] = (availableQtyByCode.TryGetValue(u.PartNo, out var existing) ? existing : 0m) + u.BalQty.Value;

            // FACT, root cause of the bug you originally reported: this endpoint's item LIST only
            // ever came from SearchItemMasterAsync above (BAPL's external C_ItemMaster) - Part
            // Upload was only ever used to enrich availableQty on a PartNo that ALREADY matched an
            // Item Master row, never to add a part that exists ONLY in Part Upload. A part you've
            // uploaded (real stock, in JobCardScannerDb's own PartUploads table) but which BAPL's
            // Item Master has no entry for was invisible here even though Part Upload's own page
            // shows it correctly - "does not exist in Item Master" was a true statement about the
            // wrong list. FIXED: any uploaded PartNo with no Item Master match is appended below.
            //
            // Description/HsnCode/Mrp now filled in too (upgraded from the previous pass, which
            // left them blank) - now that you've pasted the real Models/PartUpload.cs, u.Description/
            // u.HsnSacCode/u.BillPrice are confirmed real properties on that entity, and they match
            // the exact camelCase field names PartUploadPage.tsx's own `PartUpload` TS type already
            // uses (description/hsnSacCode/billPrice) - so GetAsync's return type very likely
            // exposes the same members. INTERPRETATION, not certainty: if GetAsync returns a
            // slimmer projection that's missing one of these three, you'll get one more CS0117-style
            // error naming exactly which - tell me and I'll drop just that one field.
            // Sgst/Cgst/Igst stay null - PartUpload.cs's own class doc comment confirms this sheet
            // has no GST/tax-rate column at all, so there is nothing to fill in there, not a gap.
            var itemMasterCodes = new HashSet<string>(items.Select(i => i.ItemCode), StringComparer.OrdinalIgnoreCase);
            partUploadOnlyRows = uploads
                .Where(u => !string.IsNullOrWhiteSpace(u.PartNo) && !itemMasterCodes.Contains(u.PartNo))
                .GroupBy(u => u.PartNo, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.OrderByDescending(u => u.UploadedAt).First())
                .Select(u => new PartsCatalogRow(
                    ItemCode: u.PartNo,
                    Description: u.Description,
                    HsnCode: u.HsnSacCode,
                    Mrp: u.BillPrice,
                    Sgst: null,
                    Cgst: null,
                    Igst: null,
                    // 2026-09-28 ("if there is no qty then show 0"): 0, not null, when nothing
                    // matched - see this method's final Select/Ok below for the same default on
                    // Item Master rows.
                    AvailableQty: (int)(availableQtyByCode.TryGetValue(u.PartNo, out var puQty) ? puQty : 0m)))
                .ToList();
        }

        // 2026-09-28 ("in that qty show if there is no qty then show 0 ... order where qty are
        // there in that order from other item show"): AvailableQty defaults to 0 (never null) for
        // every row now - both here and on partUploadOnlyRows above - and the combined list is
        // sorted qty-first (descending), ties broken alphabetically by ItemCode for a stable,
        // predictable order instead of whatever order SearchItemMasterAsync/Concat happened to
        // return.
        var itemMasterRows = items.Select(i => new PartsCatalogRow(
            ItemCode: i.ItemCode,
            Description: i.DisplayName ?? i.ItemName,
            HsnCode: i.HsnCode,
            Mrp: (decimal?)i.DlrPrice,
            Sgst: (decimal?)i.Sgst,
            Cgst: (decimal?)i.Cgst,
            Igst: (decimal?)i.Igst,
            AvailableQty: (int)(availableQtyByCode.TryGetValue(i.ItemCode, out var qty) ? qty : 0m)));

        return Ok(itemMasterRows.Concat(partUploadOnlyRows)
            .OrderByDescending(r => r.AvailableQty)
            .ThenBy(r => r.ItemCode, StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>Shared response shape for PartsCatalog above, covering both an Item-Master-backed
    /// row and a Part-Upload-only row (see that method's 2026-09-28 doc comment) - a named record
    /// instead of two separately-shaped anonymous objects so the compiler doesn't need the two
    /// Select projections above to infer an identical anonymous type before Concat can unify them.
    /// PascalCase here serializes as camelCase JSON (same global naming policy every other
    /// controller's ToRow-style projections already rely on), matching JobCardsPartsCatalogRow on
    /// the frontend exactly as the pre-existing lowercase anonymous object did.</summary>
    private record PartsCatalogRow(
        string ItemCode, string? Description, string? HsnCode,
        decimal? Mrp, decimal? Sgst, decimal? Cgst, decimal? Igst, int? AvailableQty);

    /// <summary>GET /api/jobcards/labour-catalog?search= - replaces the old
    /// GET /api/bapl-dms/labour as Labour Suggestion's search source. Unions LabourMaster
    /// (without-partwise) and PartWiseLabourMaster, same as the old endpoint did, but reading
    /// through ILabourMasterImportService directly rather than LabourMasterController (which is
    /// gated WorkshopManagerUp - too narrow for a plain ServiceAdvisor, who needs this for Labour
    /// Suggestion) - mirrors MaterialTransferDocsController.LabourByPartCode's own established
    /// precedent for exactly this situation (see that method's doc comment).</summary>
    [HttpGet("labour-catalog")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> LabourCatalog([FromQuery] string? search)
    {
        try
        {
            var withoutPartwise = await _labourMaster.GetWithoutPartwiseAsync(search, HttpContext.RequestAborted);
            var partwise = await _labourMaster.GetPartwiseAsync(search, HttpContext.RequestAborted);
            var combined = withoutPartwise
                .Select(r => new { id = (object)r.Id, labourCode = r.LabourCode, labourDescription = r.JobDescription, hsnCode = (string?)null, labourRate = r.LabourRate, sgst = r.Sgst, cgst = r.Cgst, igst = r.Igst, partCode = (string?)null, partDescription = (string?)null })
                .Concat(partwise.Select(r => new { id = (object)r.Id, labourCode = r.LabourCode, labourDescription = r.JobDescription, hsnCode = (string?)null, labourRate = r.LabourRate, sgst = r.Sgst, cgst = r.Cgst, igst = r.Igst, partCode = r.PartCode, partDescription = r.PartName }));

            // 2026-09-28 ("in labour which i search only that search its whole shown fix this
            // search in both web and android"): your screenshot - searching "PLPRUV1N0002" in
            // Labour Suggestion returned PLPRUV1N0001, PLPRUV1N0008, PLPRUV1N0009... codes that
            // don't contain the search text at all, i.e. GetWithoutPartwiseAsync/GetPartwiseAsync's
            // OWN search filtering isn't narrowing the result. I don't have
            // Services/LabourMasterImportService.cs (their actual implementation) staged this
            // session, so I can't see why - rather than guess at that file's internals, this
            // re-filters the already-combined result here as a defensive second pass: kept only
            // when LabourCode or Description actually contains the search text (case-insensitive).
            // A blank/absent search still returns everything, matching this endpoint's existing
            // no-search behaviour. This is the ONE endpoint both JobCardDetailPage.tsx (web) and
            // JobCardDetailScreen.tsx (mobile) call for Labour Suggestion's search - neither
            // frontend file applies any filtering of its own (both just render whatever this
            // endpoint returns), so this single backend fix covers both platforms; no frontend
            // change needed or made.
            if (!string.IsNullOrWhiteSpace(search))
            {
                var needle = search.Trim();
                combined = combined.Where(r =>
                    (r.labourCode != null && r.labourCode.Contains(needle, StringComparison.OrdinalIgnoreCase))
                    || (r.labourDescription != null && r.labourDescription.Contains(needle, StringComparison.OrdinalIgnoreCase)));
            }

            return Ok(combined);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "LabourCatalog failed (search: {Search})", search);
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>2026-09-24 ("the in jobcard we update stage for every Update Workflow Stage for
    /// evry stage before start required Assign Technician name update"): shared gate for every
    /// action that changes (or can auto-advance) a job card's workflow stage - the manual
    /// ChangeStage endpoint AND every automatic trigger (StartWorklog, AddPartSuggestion,
    /// AddLabourSuggestion). Per explicit choice ("every stage change, including the automatic
    /// ones"), ALL of these are now blocked outright - the whole action is refused with 400, not
    /// just the stage-advance silently skipped - until a Technician has been assigned via
    /// JobCard.AssignedTechnicianName (the Job Card Detail page's own "Assign Technician" field,
    /// now fed by the new Technician Employee dropdown - see TechniciansController). Deliberately
    /// NOT applied to SyncClosedFromDmsAsync's own stage-advance call below - that one reflects
    /// DMS's own observed state on a legacy DMS-linked job card, not a user-initiated action, and
    /// refusing it would leave a job card stuck showing a stale status for no actionable reason.</summary>
    private IActionResult? RequireAssignedTechnician(JobCard jc) =>
        string.IsNullOrWhiteSpace(jc.AssignedTechnicianName)
            ? BadRequest(new { message = "Assign a Technician to this job card first (Update Workflow Stage -> Assign Technician) before doing this." })
            : null;

    // ---------------- List / search / global search ----------------
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] Guid? dealerId, [FromQuery] JobCardStatus? status, [FromQuery] Guid? technicianId, [FromQuery] string? q, [FromQuery] string? stageKey,
        // Dashboard KPI-card/chart deep-links (see DashboardPage.tsx/DashboardScreen.tsx and
        // DashboardController.Kpis - each of these names matches one of that endpoint's own
        // computed fields exactly, so a KPI card and this list filter always agree on what counts).
        [FromQuery] bool? excludeClosed, [FromQuery] bool? overdue, [FromQuery] bool? createdToday,
        [FromQuery] bool? deliveredToday, [FromQuery] bool? closedThisMonth, [FromQuery] bool? warrantyOnly,
        [FromQuery] bool? pendingBucket)
    {
        var query = _db.JobCards.AsNoTracking()
            .Include(j => j.Customer).Include(j => j.Vehicle).Include(j => j.CurrentStage)
            .Include(j => j.ServiceAdvisor).Include(j => j.AssignedTechnician).Include(j => j.Photos)
            // 2026-09-24 FIX: the 2026-09-05 "DMS is the sole source of truth" rule (which hid any
            // job card with no BaplJobCardHeaderId) is gone - see Create()'s own 2026-09-24 doc
            // comment ("DMS write-back REMOVED"). That change made BaplJobCardHeaderId null on
            // EVERY newly created job card with no code path left to ever set it, but this filter
            // was mistakenly left in place, which meant every job card created after that change
            // was silently invisible here even though its row existed and Search()/direct
            // stage/worklog/suggestion endpoints (none of which filter on this) worked fine against
            // it - exactly the "shows in `select * from JobCards` but not in the app's own Job
            // Cards list" symptom this was caught from. Removed - every local job card is shown
            // again, DMS-linked or not, same as Search() already did.
            .AsQueryable();

        // Two bugs fixed here (found while chasing "dealer login sees every dealer's job cards"):
        //   1) `dealerId` from the query string used to win for EVERYONE, including a plain
        //      dealer-scoped user - so ?dealerId=<some other dealer's guid> could page around a
        //      dealer's own scope and see a different dealer's job cards. Now only
        //      Corporate/SystemAdmin (who already see every dealer by default) can use it to narrow
        //      to one dealer - anyone else's `dealerId` query param is ignored outright.
        //   2) When a non-Corporate/SystemAdmin user's own DealerId was unresolved (Guid? null -
        //      can happen for an account created before DealerAuthController's pending-assignment
        //      safety net existed, e.g. a manually-added Admin -> Users row with no dealer picked),
        //      `effectiveDealerId.HasValue` was false, so the `if` below never ran at all - no WHERE
        //      clause applied, silently returning every dealer's job cards instead of none. Now the
        //      dealer filter is ALWAYS applied for a non-Corporate/SystemAdmin caller: when their own
        //      DealerId is null, `j.DealerId == (Guid?)null` matches zero rows (DealerId is a
        //      non-nullable Guid column on JobCard) rather than skipping the filter - a safe "show
        //      nothing" default instead of an accidental "show everything" leak.
        var isOrgWideRole = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        if (isOrgWideRole)
        {
            if (dealerId.HasValue) query = query.Where(j => j.DealerId == dealerId);
        }
        else
        {
            query = query.Where(j => j.DealerId == _currentUser.DealerId);
        }
        // 2026-09-17 "Employees" page - Work Area location scoping (see User.WorkLocationCodes's
        // doc comment): a user assigned to specific DMS workshop locations only sees job cards
        // opened at one of THEIR locations, on top of (not instead of) the dealer scoping above.
        // Empty = unrestricted, so this is a no-op for every user before this feature shipped.
        var allowedLocations = _currentUser.WorkLocationCodes;
        if (allowedLocations.Count > 0)
        {
            var allowedLocationsList = allowedLocations.ToList(); // EF Core translates List<T>.Contains to SQL IN (...) reliably; IReadOnlyList<T> is not guaranteed to
            query = query.Where(j => j.BaplServiceLocationCode != null && allowedLocationsList.Contains(j.BaplServiceLocationCode));
        }
        var effectiveDealerId = isOrgWideRole ? dealerId : _currentUser.DealerId;
        if (status.HasValue) query = query.Where(j => j.Status == status);
        if (technicianId.HasValue) query = query.Where(j => j.AssignedTechnicianId == technicianId);
        // Lets the Dealer Dashboard's Quick Links ("Waiting for Parts", "Ready for Pickup") deep-link
        // straight to the filtered list by workflow stage, not just by the coarser Status enum.
        if (!string.IsNullOrWhiteSpace(stageKey)) query = query.Where(j => j.CurrentStage!.StageKey == stageKey);
        if (!string.IsNullOrWhiteSpace(q))
        {
            // 2026-09-18: a registration number is commonly typed/stored with inconsistent
            // spacing/hyphenation ("MH12AB1234" vs "MH12 AB 1234" vs "MH-12-AB-1234"), so a plain
            // Contains(q) against the stored RegNo can silently miss a real row when the search
            // term's formatting differs from what's stored. Strip spaces/hyphens from BOTH sides
            // before comparing (EF Core translates .Replace() on strings to SQL REPLACE) so a
            // search matches regardless of formatting - mirrors the same fix already applied to
            // BaplDmsService's LookupVehicleAsync/SearchVehiclesAsync. JobCardNumber/Name/Mobile
            // are left untouched; they don't have this formatting-inconsistency problem.
            var normalizedQ = q.Replace(" ", "").Replace("-", "");
            query = query.Where(j =>
                j.JobCardNumber.Contains(q) ||
                j.Customer!.Name.Contains(q) ||
                j.Customer!.Mobile.Contains(q) ||
                (j.Vehicle!.RegNo != null && j.Vehicle.RegNo.Replace(" ", "").Replace("-", "").Contains(normalizedQ)));
        }

        // Dashboard KPI-card deep-link filters - each mirrors the exact same WHERE clause
        // DashboardController.Kpis uses to compute the matching card's number, so clicking a card
        // always lands on the same set of job cards it just counted.
        if (excludeClosed == true) query = query.Where(j => j.Status != JobCardStatus.Closed && j.Status != JobCardStatus.Cancelled);
        if (overdue == true) query = query.Where(j => j.ExpectedDeliveryAt < DateTime.UtcNow && j.Status != JobCardStatus.Closed && j.Status != JobCardStatus.Cancelled);
        if (createdToday == true) { var todayStart = DateTime.UtcNow.Date; query = query.Where(j => j.CreatedAt >= todayStart); }
        if (deliveredToday == true) { var todayStart = DateTime.UtcNow.Date; var tomorrowStart = todayStart.AddDays(1); query = query.Where(j => j.ActualDeliveryAt >= todayStart && j.ActualDeliveryAt < tomorrowStart); }
        if (closedThisMonth == true) { var monthStart = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc); query = query.Where(j => j.ClosedAt >= monthStart); }
        if (warrantyOnly == true) query = query.Where(j => j.ServiceType == ServiceType.Warranty);
        if (pendingBucket == true) query = query.Where(j =>
            j.Status == JobCardStatus.PendingCustomerApproval || j.Status == JobCardStatus.PendingQc ||
            j.Status == JobCardStatus.PendingClosure || j.Status == JobCardStatus.PendingInvoice);

        var results = await query.OrderByDescending(j => j.CreatedAt).Take(200).ToListAsync();

        // 2026-09-28 ("from dms dont fetch jobcards and dont save jobcards only in our jobcard db
        // save this"): this endpoint used to (a) call SyncClosedFromDmsAsync to pull DMS's own
        // Closed/Billed status into local rows, and (b) blend in extra, read-only rows for job
        // cards that exist ONLY in DMS (opened there directly, never created in JobCardScanner) via
        // _baplDms.SearchJobCardsAsync. Both are DMS FETCHES of job card data - per this explicit
        // instruction, both are removed entirely. This list is now JobCardScanner's own JobCards
        // table only, nothing blended in or synced from DMS. SyncClosedFromDmsAsync/SummarizeBapl
        // below are left defined but unused (same "kept, not deleted" convention the frontend's
        // QcCard/InvoiceCard/ClosureCard already use) in case DMS status sync needs to come back.
        // baplDmsWarning stays in the response shape (always null now) so the frontend doesn't
        // need a matching change just to keep reading `data.items`/`data.baplDmsWarning`.
        var localRows = results.Select(j => (SortKey: j.CreatedAt, Row: Summarize(j)));
        var merged = localRows.OrderByDescending(x => x.SortKey).Take(200).Select(x => x.Row).ToList();
        return Ok(new { items = merged, baplDmsWarning = (string?)null });
    }

    /// <summary>
    /// GET /api/jobcards/search?dateFrom=&amp;dateTo=&amp;jobNo=&amp;regNo=&amp;chassisNo= -
    /// lightweight job-card picker for the Repair Bill / Material Transfer Bill create pages' "Job
    /// Search" (2026-09-21, modelled on the reference DMS app's own Job Search modal screenshot:
    /// Date From/To, Job No, Registration No, Chassis Number filters, returning Job No/Job Date/
    /// Location/Job Type-Service Name/Party Name/Regn.-Chassis No/Vehicle Type/Job Source).
    /// Searches THIS APP'S OWN JobCards table only (not the blended DMS view List() above builds) -
    /// both RepairBillDoc.JobCardId and MaterialTransferDoc.JobCardId are FKs into JobCardScanner's
    /// own JobCards, not a raw DMS JobCardHeaderId, so only a local job card is ever a valid pick
    /// here. Same dealer + Work Area (WorkLocationCodes) scoping as List() above.
    ///
    /// 2026-09-21 ("jobcards wants to save in our JobCardScannerDb not in dms" - clarified via
    /// AskUserQuestion to mean specifically this picker at the time, not yet a reversal of the
    /// 2026-09-05 "DMS is the sole source of truth" rule on List()/Get()/Create()): this picker was
    /// never restricted to BaplJobCardHeaderId != null, unlike List()/Get() at the time. That rule
    /// was fully reversed on 2026-09-24 (DMS write-back removed from Create() entirely, and the
    /// same now-stale BaplJobCardHeaderId != null filter removed from List()/Get() too - see both
    /// methods' own doc comments), so all three endpoints now agree: it returns every JobCardScanner
    /// job card in scope, DMS-linked or not, since a Repair Bill/Material
    /// Transfer can legitimately be raised against a job card that hasn't synced to DMS (or never
    /// will, e.g. DMS is unreachable) - it only needs a local JobCard row to link
    /// RepairBillDoc.JobCardId/MaterialTransferDoc.JobCardId to. IsDmsLinked in the response tags
    /// which is which, so the Job Search modal can label them rather than hiding the difference.
    ///
    /// 2026-09-23 ("not added grid button on this clcik open material transfered job cards history"
    /// - the THIRD restatement of the original "add grid button ... job card shown which will
    /// transfer from material transfer to save as proforma" ask, after two rounds that missed the
    /// mark): new optional `onlyWithMaterialTransfer` param. When true, this only returns job cards
    /// that already have at least one MaterialTransferDoc saved against them - i.e. exactly
    /// "material transferred job cards history" - via an EXISTS check, not a join (avoids returning
    /// duplicate rows for a job with more than one Material Transfer doc). Default false leaves
    /// every existing caller (the plain "Search Job" modal on this page and on Material Transfer
    /// Bill) returning every job card, unchanged.
    /// </summary>
    [HttpGet("search")]
    public async Task<IActionResult> Search(
        [FromQuery] DateOnly? dateFrom, [FromQuery] DateOnly? dateTo, [FromQuery] string? jobNo,
        [FromQuery] string? regNo, [FromQuery] string? chassisNo, [FromQuery] bool onlyWithMaterialTransfer = false)
    {
        var isOrgWideRole = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var query = _db.JobCards.AsNoTracking()
            .Include(j => j.Customer).Include(j => j.Vehicle)
            .AsQueryable();

        query = isOrgWideRole ? query : query.Where(j => j.DealerId == _currentUser.DealerId);

        var allowedLocations = _currentUser.WorkLocationCodes;
        if (allowedLocations.Count > 0)
        {
            var allowedLocationsList = allowedLocations.ToList();
            query = query.Where(j => j.BaplServiceLocationCode != null && allowedLocationsList.Contains(j.BaplServiceLocationCode));
        }

        if (dateFrom is not null) { var from = dateFrom.Value.ToDateTime(TimeOnly.MinValue); query = query.Where(j => j.CreatedAt >= from); }
        if (dateTo is not null) { var to = dateTo.Value.ToDateTime(TimeOnly.MaxValue); query = query.Where(j => j.CreatedAt <= to); }
        if (!string.IsNullOrWhiteSpace(jobNo)) query = query.Where(j => j.JobCardNumber.Contains(jobNo));
        if (!string.IsNullOrWhiteSpace(regNo)) query = query.Where(j => j.Vehicle!.RegNo != null && j.Vehicle.RegNo.Contains(regNo));
        if (!string.IsNullOrWhiteSpace(chassisNo)) query = query.Where(j => j.Vehicle!.Vin != null && j.Vehicle.Vin.Contains(chassisNo));
        if (onlyWithMaterialTransfer) query = query.Where(j => _db.MaterialTransferDocs.Any(m => m.JobCardId == j.Id));

        var rows = await query.OrderByDescending(j => j.CreatedAt).Take(100).ToListAsync();

        return Ok(rows.Select(j => new
        {
            j.Id,
            j.JobCardNumber,
            JobDate = DateOnly.FromDateTime(j.CreatedAt),
            Location = j.BaplServiceLocation,
            LocationCode = j.BaplServiceLocationCode,
            // Now includes job cards that never synced to DMS (see the widened Search() doc
            // comment above) - flagged so the Job Search modal can show which is which rather than
            // presenting them identically.
            IsDmsLinked = j.BaplJobCardHeaderId != null,
            JobTypeService = string.Join(" / ", new[] { j.BaplJobType, j.BaplServiceTypeName }.Where(s => !string.IsNullOrWhiteSpace(s))),
            PartyName = j.Customer != null ? j.Customer.Name : null,
            // 2026-09-21 ("according to state Intra state and inter state"): so the Repair Bill /
            // Material Transfer create pages can compare this against the signed-in user's own
            // Dealer.State (GET /api/auth/me's new DealerState) the same way the reference's
            // repair-bill.ts addLabour()/calculatePart() compare dealerState/custState, instead of
            // requiring a manual Same State/Different State pick every time.
            PartyState = j.Customer != null ? j.Customer.State : null,
            RegNo = j.Vehicle != null ? j.Vehicle.RegNo : null,
            ChassisNo = j.Vehicle != null ? j.Vehicle.Vin : null,
            VehicleType = j.Vehicle != null ? j.Vehicle.Model : null,
            JobSource = j.BaplJobSourceName,
            // 2026-09-22 ("in labour after jobcard serach this automatically details fetch") -
            // added for the Repair Bill create page's new "Selected Job Details" panel, matching
            // the reference DMS app's own KMs/Technician fields on that panel. Both already existed
            // on this app's own JobCard/Vehicle rows (JobCard.AssignedTechnicianName,
            // Vehicle.Odometer) but were never returned by this search endpoint before - real data,
            // not invented for this panel.
            Odometer = j.Vehicle != null ? j.Vehicle.Odometer : (double?)null,
            Technician = j.AssignedTechnicianName,
        }));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        // 2026-09-24 FIX: same stale "DMS is the sole source of truth" filter removed from List()
        // above, for the same reason - see that method's doc comment. A job card with no
        // BaplJobCardHeaderId (i.e. every job card created since DMS write-back was removed from
        // Create()) used to 404 here instead of opening.
        var jc = await FullQuery().FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();
        // 2026-09-17 "Employees" page - same Work Area location scoping as List() above. A job
        // card at a location outside the caller's Work Area 404s, same as one that doesn't exist -
        // not a 403, so this doesn't reveal that a job card exists at a location the caller can't see.
        var allowedLocationsForGet = _currentUser.WorkLocationCodes;
        if (allowedLocationsForGet.Count > 0 && (jc.BaplServiceLocationCode is null || !allowedLocationsForGet.Contains(jc.BaplServiceLocationCode, StringComparer.OrdinalIgnoreCase)))
            return NotFound();
        // 2026-09-28 ("from dms dont fetch jobcards and dont save jobcards only in our jobcard db
        // save this"): this used to call SyncClosedFromDmsAsync to pull DMS's own Closed/Billed
        // status into this job card on every open - a DMS fetch. Removed per this explicit
        // instruction - see List() above's matching removal and its doc comment for the full
        // reasoning. SyncClosedFromDmsAsync is left defined (now unused) in case this needs to
        // come back.
        return Ok(Detail(jc));
    }

    /// <summary>
    /// GET /api/jobcards/{id}/invoice-pdf - "Download Invoice from DMS": renders DMS's own
    /// repair bill (RepairBillHeader/RepairBillDetail, read live) for this job card as a GST tax
    /// invoice PDF matching DMS's own layout - see IInvoicePdfService.BuildInvoicePdfAsync.
    /// Same [Authorize(Policy = Policies.Staff)] as this controller's other GET endpoints (Get()
    /// above, List()) - no stricter policy needed, viewing an invoice PDF isn't a more sensitive
    /// operation than viewing the job card itself. 404 covers both "no such job card" and "nothing
    /// to download yet" (never synced to DMS, or synced but no repair bill raised there yet) -
    /// both are normal, everyday states, not errors. A real DMS problem (bad connection/schema
    /// drift) surfaces as 502 with the underlying message, same convention as BaplDmsController.
    /// </summary>
    [HttpGet("{id:guid}/invoice-pdf")]
    public async Task<IActionResult> InvoicePdf(Guid id)
    {
        byte[]? bytes;
        try
        {
            bytes = await _invoicePdf.BuildInvoicePdfAsync(id, HttpContext.RequestAborted);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not build the DMS invoice PDF for job card {JobCardId}", id);
            return StatusCode(502, new { message = ex.Message });
        }
        if (bytes is null) return NotFound();

        var jobCardNumber = await _db.JobCards.AsNoTracking().Where(j => j.Id == id).Select(j => j.JobCardNumber).FirstOrDefaultAsync();
        var fileNamePart = string.IsNullOrWhiteSpace(jobCardNumber) ? id.ToString() : jobCardNumber;
        return File(bytes, "application/pdf", $"invoice-{fileNamePart}.pdf");
    }

    /// <summary>
    /// POST /api/jobcards/{id}/estimates/email - Estimates Amount card's "Done" flow: builds the
    /// same Estimates Amount PDF as the "Estimate" browser-print option
    /// (IEstimatePdfService.BuildEstimatePdfAsync - Part Details/Labour Details/Grand Total, same
    /// numbers shown on screen) and emails it to whatever address the user typed into the textbox
    /// that appears once "Done" is clicked, via Microsoft Graph (IEmailClient - see
    /// GraphEmailClient's doc comment for the AzureAdGraph:SenderMailbox/Mail.Send setup this
    /// needs). Returns 400 for a missing/malformed address, 404 if the job card doesn't exist, and
    /// 502 if BuildEstimatePdfAsync or the Graph send itself fails - matches this controller's
    /// existing InvoicePdf/BaplDms error-response convention.
    ///
    /// 2026-09-24 CHANGE ("mail going from fixed mailid currently... which user logged from this
    /// logged user mailid wants to sent mail add this"): sent "as" _currentUser.Email - the
    /// signed-in staff user's own mailbox (same on web and mobile, since both call this one
    /// endpoint) - instead of always AzureAdGraph:SenderMailbox. See GraphEmailClient's
    /// fromMailbox doc comment for the one real caveat (an Exchange Application Access Policy, if
    /// the tenant has one, could still restrict which mailboxes this app is allowed to send "as" -
    /// that would surface here as the 502 below, not a silent failure).
    /// </summary>
    [HttpPost("{id:guid}/estimates/email")]
    public async Task<IActionResult> EmailEstimate(Guid id, EmailEstimateRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || !req.Email.Contains('@'))
            return BadRequest(new { message = "Enter a valid email address." });

        var jc = await _db.JobCards.AsNoTracking().Where(j => j.Id == id)
            .Select(j => new { j.JobCardNumber, CustomerName = j.Customer != null ? j.Customer.Name : null })
            .FirstOrDefaultAsync();
        if (jc is null) return NotFound();

        byte[]? pdf;
        try
        {
            pdf = await _estimatePdf.BuildEstimatePdfAsync(id, HttpContext.RequestAborted);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not build the Estimates Amount PDF for job card {JobCardId}", id);
            return StatusCode(502, new { message = "Could not build the estimate PDF." });
        }
        if (pdf is null) return NotFound();

        var subject = $"Estimate for Job Card {jc.JobCardNumber}";
        var htmlBody =
            $"<p>Dear {jc.CustomerName ?? "Customer"},</p>" +
            $"<p>Please find attached the estimate for your job card <strong>{jc.JobCardNumber}</strong>.</p>" +
            "<p>Thank you,<br/>JobCardScanner</p>";
        var attachment = new EmailAttachment($"estimate-{jc.JobCardNumber}.pdf", "application/pdf", pdf);

        // 2026-09-07: IEmailClient.SendAsync now returns the real failure reason (EmailSendResult.
        // Error) instead of a bare bool, so this message no longer just points at "check your
        // config somewhere" - it says exactly what Graph (or the token endpoint) rejected, e.g.
        // "SenderMailbox isn't a licensed Exchange Online mailbox" (404) vs. "Mail.Send not
        // consented" (403) vs. a bad ClientSecret at the token step.
        var emailResult = await _email.SendAsync(req.Email, subject, htmlBody, attachment, _currentUser.Email, HttpContext.RequestAborted);
        if (!emailResult.Success)
            return StatusCode(502, new { message = $"Could not send the email: {emailResult.Error ?? "unknown error"}" });

        return Ok(new { message = $"Estimate emailed to {req.Email}." });
    }

    // ---------------- Job Card Opening Wizard: finalize ----------------
    [HttpPost]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> Create(CreateJobCardRequest req)
    {
        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.Id == req.VehicleId);
        if (vehicle is null) return BadRequest(new { message = "Vehicle not found." });

        // A chassis can only be "checked in" once at a time per dealer - block opening a second
        // job card for the same chassis + dealer while an earlier one for it is still open.
        // Matches by VehicleId (this dealer's own Vehicle row for the chassis) and, in case a
        // duplicate Vehicle row exists for the same physical chassis, by the chassis number
        // itself (Vin) too.
        var openJobCardForChassis = await _db.JobCards.AsNoTracking()
            .Where(j => j.DealerId == req.DealerId && j.Status != JobCardStatus.Closed)
            .Where(j => j.VehicleId == req.VehicleId || (vehicle.Vin != null && j.Vehicle!.Vin == vehicle.Vin))
            .Select(j => j.JobCardNumber)
            .FirstOrDefaultAsync();
        if (openJobCardForChassis is not null)
            return BadRequest(new { message = $"This chassis already has an open job card ({openJobCardForChassis}). It must be closed before a new job card can be created for it." });

        // ---------------- 2026-09-24 CHANGE: DMS write-back REMOVED ("dont save this jobcard in
        // dms remove this all over flow that save in jobcard db only") ----------------
        // This used to be mandatory (2026-09-05's "DMS is now the sole source of truth" design,
        // itself a reversal of an even earlier best-effort design - see git history/the README for
        // both prior rounds): nothing was saved anywhere unless _baplDms.CreateJobCardAsync
        // succeeded first. Per this explicit new instruction, that is reversed again: a job card is
        // now saved ONLY into JobCardScanner's own database, exactly as every other feature in this
        // app already does (Repair Bill, Material Transfer, ...) - DMS's JobCardHeader is never
        // written to from here at all any more. FACT/consequence: BaplJobCardHeaderId/BaplJobNo/
        // BaplSyncStatus/BaplSyncError (still present on the JobCard model/DB column for OLD rows
        // that DO have DMS data from before this change) are simply left null on every new row -
        // there is no longer any code path that sets them. JobCardNumber goes back to being
        // generated locally (_numbering.NextJobCardNumberAsync), same as it worked before the
        // 2026-09-05 change. Job Type/Service Head/Service Type/Service Location are no longer
        // REQUIRED to create a job card (they existed only because DMS needed them) - they stay as
        // OPTIONAL descriptive fields on the wizard, still useful for Print/reporting.
        //
        // 2026-09-28 FURTHER CHANGE ("from dms dont fetch jobcards and dont save jobcards only in
        // our jobcard db save this"): this method used to ALSO run a read-only "does DMS already
        // show an open job card for this chassis" check right here (dealerBaplCode resolved, then
        // _baplDms.GetOpenJobCardForChassisAsync) - explicitly flagged in the previous round's
        // comment as "tell me if you'd rather this check go too, now that job cards are otherwise
        // fully decoupled from DMS." This instruction answers that: it's removed. DMS is no longer
        // fetched from OR written to anywhere in job card creation - the local open-job-card check
        // just above (against JobCardScanner's own JobCards table) is the only duplicate-work
        // safety check left, and DMS and JobCardScanner job cards are now two fully independent
        // systems with no cross-check between them at all.
        var customer = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == req.CustomerId);

        // 2026-09-17 "Employees" page - Work Area location scoping (see User.WorkLocationCodes's
        // doc comment). Empty WorkLocationCodes = unrestricted, unchanged from before this feature.
        // A user WITH assigned locations can only create a job card at one of them. Kept unchanged -
        // this is JobCardScanner's own access control, unrelated to the DMS write-back removed
        // above - but now only enforced when a Service Location was actually picked (it's optional
        // now, see above), since there's nothing to scope-check against otherwise.
        var allowedLocations = _currentUser.WorkLocationCodes;
        if (allowedLocations.Count > 0 && !string.IsNullOrWhiteSpace(req.BaplServiceLocationCode)
            && !allowedLocations.Contains(req.BaplServiceLocationCode, StringComparer.OrdinalIgnoreCase))
            return StatusCode(403, new { message = "You're not assigned to this service location. Ask your admin to add it under your Work Area on Admin -> Users." });

        var firstStage = await _db.WorkflowStages.AsNoTracking()
            .Where(s => (s.DealerId == null || s.DealerId == req.DealerId) && s.Active)
            .OrderBy(s => s.Seq).FirstOrDefaultAsync();

        var jobCard = new JobCard
        {
            // Local numbering again (JC/{dealer code}/{FY}/{seq}) - see this method's doc comment
            // above for why the DMS-derived number is no longer used for new rows.
            JobCardNumber = await _numbering.NextJobCardNumberAsync(req.DealerId),
            DealerId = req.DealerId,
            CustomerId = req.CustomerId,
            VehicleId = req.VehicleId,
            ServiceType = req.ServiceType,
            Source = req.Source,
            Priority = req.Priority,
            OdometerAtCheckIn = req.OdometerAtCheckIn,
            BatteryLevelAtCheckIn = req.BatteryLevelAtCheckIn,
            ExpectedDeliveryAt = req.ExpectedDeliveryAt,
            ServiceAdvisorId = req.ServiceAdvisorId ?? _currentUser.UserId,
            CustomerConsentNotes = req.CustomerConsentNotes,
            BaplJobType = req.BaplJobType,
            BaplServiceLocation = req.BaplServiceLocation,
            BaplSupervisorName = req.BaplSupervisorName,
            BaplTechnicianName = req.BaplTechnicianName,
            BaplManualJobNo = req.BaplManualJobNo,
            BaplJobTypeId = req.BaplJobTypeId,
            BaplServiceHeadId = req.BaplServiceHeadId,
            BaplServiceHeadName = req.BaplServiceHeadName,
            BaplServiceTypeId = req.BaplServiceTypeId,
            BaplServiceTypeName = req.BaplServiceTypeName,
            BaplServiceLocationCode = req.BaplServiceLocationCode,
            BaplJobSourceId = req.BaplJobSourceId,
            BaplJobSourceName = req.BaplJobSourceName,
            // No BaplJobCardHeaderId/BaplJobNo/BaplSyncStatus - this job card was never written to
            // DMS, see this method's doc comment above.
            Status = JobCardStatus.Open,
            CurrentStageId = firstStage?.Id,
            CreatedById = _currentUser.UserId,
        };
        foreach (var c in req.Complaints)
            jobCard.Complaints.Add(new JobCardComplaint { Description = c.Description, Category = c.Category, IsCustomerVoice = c.IsCustomerVoice });

        // 2026-09-28 ("jobcard create in our JobCardScanner db now its not craete jobcards"): the
        // actual save was NOT wrapped at all - any failure here (a bad/missing required field, a
        // uniqueness clash on JobCardNumber, a DB constraint) came back as a bare, unhandled 500
        // with no message body, which is exactly why the frontend fell through to its generic
        // "Failed to create job card." text and neither of us could see what actually broke. Unlike
        // the ERP/SMS wrapping above, this one is NOT best-effort/swallowed - a save failure here is
        // real and the request should still fail - it's now caught ONLY so the response carries the
        // real exception message, so the UI (and you) can see the actual cause immediately next time
        // instead of needing backend log access.
        try
        {
            _db.JobCards.Add(jobCard);
            await _db.SaveChangesAsync();

            if (firstStage is not null)
                _db.JobCardStageHistories.Add(new JobCardStageHistory { JobCardId = jobCard.Id, StageId = firstStage.Id, ChangedById = _currentUser.UserId });
            vehicle.Odometer = Math.Max(vehicle.Odometer, req.OdometerAtCheckIn);
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Could not save job card for dealer {DealerId}, vehicle {VehicleId}", req.DealerId, req.VehicleId);
            // 2026-09-28: your report confirmed the outer message alone ("An error occurred while
            // saving the entity changes. See the inner exception for details...") is exactly
            // EF Core's generic DbUpdateException text - it NEVER includes the actual cause. The
            // real SQL Server error (the constraint/column/value that actually failed) is always one
            // level down, in InnerException - EF wraps it, it doesn't replace it. Walking to the
            // innermost exception now, so this returns the real SqlException text (e.g. "Violation
            // of UNIQUE KEY constraint...", "Cannot insert the value NULL into column...") instead of
            // the generic wrapper.
            var root = ex;
            while (root.InnerException is not null) root = root.InnerException;
            return StatusCode(500, new { message = $"Could not create the job card: {root.Message}" });
        }

        // 2026-09-28 ("jobcard create in our JobCardScanner db now its not craete jobcards" - real
        // symptom confirmed: browser console showed a raw HTTP 500 on POST, and the frontend's
        // generic "Failed to create job card." fallback text - see JobCardWizardPage.tsx line ~761 -
        // meant the ACTUAL exception was invisible to both of us).
        //
        // FACT, found by re-reading this exact method: at this point the job card is ALREADY fully
        // committed - both SaveChangesAsync() calls above have already run. Everything from here on
        // (ERP push, SMS notification) is a side effect of an already-successful creation, not part
        // of it - exactly like every OTHER external-system call in this file (DMS reads throughout
        // this controller: see the ~13 try/catch blocks around _baplDms/_dmsBaplData calls). Those
        // two calls were the only ones in this entire file NOT wrapped that way. If your ERP
        // endpoint or SMS gateway was unreachable/slow/erroring at the moment you tested (very
        // plausible - it's a live external system), that alone would throw here, AFTER the job card
        // already exists in JobCardScannerDb, and the whole request would still come back as a 500 -
        // which matches your report far better than "job cards aren't being created" literally does.
        // ASSUMPTION (I can't confirm without your backend log, which would show the exact exception
        // type/message/line): this IS the cause. If your log turns out to show something else
        // entirely, tell me and I'll fix that instead - but this was a real, pre-existing gap in this
        // file's own established pattern either way, worth closing regardless.
        //
        // FIXED: both now best-effort, matching this file's convention elsewhere - logged as a
        // warning, never fail the (already-successful) job card creation because of them.
        try
        {
            await _erp.PushJobCardAsync(jobCard);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Job card {JobCardNumber} was created, but the ERP push failed - the job card itself is unaffected.", jobCard.JobCardNumber);
        }

        await _audit.LogAsync("JobCard.Create", "JobCard", jobCard.Id.ToString(), new { jobCard.JobCardNumber });

        if (customer is not null)
        {
            try
            {
                await _notifications.SendAsync(NotificationChannel.Sms, customer.Mobile,
                    $"Hi {customer.Name}, your job card {jobCard.JobCardNumber} has been created. Track: /track/{jobCard.TrackingToken}",
                    templateKey: "JobCardOpened", jobCardId: jobCard.Id, customerId: customer.Id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Job card {JobCardNumber} was created, but the SMS notification failed - the job card itself is unaffected.", jobCard.JobCardNumber);
            }
        }

        var full = await FullQuery().FirstAsync(j => j.Id == jobCard.Id);
        return CreatedAtAction(nameof(Get), new { id = jobCard.Id }, Detail(full));
    }

    // ---------------- Assignment / priority / ETA ----------------
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Update(Guid id, UpdateJobCardRequest req)
    {
        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();

        // AssignedTechnicianId is a JobCardScanner User FK (used by Worklogs) - a different concept
        // from AssignedTechnicianName below, and stays local; DMS has no equivalent.
        if (req.AssignedTechnicianId.HasValue) jc.AssignedTechnicianId = req.AssignedTechnicianId;

        // 2026-09-24 CHANGE ("dont save this jobcard in dms remove this all over flow that save in
        // jobcard db only"): AssignedTechnicianName/Priority/ExpectedDeliveryAt go back to being
        // JobCardScanner-local-only fields, saved ONLY here - the 2026-09-05 design this replaces
        // wrote them straight into DMS's own JobCardHeader (BaplDmsService.UpdateJobCardAsync) and
        // REFUSED to save at all if the job card had no BaplJobCardHeaderId. Since Create() no
        // longer links any new job card to DMS at all (see Create()'s own doc comment), that old
        // behavior would now 502-refuse this save for every job card created after that change -
        // this rewrite removes the DMS call and the BaplJobCardHeaderId requirement entirely, so
        // Assign Technician/Priority/Expected Delivery work the same for every job card regardless
        // of whether it happens to carry old DMS-linkage data from before this change.
        var trimmedTechnicianName = req.AssignedTechnicianName is null ? null
            : string.IsNullOrWhiteSpace(req.AssignedTechnicianName) ? null : req.AssignedTechnicianName.Trim();
        if (req.AssignedTechnicianName is not null) jc.AssignedTechnicianName = trimmedTechnicianName;
        if (req.Priority.HasValue) jc.Priority = req.Priority.Value;
        if (req.ExpectedDeliveryAt.HasValue) jc.ExpectedDeliveryAt = req.ExpectedDeliveryAt;
        jc.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await _audit.LogAsync("JobCard.Update", "JobCard", jc.Id.ToString(), req);
        return Ok(new { jc.Id });
    }

    // ---------------- Configurable workflow: stage transition ----------------
    [HttpPost("{id:guid}/stage")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> ChangeStage(Guid id, ChangeStageRequest req)
    {
        var jc = await _db.JobCards.Include(j => j.StageHistory).FirstOrDefaultAsync(j => j.Id == id);
        var stage = await _db.WorkflowStages.AsNoTracking().FirstOrDefaultAsync(s => s.Id == req.StageId);
        if (jc is null || stage is null) return NotFound();
        var technicianGate = RequireAssignedTechnician(jc);
        if (technicianGate is not null) return technicianGate;

        var openHistory = jc.StageHistory.Where(h => h.ExitedAt == null).OrderByDescending(h => h.EnteredAt).FirstOrDefault();
        if (openHistory is not null) openHistory.ExitedAt = DateTime.UtcNow;

        _db.JobCardStageHistories.Add(new JobCardStageHistory { JobCardId = jc.Id, StageId = stage.Id, ChangedById = _currentUser.UserId, Notes = req.Notes });
        jc.CurrentStageId = stage.Id;
        jc.UpdatedAt = DateTime.UtcNow;
        // Reaching a terminal stage (the 7-step pipeline's "Invoice Generated" - see
        // redefine-workflow-stages-to-7-steps.sql) now closes the job card immediately, per explicit
        // decision: "invoice generated = closed immediately" (skips the separate customer-facing OTP
        // closure flow below - /closure/otp + /closure/verify - which is still here and still works,
        // just no longer the only path to Status=Closed). Previously this only set PendingClosure and
        // left the OTP step as the sole way to actually reach Closed.
        if (stage.IsTerminal && jc.Status != JobCardStatus.Closed)
        {
            jc.Status = JobCardStatus.Closed;
            jc.ClosedAt = DateTime.UtcNow;
            jc.ActualDeliveryAt ??= DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        await _audit.LogAsync("JobCard.ChangeStage", "JobCard", jc.Id.ToString(), new { stage.StageKey });
        return Ok(new { jc.Id, jc.CurrentStageId });
    }

    // ---------------- Inspection ----------------
    [HttpPost("{id:guid}/inspections")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> AddInspection(Guid id, AddInspectionRequest req)
    {
        if (!await _db.JobCards.AnyAsync(j => j.Id == id)) return NotFound();
        var item = new JobCardInspection { JobCardId = id, Component = req.Component, Condition = req.Condition, Notes = req.Notes, TechnicianId = req.TechnicianId ?? _currentUser.UserId };
        _db.JobCardInspections.Add(item);
        await _db.SaveChangesAsync();
        return Ok(item);
    }

    // ---------------- Photos ----------------
    [HttpPost("{id:guid}/photos")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> AddPhoto(Guid id, AddPhotoRequest req)
    {
        if (!await _db.JobCards.AnyAsync(j => j.Id == id)) return NotFound();
        var photo = new JobCardPhoto { JobCardId = id, Stage = req.Stage, Url = req.Url, Caption = req.Caption, UploadedById = _currentUser.UserId };
        _db.JobCardPhotos.Add(photo);
        await _db.SaveChangesAsync();
        return Ok(photo);
    }

    private static readonly string[] AllowedPhotoContentTypes = { "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif" };
    /// <summary>2026-09-03 - the Part Suggestion grid's Picture column ("upload photos and video")
    /// needs video too, unlike the general Photos card above which stays images-only. Kept as its
    /// own list rather than widening AllowedPhotoContentTypes itself, so the general Photos card's
    /// error message/behavior is unaffected.</summary>
    private static readonly string[] AllowedVideoContentTypes = { "video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-msvideo" };

    /// <summary>
    /// POST /api/jobcards/{id}/photos/upload - the real "capture and upload" behind the Job Card
    /// Detail page's Photos card (unlike AddPhoto above, which only ever stored a caller-supplied
    /// Url and had no upload/storage behind it anywhere in this codebase). Accepts a single image
    /// file plus the optional GPS coordinates the browser's Geolocation API captured at the same
    /// moment, stores the file on local disk under wwwroot/uploads/jobcard-photos/{jobCardId}/, and
    /// records a JobCardPhoto row pointing at the resulting static URL. 1 GB cap matches the
    /// [RequestSizeLimit] below (raised from the original 20 MB per your request, since the Review
    /// &amp; Create step's Photos section is now required rather than optional) - Kestrel's own
    /// default max request body size (~28.6 MB) would otherwise still reject a large upload before
    /// this action even runs, but [RequestSizeLimit] overrides that per-endpoint limit, which is all
    /// this app needs since there's no separate reverse proxy/IIS in front of Kestrel here.
    /// </summary>
    [HttpPost("{id:guid}/photos/upload")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    [RequestSizeLimit(1_000_000_000)]
    public async Task<IActionResult> UploadPhoto(Guid id, [FromForm] UploadPhotoForm form)
    {
        var jobCardForPhoto = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jobCardForPhoto is null) return NotFound();
        if (form.File is null || form.File.Length == 0) return BadRequest(new { message = "A photo file is required." });
        // 2026-09-03: video is only ever sent by the Part Suggestion grid's Picture column today,
        // but this check is intentionally not gated on PartSuggestionId being set - no reason to
        // reject a video from a future caller that also has a legitimate reason to upload one.
        var isVideo = AllowedVideoContentTypes.Contains(form.File.ContentType, StringComparer.OrdinalIgnoreCase);
        if (!isVideo && !AllowedPhotoContentTypes.Contains(form.File.ContentType, StringComparer.OrdinalIgnoreCase))
            return BadRequest(new { message = $"Unsupported file type '{form.File.ContentType}'. Upload a photo (JPEG, PNG, WEBP, or HEIC) or a video (MP4, MOV, WEBM, 3GP, or AVI)." });

        var ext = Path.GetExtension(form.File.FileName);
        if (string.IsNullOrWhiteSpace(ext) || ext.Length > 10) ext = isVideo ? ".mp4" : ".jpg";
        var fileName = $"{Guid.NewGuid():N}{ext}";
        var webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
        var relativeDir = Path.Combine("uploads", "jobcard-photos", id.ToString());
        var absoluteDir = Path.Combine(webRoot, relativeDir);
        Directory.CreateDirectory(absoluteDir);

        var absolutePath = Path.Combine(absoluteDir, fileName);
        await using (var stream = System.IO.File.Create(absolutePath))
        {
            await form.File.CopyToAsync(stream);
        }

        // Served by app.UseStaticFiles() in Program.cs - a relative path so the frontend prefixes
        // it with the same VITE_API_BASE_URL it already uses for every other API call.
        var url = "/" + relativeDir.Replace(Path.DirectorySeparatorChar, '/') + "/" + fileName;

        var photo = new JobCardPhoto
        {
            JobCardId = id,
            Stage = form.Stage,
            Url = url,
            Caption = form.Caption,
            Latitude = form.Latitude,
            Longitude = form.Longitude,
            PartSuggestionId = form.PartSuggestionId,
            UploadedById = _currentUser.UserId,
        };
        _db.JobCardPhotos.Add(photo);
        await _db.SaveChangesAsync();

        // 2026-09-28 ("from dms dont fetch jobcards and dont save jobcards only in our jobcard db
        // save this"): this used to also best-effort mirror the photo into DMS's own database
        // (_baplDms.SaveJobCardPhotoAsync) whenever this job card had a BaplJobCardHeaderId - a DMS
        // SAVE. Removed per this explicit instruction; the local save just above (JobCardPhotos,
        // JobCardScannerDb) is now the only place a job card photo is ever written.
        return Ok(photo);
    }

    /// <summary>PUT /api/jobcards/photos/{photoId} - edits a photo's caption after upload. Added so
    /// the Photos card can offer a caption box under each already-uploaded photo instead of only
    /// letting the caption be typed once before choosing the file.</summary>
    [HttpPut("photos/{photoId:guid}")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> UpdatePhotoCaption(Guid photoId, UpdatePhotoCaptionRequest req)
    {
        var photo = await _db.JobCardPhotos.FirstOrDefaultAsync(p => p.Id == photoId);
        if (photo is null) return NotFound();
        photo.Caption = string.IsNullOrWhiteSpace(req.Caption) ? null : req.Caption.Trim();
        await _db.SaveChangesAsync();
        return Ok(photo);
    }

    // ---------------- Technician worklog (start/stop timer) ----------------
    [HttpPost("{id:guid}/worklogs/start")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> StartWorklog(Guid id, StartWorklogRequest req)
    {
        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();
        var technicianGate = RequireAssignedTechnician(jc);
        if (technicianGate is not null) return technicianGate;

        var log = new JobCardWorklog { JobCardId = id, TechnicianId = req.TechnicianId, TaskDescription = req.TaskDescription };
        _db.JobCardWorklogs.Add(log);
        if (jc.Status != JobCardStatus.InProgress) jc.Status = JobCardStatus.InProgress;
        // Workflow Timeline auto-advances to "Work In Progress" the first time a technician starts a
        // worklog - see WorkflowStageAutomation's doc comment.
        await WorkflowStageAutomation.AdvanceIfAheadAsync(_db, jc, "in_repair", _currentUser.UserId, "Auto-advanced: work started.");
        await _db.SaveChangesAsync();
        return Ok(log);
    }

    [HttpPost("worklogs/{worklogId:guid}/end")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> EndWorklog(Guid worklogId, EndWorklogRequest req)
    {
        var log = await _db.JobCardWorklogs.FirstOrDefaultAsync(w => w.Id == worklogId);
        if (log is null) return NotFound();
        log.EndedAt = DateTime.UtcNow;
        log.DurationMinutes = (int)(log.EndedAt.Value - log.StartedAt).TotalMinutes;
        log.Notes = req.Notes;
        await _db.SaveChangesAsync();
        return Ok(log);
    }

    // ---------------- Quality check ----------------
    [HttpPost("{id:guid}/qc-items")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> UpsertQcItem(Guid id, UpsertQcItemRequest req)
    {
        var item = await _db.QcChecklistItems.FirstOrDefaultAsync(x => x.JobCardId == id && x.ItemName == req.ItemName);
        if (item is null)
        {
            item = new QcChecklistItem { JobCardId = id, ItemName = req.ItemName };
            _db.QcChecklistItems.Add(item);
        }
        item.Passed = req.Passed;
        item.Notes = req.Notes;
        item.CheckedById = _currentUser.UserId;
        item.CheckedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Note: we deliberately do NOT auto-transition the job card here. Unlike a fixed
        // checklist, QC items are added one at a time (see JobCardDetailPage's per-item "Mark
        // Pass" buttons), so checking "are all items passed" mid-way would trigger on the very
        // first item added rather than a real completed checklist. The Workshop Manager moves
        // the job card to its next stage explicitly via POST /api/jobcards/{id}/stage once QC
        // is actually complete.
        return Ok(item);
    }

    // ---------------- OTP-based job card closure ----------------
    [HttpPost("{id:guid}/closure/otp")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> InitiateClosureOtp(Guid id)
    {
        var jc = await _db.JobCards.Include(j => j.Customer).FirstOrDefaultAsync(j => j.Id == id);
        if (jc?.Customer is null) return NotFound();
        var result = await _otp.IssueOtpAsync(OtpPurpose.JobCardClosure, jc.Customer.Mobile, jc.Id, email: jc.Customer.Email);
        return Ok(new OtpIssueResponse(result.RequestId, jc.Customer.Mobile, "OTP sent to the customer's registered mobile to confirm job card closure.", result.DevCode));
    }

    [HttpPost("{id:guid}/closure/verify")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> VerifyClosureOtp(Guid id, OtpVerifyRequest req)
    {
        var verified = await _otp.VerifyOtpAsync(req.OtpRequestId, req.Code);
        if (!verified) return BadRequest(new { message = "Invalid or expired OTP." });

        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();
        jc.Status = JobCardStatus.Closed;
        jc.ClosedAt = DateTime.UtcNow;
        jc.ActualDeliveryAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("JobCard.Close", "JobCard", jc.Id.ToString());
        return Ok(new { jc.Id, jc.Status, jc.ClosedAt });
    }

    // ---------------- Technicians available for assignment (Workflow Timeline panel) ----------------
    /// <summary>Minimal technician list for the "Assign Technician" field on the Job Card detail
    /// page's Workflow Timeline panel. Deliberately its own lightweight, dealer-scoped endpoint
    /// rather than reusing GET /api/users: that endpoint is DealerAdminUp-gated (Dealer/Corporate/
    /// System Admin only), but a WorkshopManager - who IS allowed to assign a technician via
    /// PUT /api/jobcards/{id} below - doesn't clear DealerAdminUp, so they'd never be able to
    /// populate the dropdown they're otherwise allowed to use.</summary>
    [HttpGet("technicians")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Technicians([FromQuery] Guid? dealerId)
    {
        // Same fix as List() above's doc comment on this exact bug.
        var isOrgWideRole = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var effectiveDealerId = isOrgWideRole ? dealerId : _currentUser.DealerId;
        var q = _db.Users.AsNoTracking().Where(u => u.Role == StaffRole.Technician && u.Active);
        q = isOrgWideRole
            ? (effectiveDealerId.HasValue ? q.Where(u => u.DealerId == effectiveDealerId) : q)
            : q.Where(u => u.DealerId == effectiveDealerId);

        var technicians = await q.OrderBy(u => u.Name).Select(u => new { u.Id, u.Name }).ToListAsync();
        return Ok(technicians);
    }

    // ---------------- helpers ----------------

    /// <summary>
    /// Closes local JobCard rows that DMS already considers Closed (RepairbillStatus = 'Billed')
    /// but whose local Status hasn't caught up yet. Reported directly: "from dms which we created
    /// jobcard...close from there this will close but from our jobscanner...this will not close" -
    /// before this, JobCardScanner's own Status was only ever changed by JobCardScanner's own actions
    /// (worklog start, the closure-OTP flow, workflow stage automation), so closing/billing a job
    /// card directly in DMS never touched it at all, no matter how long ago that happened.
    /// Called from List() and Get() - the two places a user would actually notice a stale status -
    /// with a sync-on-read approach rather than a background poller, matching this codebase's
    /// existing pattern of reading DMS live (InvoicePdfService, GetOpenJobCardForChassisAsync,
    /// etc.) instead of running a separate sync job. Mutates each passed-in JobCard's Status/
    /// ClosedAt/ActualDeliveryAt in place (so THIS request's response reflects it immediately, not
    /// just the next one) and persists the same change via a small separately-tracked query, since
    /// callers query with AsNoTracking(). Best-effort: a DMS hiccup here is logged and swallowed
    /// rather than breaking the list/detail page - the same "still show JobCardScanner's own data"
    /// convention List() already uses when blending in DMS rows fails.
    /// </summary>
    private async Task SyncClosedFromDmsAsync(IReadOnlyList<JobCard> jobCards, CancellationToken ct)
    {
        var openHeaderIds = jobCards
            .Where(j => j.Status != JobCardStatus.Closed && j.Status != JobCardStatus.Cancelled && j.BaplJobCardHeaderId.HasValue)
            .Select(j => j.BaplJobCardHeaderId!.Value)
            .Distinct()
            .ToList();
        if (openHeaderIds.Count == 0) return;

        IReadOnlyDictionary<int, string> dmsStatuses;
        try
        {
            dmsStatuses = await _baplDms.GetJobStatusesAsync(openHeaderIds, ct);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not sync DMS closed-status into JobCardScanner for {Count} job card(s)", openHeaderIds.Count);
            return;
        }

        var newlyClosed = jobCards
            .Where(j => j.BaplJobCardHeaderId.HasValue && dmsStatuses.TryGetValue(j.BaplJobCardHeaderId.Value, out var s) && s == "Closed")
            .ToList();
        if (newlyClosed.Count == 0) return;

        var idsToClose = newlyClosed.Select(j => j.Id).ToList();
        var tracked = await _db.JobCards.Where(j => idsToClose.Contains(j.Id)).ToListAsync(ct);
        var now = DateTime.UtcNow;
        foreach (var t in tracked)
        {
            t.Status = JobCardStatus.Closed;
            t.ClosedAt ??= now;
            t.ActualDeliveryAt ??= now;
            // 2026-09-07 ("in dms after jobcard closed invoice create so in our jobscanner also
            // when jobcard close from dms invoice generate...same as it is like dms in flow") -
            // DMS closing/billing a job card directly means DMS has already raised its own invoice
            // for it, but until now this method only ever flipped the local Status field - the
            // Workflow Timeline's CurrentStage stayed wherever it was (typically stuck at "Repair
            // Completed"), so a job card DMS closed on its own never showed "Invoice Generated"
            // here, only the manual "Generate Invoice" button (JobCardsController.ChangeStage) ever
            // reached that stage. AdvanceIfAheadAsync targets that exact same terminal stage - same
            // stage, same StageHistory record shape - just system-triggered (changedById: null)
            // instead of a button click, mirroring what already happened in DMS. It never moves a
            // job card backwards, and its own terminal-stage handling is a no-op here since Status
            // is already Closed by the two lines above (guarded by `jc.Status !=
            // JobCardStatus.Closed`), so ClosedAt/ActualDeliveryAt above aren't touched twice.
            await WorkflowStageAutomation.AdvanceIfAheadAsync(_db, t, "invoice_generated", null, "Auto-advanced: DMS closed this job card (invoice already generated in DMS).");
        }
        await _db.SaveChangesAsync(ct);

        foreach (var j in newlyClosed)
        {
            j.Status = JobCardStatus.Closed;
            j.ClosedAt ??= now;
            j.ActualDeliveryAt ??= now;
        }
    }

    private IQueryable<JobCard> FullQuery() => _db.JobCards.AsNoTracking()
        .Include(j => j.Customer).Include(j => j.Vehicle).ThenInclude(v => v!.Warranty)
        .Include(j => j.Dealer).Include(j => j.CurrentStage)
        .Include(j => j.ServiceAdvisor).Include(j => j.AssignedTechnician)
        .Include(j => j.Complaints).Include(j => j.Inspections)
        .Include(j => j.Photos).Include(j => j.StageHistory).ThenInclude(h => h.Stage)
        // ChangedBy - a second Include(...).ThenInclude(...) chain off the same StageHistory
        // collection, since ThenInclude only continues from its own immediately-preceding
        // Include/ThenInclude and Stage/ChangedBy are sibling properties on JobCardStageHistory, not
        // nested off each other. Needed so the Workflow Timeline's history grid (JobCardDetailPage's
        // WorkflowHistoryGrid) can show who made each change, not just what/when.
        .Include(j => j.StageHistory).ThenInclude(h => h.ChangedBy)
        .Include(j => j.Worklogs).Include(j => j.QcChecklistItems)
        .Include(j => j.Estimates).ThenInclude(e => e.Lines)
        .Include(j => j.Parts).ThenInclude(p => p.Part)
        .Include(j => j.PartSuggestions)
        .Include(j => j.LabourSuggestions)
        .Include(j => j.Invoice);

    private static object Summarize(JobCard j) => new
    {
        j.Id,
        j.JobCardNumber,
        Status = j.Status.ToString(),
        ServiceType = j.ServiceType.ToString(),
        Priority = j.Priority.ToString(),
        CustomerName = j.Customer?.Name,
        CustomerMobile = j.Customer?.Mobile,
        VehicleModel = j.Vehicle?.Model,
        VehicleRegNo = j.Vehicle?.RegNo,
        StageLabel = j.CurrentStage?.Label,
        ServiceAdvisorName = j.ServiceAdvisor?.Name,
        TechnicianName = j.AssignedTechnician?.Name ?? j.AssignedTechnicianName,
        j.CreatedAt,
        j.ExpectedDeliveryAt,
        PhotoCount = j.Photos.Count,
        Source = "JobCardScanner",
    };

    /// <summary>Shapes a DMS job card row (see BaplDmsService.SearchJobCardsAsync) into the
    /// same field names as Summarize() above so the /jobcards list page can render both kinds of
    /// row through one table - Source distinguishes them (BaplDms rows have no JobCardScanner Id,
    /// so the frontend must not try to link to a Job Card Detail page for one). Fields
    /// JobCardScanner tracks but DMS's own job card doesn't (ServiceType/Priority/StageLabel/
    /// ExpectedDeliveryAt) come through null rather than guessed.</summary>
    private static object SummarizeBapl(BaplDmsJobCardListRow r) => new
    {
        Id = $"bapl-{r.JobCardHeaderId}",
        JobCardNumber = $"{r.JobPrefix}{r.JobNo}".Trim(),
        Status = string.IsNullOrWhiteSpace(r.JobStatus) ? "Unknown" : r.JobStatus,
        ServiceType = (string?)null,
        Priority = (string?)null,
        CustomerName = r.CustomerName,
        CustomerMobile = r.CustomerMobile,
        VehicleModel = r.ModelName,
        VehicleRegNo = string.IsNullOrWhiteSpace(r.RegisterNo) ? r.ChassisNo : r.RegisterNo,
        StageLabel = (string?)null,
        ServiceAdvisorName = r.Supervisor,
        TechnicianName = r.Technician,
        CreatedAt = r.JobInDate?.ToDateTime(TimeOnly.MinValue) ?? (DateTime?)null,
        ExpectedDeliveryAt = (DateTime?)null,
        PhotoCount = (int?)null,
        Source = "BaplDms",
    };

    private static object Detail(JobCard j, string? baplSyncWarning = null) => new
    {
        j.Id,
        j.JobCardNumber,
        Status = j.Status.ToString(),
        ServiceType = j.ServiceType.ToString(),
        Source = j.Source.ToString(),
        Priority = j.Priority.ToString(),
        j.OdometerAtCheckIn,
        j.BatteryLevelAtCheckIn,
        j.ExpectedDeliveryAt,
        j.ActualDeliveryAt,
        j.ClosedAt,
        j.TrackingToken,
        j.CreatedAt,
        j.BaplJobType,
        j.BaplServiceLocation,
        j.BaplSupervisorName,
        j.BaplTechnicianName,
        j.BaplManualJobNo,
        // *Id fields (not just the display-only *Name strings above) are needed so the Labour
        // Suggestion panel can scope its DMS LabourMaster search by this job card's own
        // already-selected Job Type/Service Head/Service Type cascade, same IDs the wizard used.
        j.BaplJobTypeId,
        j.BaplServiceHeadId,
        j.BaplServiceHeadName,
        j.BaplServiceTypeId,
        j.BaplServiceTypeName,
        j.BaplJobSourceName,
        j.BaplServiceLocationCode,
        j.BaplJobCardHeaderId,
        j.BaplJobNo,
        j.BaplSyncStatus,
        j.BaplSyncError,
        BaplSyncWarning = baplSyncWarning,
        Customer = j.Customer,
        Vehicle = j.Vehicle,
        Dealer = j.Dealer is null ? null : new { j.Dealer.Id, j.Dealer.Name, j.Dealer.Code },
        // 2026-09-03: this job card's own dealer, resolved to DMS's own dealer code (distinct
        // from j.Dealer.Code above, which is JobCardScanner's own local code) - needed so the
        // Labour Suggestion panel's GET /api/bapl-dms/labour?dealerCode=... call can scope the new
        // PartWiseLabourMaster union to the right dealer, the same way baplServiceLocationCode
        // already scopes Part Suggestion's PartsInventory lookup.
        BaplDealerCode = j.Dealer == null ? null : j.Dealer.BaplDmsDealerCode,
        CurrentStage = j.CurrentStage,
        ServiceAdvisor = j.ServiceAdvisor is null ? null : new { j.ServiceAdvisor.Id, j.ServiceAdvisor.Name },
        AssignedTechnician = j.AssignedTechnician is null ? null : new { j.AssignedTechnician.Id, j.AssignedTechnician.Name },
        j.AssignedTechnicianName,
        j.Complaints,
        j.Inspections,
        j.Photos,
        StageHistory = j.StageHistory.OrderBy(h => h.EnteredAt),
        j.Worklogs,
        j.QcChecklistItems,
        Estimates = j.Estimates,
        Parts = j.Parts,
        PartSuggestions = j.PartSuggestions,
        LabourSuggestions = j.LabourSuggestions,
        Invoice = j.Invoice,
    };

    // ---------------- Part Suggestion ("Part Suggestion" panel) ----------------
    /// <summary>POST /api/jobcards/{id}/part-suggestions - saves one DMS PartsInventory item
    /// suggested for this job card, with a Paid/U-W status tracked only in JobCardScannerDb (see
    /// JobCardPartSuggestion's doc comment - this does not write anything back into DMS).</summary>
    [HttpPost("{id:guid}/part-suggestions")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> AddPartSuggestion(Guid id, AddPartSuggestionRequest req)
    {
        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();
        var technicianGate = RequireAssignedTechnician(jc);
        if (technicianGate is not null) return technicianGate;
        if (string.IsNullOrWhiteSpace(req.ItemCode)) return BadRequest(new { message = "itemCode is required." });
        if (req.Status != "Paid" && req.Status != "U/W") return BadRequest(new { message = "status must be 'Paid' or 'U/W'." });

        var suggestion = new JobCardPartSuggestion
        {
            JobCardId = id,
            ItemCode = req.ItemCode.Trim(),
            AvailableQtyAtSuggestion = req.AvailableQtyAtSuggestion,
            Status = req.Status,
            Quantity = req.Quantity < 1 ? 1 : req.Quantity,
            Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
            HsnCode = string.IsNullOrWhiteSpace(req.HsnCode) ? null : req.HsnCode.Trim(),
            Mrp = req.Mrp,
            SuggestedById = _currentUser.UserId,
        };
        _db.JobCardPartSuggestions.Add(suggestion);
        try
        {
            // Workflow Timeline auto-advances to "Part Suggestion" the first time one is added - see
            // WorkflowStageAutomation's doc comment. No-ops (stays put) on every suggestion after the
            // first, or if the job card has already moved further along.
            await WorkflowStageAutomation.AdvanceIfAheadAsync(_db, jc, "part_suggestion", _currentUser.UserId, "Auto-advanced: part suggested.");
            // 2026-09-03: also push straight on to "Estimate Created" - a part suggestion is exactly
            // what makes the Estimates Amount tab non-empty (see EstimatesCard on the frontend), so
            // an estimate now genuinely exists the moment this is added. The OLD trigger for this
            // stage (EstimatesController.Create, the "Send Estimate to Customer" OTP flow) is no
            // longer reachable from the UI - that whole flow was replaced by EstimatesCard reading
            // Part/Labour Suggestions directly - which meant "Estimate Created" could never actually
            // fire any more even though Part/Labour Suggestions kept landing in Estimates Amount.
            // Chained (not "either/or" with the part_suggestion advance above): AdvanceIfAheadAsync
            // only ever moves forward, using jc.CurrentStageId as already updated by the call above,
            // so a job card that was behind both stages correctly lands on Estimate Created in one
            // request, and one already at/past it is untouched either way.
            await WorkflowStageAutomation.AdvanceIfAheadAsync(_db, jc, "estimate_created", _currentUser.UserId, "Auto-advanced: estimate created (part suggested).");
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // This save writes into the Quantity/Description/HsnCode/Mrp columns added by
            // deploy/add-part-suggestion-columns.sql - on a database that migration was never run
            // against, SQL Server throws "Invalid column name" here, which without this catch just
            // surfaces as an opaque 500 in the browser Network tab with no way to tell that apart
            // from any other failure. Log the full exception and echo its message back so the
            // actual cause (missing column vs. something else) is visible without digging through
            // server logs.
            _logger.LogError(ex, "Could not save part suggestion for job card {JobCardId}", id);
            return StatusCode(500, new { message = "Could not save the part suggestion.", detail = ex.GetBaseException().Message });
        }
        return Ok(suggestion);
    }

    /// <summary>PUT /api/jobcards/part-suggestions/{suggestionId} - flips a suggested part between
    /// Paid and U/W after the fact.</summary>
    [HttpPut("part-suggestions/{suggestionId:guid}")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> UpdatePartSuggestionStatus(Guid suggestionId, UpdatePartSuggestionStatusRequest req)
    {
        if (req.Status != "Paid" && req.Status != "U/W") return BadRequest(new { message = "status must be 'Paid' or 'U/W'." });
        var suggestion = await _db.JobCardPartSuggestions.FirstOrDefaultAsync(s => s.Id == suggestionId);
        if (suggestion is null) return NotFound();
        suggestion.Status = req.Status;
        await _db.SaveChangesAsync();
        return Ok(suggestion);
    }

    /// <summary>DELETE /api/jobcards/part-suggestions/{suggestionId} - removes a suggested part
    /// (Item 16 - "multiple add and remove"), mirroring DeleteLabourSuggestion below.</summary>
    [HttpDelete("part-suggestions/{suggestionId:guid}")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> DeletePartSuggestion(Guid suggestionId)
    {
        var suggestion = await _db.JobCardPartSuggestions.FirstOrDefaultAsync(s => s.Id == suggestionId);
        if (suggestion is null) return NotFound();
        _db.JobCardPartSuggestions.Remove(suggestion);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ---------------- Labour Suggestion ("Labour Suggestion" panel) ----------------
    /// <summary>POST /api/jobcards/{id}/labour-suggestions - saves one DMS LabourMaster line
    /// suggested for this job card. Snapshots Description/HSN/GST/Rate from the request as picked
    /// on the frontend (same trust level as AddPartSuggestion's AvailableQtyAtSuggestion - this is
    /// JobCardScanner-only history/reporting, not re-verified against DMS server-side) - see
    /// JobCardLabourSuggestion's doc comment. Does not write anything back into DMS.</summary>
    [HttpPost("{id:guid}/labour-suggestions")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> AddLabourSuggestion(Guid id, AddLabourSuggestionRequest req)
    {
        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();
        var technicianGate = RequireAssignedTechnician(jc);
        if (technicianGate is not null) return technicianGate;
        if (string.IsNullOrWhiteSpace(req.LabourCode)) return BadRequest(new { message = "labourCode is required." });
        if (req.Quantity < 1) return BadRequest(new { message = "quantity must be at least 1." });

        var suggestion = new JobCardLabourSuggestion
        {
            JobCardId = id,
            LabourCode = req.LabourCode.Trim(),
            LabourDescription = string.IsNullOrWhiteSpace(req.LabourDescription) ? null : req.LabourDescription.Trim(),
            HsnCode = string.IsNullOrWhiteSpace(req.HsnCode) ? null : req.HsnCode.Trim(),
            Sgst = req.Sgst,
            Cgst = req.Cgst,
            Igst = req.Igst,
            RateAtSuggestion = req.RateAtSuggestion,
            Quantity = req.Quantity,
            IssueType = string.IsNullOrWhiteSpace(req.IssueType) ? null : req.IssueType.Trim(),
            SuggestedById = _currentUser.UserId,
        };
        _db.JobCardLabourSuggestions.Add(suggestion);
        try
        {
            // Workflow Timeline auto-advances to "Labour Suggestion" the first time one is added -
            // see WorkflowStageAutomation's doc comment.
            await WorkflowStageAutomation.AdvanceIfAheadAsync(_db, jc, "labour_suggestion", _currentUser.UserId, "Auto-advanced: labour suggested.");
            // 2026-09-03: also push straight on to "Estimate Created" - see the matching comment in
            // AddPartSuggestion above for why (Estimates Amount now has content either way).
            await WorkflowStageAutomation.AdvanceIfAheadAsync(_db, jc, "estimate_created", _currentUser.UserId, "Auto-advanced: estimate created (labour suggested).");
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Same reasoning as AddPartSuggestion's catch above - surface the real cause instead of
            // a bare 500.
            _logger.LogError(ex, "Could not save labour suggestion for job card {JobCardId}", id);
            return StatusCode(500, new { message = "Could not save the labour suggestion.", detail = ex.GetBaseException().Message });
        }
        return Ok(suggestion);
    }

    /// <summary>PUT /api/jobcards/labour-suggestions/{suggestionId} - edits a suggested labour
    /// line's Quantity and/or Issue Type after the fact. RateAtSuggestion is deliberately NOT
    /// editable here (locked from LabourMaster's own rate card at the time it was suggested - see
    /// JobCardLabourSuggestion's doc comment) - to change the rate, remove this suggestion and
    /// re-add it from the current LabourMaster list instead.</summary>
    [HttpPut("labour-suggestions/{suggestionId:guid}")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> UpdateLabourSuggestion(Guid suggestionId, UpdateLabourSuggestionRequest req)
    {
        if (req.Quantity < 1) return BadRequest(new { message = "quantity must be at least 1." });
        var suggestion = await _db.JobCardLabourSuggestions.FirstOrDefaultAsync(s => s.Id == suggestionId);
        if (suggestion is null) return NotFound();
        suggestion.Quantity = req.Quantity;
        suggestion.IssueType = string.IsNullOrWhiteSpace(req.IssueType) ? null : req.IssueType.Trim();
        await _db.SaveChangesAsync();
        return Ok(suggestion);
    }

    /// <summary>DELETE /api/jobcards/labour-suggestions/{suggestionId} - removes a suggested labour
    /// line (e.g. added by mistake, or being replaced with a different rate/quantity - see
    /// UpdateLabourSuggestion's doc comment on why a rate change means remove-and-re-add).</summary>
    [HttpDelete("labour-suggestions/{suggestionId:guid}")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> DeleteLabourSuggestion(Guid suggestionId)
    {
        var suggestion = await _db.JobCardLabourSuggestions.FirstOrDefaultAsync(s => s.Id == suggestionId);
        if (suggestion is null) return NotFound();
        _db.JobCardLabourSuggestions.Remove(suggestion);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Removed." });
    }

    // ---------------- Wizard vehicle lookup (2026-09-25, off BAPLDMSvad, onto Vehicle Sale) ----------------
    /// <summary>GET /api/jobcards/vehicle-lookup?value=&dealerId= - replaces the wizard's previous
    /// GET /api/bapl-dms/vehicle-lookup (BAPLDMSvad, the live job-card DMS this controller stopped
    /// writing to on 2026-09-24 - see Create's own doc comment). Looks the entered chassis no. or
    /// reg. no. up in BaplConnection's DMS_SaleBill/DMS_SaleBillCustomer instead (the same source
    /// backing the "Vehicle Sale" sidebar page - see DmsBaplDataService.GetVehicleSalesAsync's
    /// SECTION 95 migration notes), via IDmsBaplDataService.LookupVehicleForWizardAsync.
    ///
    /// dealerId is optional and, when given, is translated to that Dealer's BaplDmsDealerCode and
    /// used to scope the match to sales billed under that dealer - same dealer-code convention
    /// GetVehicleSalesAsync/Create already use elsewhere in this file (see e.g. dealerBaplCode
    /// above). Without a match, the wizard falls back to manual entry - this endpoint returning 404
    /// is an expected, non-error outcome for a vehicle this dealer never sold (or hasn't been billed
    /// yet).
    ///
    /// "already has an open job card" is now a LOCAL-ONLY check against this app's own JobCardScannerDb
    /// (matching by VIN, i.e. chassis no., against this dealer's own not-yet-closed job cards) -
    /// there is no live DMS signal for this any more since DMS write-back was removed; a job card
    /// opened in a DIFFERENT dealer's DMS for the same chassis (if any) cannot be detected here.
    /// openJobCardSource is always "local" (never a DMS-sourced value) when present, kept as an
    /// explicit field so the frontend doesn't need to guess.</summary>
    [HttpGet("vehicle-lookup")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> VehicleLookupForWizard([FromQuery] string? value, [FromQuery] Guid? dealerId)
    {
        if (string.IsNullOrWhiteSpace(value)) return BadRequest(new { message = "value is required." });

        string? dealerCode = null;
        if (dealerId.HasValue)
        {
            dealerCode = await _db.Dealers.AsNoTracking()
                .Where(d => d.Id == dealerId)
                .Select(d => d.BaplDmsDealerCode)
                .FirstOrDefaultAsync();
        }

        DmsBaplDataVehicleSaleRow? hit;
        try
        {
            hit = await _dmsBaplData.LookupVehicleForWizardAsync(value.Trim(), dealerCode, HttpContext.RequestAborted);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Vehicle lookup for wizard failed for value {Value}, dealerId {DealerId}", value, dealerId);
            return StatusCode(502, new { message = ex.Message });
        }

        if (hit is null) return NotFound(new { message = $"\"{value}\" wasn't found in Vehicle Sale." });

        string? openJobCardNumber = null;
        string? openJobCardStatus = null;
        if (dealerId.HasValue && !string.IsNullOrWhiteSpace(hit.ChassisNo))
        {
            var openJc = await _db.JobCards.AsNoTracking()
                .Where(j => j.DealerId == dealerId && j.Status != JobCardStatus.Closed)
                .Where(j => j.Vehicle != null && j.Vehicle.Vin == hit.ChassisNo)
                .Select(j => new { j.JobCardNumber, j.Status })
                .FirstOrDefaultAsync();
            if (openJc is not null)
            {
                openJobCardNumber = openJc.JobCardNumber;
                openJobCardStatus = openJc.Status.ToString();
            }
        }

        return Ok(new
        {
            chassisNo = hit.ChassisNo,
            registerNo = hit.RegNo,
            modelName = hit.ItemModel ?? hit.Oemmodel,
            locationCode = hit.LocCode,
            dealerCode = hit.DealerCode,
            saleDate = hit.InvoiceDate,
            motorNo = hit.MotorNo,
            controllerNo = hit.ControllerNo,
            converterNo = hit.Converter,
            chargerNumber = hit.ChargerNo,
            batteryNumber = hit.Battery,
            batteryChemical = hit.BatteryChemical,
            batteryCapacity = hit.BatteryCapacity,
            batteryMake = hit.BatteryMake,
            customerName = hit.SoldTo,
            customerMobile = hit.CusMob,
            customerEmail = hit.PartyEmail,
            customerCity = hit.City,
            customerAddress = string.Join(", ", new[] { hit.Address1, hit.Address2 }.Where(s => !string.IsNullOrWhiteSpace(s))),
            openJobCardNumber,
            openJobCardSource = openJobCardNumber != null ? "local" : null,
            openJobCardStatus,
        });
    }

    /// <summary>GET /api/jobcards/vehicle-suggestions?q=&dealerId= - replaces the wizard's previous
    /// GET /api/bapl-dms/vehicle-suggestions (BAPLDMSvad) typeahead. Sourced from the same
    /// BaplConnection/DMS_SaleBill data as VehicleLookupForWizard above, via
    /// IDmsBaplDataService.SearchVehiclesForWizardAsync (2-char minimum, capped at 100 results -
    /// raised from 20 on 2026-09-28, "too less shown shown all chassisno. for this location" -
    /// the service's own clamp was silently resetting any value above 50 back down to 20 regardless
    /// of what was passed here, which was the confirmed root cause; see that method's own doc
    /// comment for the exact matching rule against chassis_no/reg_number and for a flagged, still-
    /// unconfirmed possibility that a specific dealer login could ALSO be affected by a separate
    /// dealerId -> BaplDmsDealerCode scoping issue below, not just this cap).
    /// dealerId is optional, translated to BaplDmsDealerCode the same way as VehicleLookupForWizard.</summary>
    [HttpGet("vehicle-suggestions")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> VehicleSuggestionsForWizard([FromQuery] string? q, [FromQuery] Guid? dealerId)
    {
        string? dealerCode = null;
        if (dealerId.HasValue)
        {
            dealerCode = await _db.Dealers.AsNoTracking()
                .Where(d => d.Id == dealerId)
                .Select(d => d.BaplDmsDealerCode)
                .FirstOrDefaultAsync();
        }

        try
        {
            var hits = await _dmsBaplData.SearchVehiclesForWizardAsync(q, dealerCode, 100, HttpContext.RequestAborted);
            return Ok(hits.Select(h => new { chassisNo = h.ChassisNo, regNo = h.RegNo, modelName = h.ModelName, saleDate = h.SaleDate }));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Vehicle suggestions for wizard failed for q {Q}, dealerId {DealerId}", q, dealerId);
            return StatusCode(502, new { message = ex.Message });
        }
    }
}
