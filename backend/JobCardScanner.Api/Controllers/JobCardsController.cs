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

        Dictionary<string, decimal> availableQtyByCode = new(StringComparer.OrdinalIgnoreCase);
        if (_currentUser.DealerId.HasValue)
        {
            // locationCode narrows to one workshop when the job card has one; null/blank returns
            // this dealer's uploads across every location (see this method's doc comment above) -
            // summed per PartNo rather than a plain overwrite, since more than one location's row
            // can now match the same PartNo once locationCode isn't filtering them down to one.
            var uploads = await _partUploads.GetAsync(_currentUser.DealerId.Value, locationCode, null, HttpContext.RequestAborted);
            foreach (var u in uploads)
                if (!string.IsNullOrWhiteSpace(u.PartNo) && u.BalQty.HasValue)
                    availableQtyByCode[u.PartNo] = (availableQtyByCode.TryGetValue(u.PartNo, out var existing) ? existing : 0m) + u.BalQty.Value;
        }

        return Ok(items.Select(i => new
        {
            itemCode = i.ItemCode,
            description = i.DisplayName ?? i.ItemName,
            hsnCode = i.HsnCode,
            mrp = i.DlrPrice,
            sgst = i.Sgst,
            cgst = i.Cgst,
            igst = i.Igst,
            availableQty = availableQtyByCode.TryGetValue(i.ItemCode, out var qty) ? (int?)qty : null,
        }));
    }

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

        // Catch any local job card DMS has since closed/billed directly - see
        // SyncClosedFromDmsAsync's doc comment for the full story ("this is the biggest issue").
        await SyncClosedFromDmsAsync(results, HttpContext.RequestAborted);

        var localRows = results.Select(j => (SortKey: j.CreatedAt, Row: Summarize(j)));

        // ---------------- Blend in DMS's own job cards ----------------
        // Only when the filters in play are ones DMS rows can actually satisfy: status,
        // technicianId, and stageKey are all JobCardScanner-specific concepts (DMS's JobStatus
        // vocabulary - "Open", "Material Transfer", ... - doesn't map onto JobCardStatus, and BAPL
        // DMS has no concept of a JobCardScanner technician/stage at all), so any of those filters
        // being set means "only show me JobCardScanner's own job cards" rather than trying to guess
        // a mapping. q (job card #/customer/reg no.) and status-less/technician-less/stage-less
        // browsing both work fine against DMS too.
        var baplRows = Enumerable.Empty<(DateTime SortKey, object Row)>();
        string? baplDmsWarning = null;
        // Same reasoning as status/technicianId/stageKey above - every new dashboard filter is
        // also a JobCardScanner-specific concept DMS rows can't be evaluated against, so any
        // of them being set means "local job cards only".
        var anyDashboardFilterActive = excludeClosed == true || overdue == true || createdToday == true ||
            deliveredToday == true || closedThisMonth == true || warrantyOnly == true || pendingBucket == true;
        if (!status.HasValue && !technicianId.HasValue && string.IsNullOrWhiteSpace(stageKey) && !anyDashboardFilterActive)
        {
            string? baplDealerCode = null;
            var canSearchBapl = true;
            if (effectiveDealerId.HasValue)
            {
                baplDealerCode = await _db.Dealers.AsNoTracking().Where(d => d.Id == effectiveDealerId).Select(d => d.BaplDmsDealerCode).FirstOrDefaultAsync();
                // This dealer has no known DMS dealer code (never resolved via the Job Card
                // Wizard's dealer picker) - searching DMS unscoped would leak every other
                // dealer's job cards into this one dealer's list, so skip it entirely rather than
                // guess. Not an error - most dealers simply may not be linked yet.
                canSearchBapl = !string.IsNullOrWhiteSpace(baplDealerCode);
            }

            if (canSearchBapl)
            {
                try
                {
                    var hits = await _baplDms.SearchJobCardsAsync(q, baplDealerCode, 50, HttpContext.RequestAborted);
                    // Dedup against localRows: every JobCardScanner-created job card is ALSO a DMS
                    // job card (Create() now requires DMS success first - see 2026-09-05 comment
                    // above), so without this filter the same job card would show up twice - once
                    // as its native JobCardScanner row (from `results`/`localRows` above) and again
                    // as a "SummarizeBapl" read-only DMS row for the identical JobCardHeaderId. Only
                    // DMS job cards JobCardScanner has no local row for at all (opened directly in
                    // DMS, never created here) should appear as SummarizeBapl rows.
                    var localBaplHeaderIds = results.Where(j => j.BaplJobCardHeaderId.HasValue)
                        .Select(j => j.BaplJobCardHeaderId!.Value).ToHashSet();
                    baplRows = hits.Where(r => !localBaplHeaderIds.Contains(r.JobCardHeaderId)).Select(r => (
                        SortKey: r.JobInDate?.ToDateTime(TimeOnly.MinValue) ?? DateTime.MinValue,
                        Row: SummarizeBapl(r)));
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogWarning(ex, "Could not blend DMS job cards into the /jobcards list");
                    baplDmsWarning = "Could not reach DMS right now - showing JobCardScanner's own job cards only.";
                }
            }
        }

        var merged = localRows.Concat(baplRows).OrderByDescending(x => x.SortKey).Take(200).Select(x => x.Row).ToList();
        return Ok(new { items = merged, baplDmsWarning });
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
        await SyncClosedFromDmsAsync(new[] { jc }, HttpContext.RequestAborted);
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

        // 2026-09-05: dealer's DMS code is now resolved once, up front, and reused both for the
        // DMS open-job-card check below and for the mandatory DMS create further down - see this
        // method's new doc comment below for why DMS creation moved here and became mandatory.
        var dealerBaplCode = await _db.Dealers.AsNoTracking().Where(d => d.Id == req.DealerId).Select(d => d.BaplDmsDealerCode).FirstOrDefaultAsync();

        // Same check, but against DMS's own job cards - catches a job card opened directly in
        // DMS (outside JobCardScanner entirely), which the local-only check above can never
        // see. Best-effort: a DMS outage here should never block creating a job card locally,
        // it just means this particular safety check couldn't run this time. Deliberately read-only
        // - a DMS-only job card is never written into JobCardScanner's own database by this or
        // any other check; the local JobCards table only ever gets a row for a job card actually
        // created through this endpoint.
        if (!string.IsNullOrWhiteSpace(vehicle.Vin))
        {
            try
            {
                var openInDms = await _baplDms.GetOpenJobCardForChassisAsync(vehicle.Vin, dealerBaplCode);
                if (openInDms is not null)
                {
                    var dmsJobNumber = $"{openInDms.JobPrefix}{openInDms.JobNo}";
                    return BadRequest(new { message = $"This chassis already has an open job card in DMS ({dmsJobNumber}, status: {openInDms.JobStatus}). It must be closed there before a new job card can be created for it here." });
                }
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Could not check DMS for an open job card on chassis {ChassisNo} - proceeding without this check", vehicle.Vin);
            }
        }

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
        // Deliberately KEPT: the read-only "does DMS already show an open job card for this
        // chassis" check just above (GetOpenJobCardForChassisAsync) - that is a duplicate-work
        // safety READ, not a save, and dropping it would let the same vehicle be opened here while
        // it's still genuinely open in DMS, which is a real risk this app has no other way to catch
        // (DMS's job cards and JobCardScanner's are now two entirely separate, unlinked systems).
        // Flagged as an Interpretation - tell me if you'd rather this check go too, now that job
        // cards are otherwise fully decoupled from DMS.
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

        _db.JobCards.Add(jobCard);
        await _db.SaveChangesAsync();

        if (firstStage is not null)
            _db.JobCardStageHistories.Add(new JobCardStageHistory { JobCardId = jobCard.Id, StageId = firstStage.Id, ChangedById = _currentUser.UserId });
        vehicle.Odometer = Math.Max(vehicle.Odometer, req.OdometerAtCheckIn);
        await _db.SaveChangesAsync();

        await _erp.PushJobCardAsync(jobCard);
        await _audit.LogAsync("JobCard.Create", "JobCard", jobCard.Id.ToString(), new { jobCard.JobCardNumber });

        if (customer is not null)
            await _notifications.SendAsync(NotificationChannel.Sms, customer.Mobile,
                $"Hi {customer.Name}, your job card {jobCard.JobCardNumber} has been created. Track: /track/{jobCard.TrackingToken}",
                templateKey: "JobCardOpened", jobCardId: jobCard.Id, customerId: customer.Id);

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

        // ---------------- Best-effort write-back into DMS's own database ----------------
        // Only attempted when this job card actually synced into DMS (BaplJobCardHeaderId
        // set). The local save above has ALREADY completed and is never affected by anything below
        // - this is purely "also try to mirror the photo into DMS", mirroring the exact
        // non-blocking write-back pattern JobCardsController.Create() uses for the job card itself.
        if (jobCardForPhoto.BaplJobCardHeaderId.HasValue)
        {
            try
            {
                byte[] bytes;
                await using (var ms = new MemoryStream())
                {
                    await form.File.CopyToAsync(ms, HttpContext.RequestAborted);
                    bytes = ms.ToArray();
                }
                await _baplDms.SaveJobCardPhotoAsync(
                    jobCardForPhoto.BaplJobCardHeaderId.Value,
                    form.File.FileName ?? fileName,
                    form.File.ContentType,
                    form.Stage.ToString(),
                    form.Caption,
                    bytes,
                    HttpContext.RequestAborted);
            }
            catch (Exception ex)
            {
                // Never lets a DMS problem affect this already-successful upload response.
                _logger.LogWarning(ex, "Could not write job card photo {PhotoId} into DMS for job card {JobCardId}", photo.Id, id);
            }
        }

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
    /// IDmsBaplDataService.SearchVehiclesForWizardAsync (2-char minimum, capped at 20 results -
    /// see that method's own doc comment for the exact matching rule against chassis_no/reg_number).
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
            var hits = await _dmsBaplData.SearchVehiclesForWizardAsync(q, dealerCode, 20, HttpContext.RequestAborted);
            return Ok(hits.Select(h => new { chassisNo = h.ChassisNo, regNo = h.RegNo, modelName = h.ModelName, saleDate = h.SaleDate }));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Vehicle suggestions for wizard failed for q {Q}, dealerId {DealerId}", q, dealerId);
            return StatusCode(502, new { message = ex.Message });
        }
    }
}
