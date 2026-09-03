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
    private readonly ILogger<JobCardsController> _logger;

    public JobCardsController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IJobCardNumberingService numbering,
        IErpClient erp, INotificationClient notifications, IOtpService otp, IAuditLogService audit,
        IWebHostEnvironment env, IBaplDmsService baplDms, IInvoicePdfService invoicePdf, ILogger<JobCardsController> logger)
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
        _logger = logger;
    }

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
        var effectiveDealerId = isOrgWideRole ? dealerId : _currentUser.DealerId;
        if (status.HasValue) query = query.Where(j => j.Status == status);
        if (technicianId.HasValue) query = query.Where(j => j.AssignedTechnicianId == technicianId);
        // Lets the Dealer Dashboard's Quick Links ("Waiting for Parts", "Ready for Pickup") deep-link
        // straight to the filtered list by workflow stage, not just by the coarser Status enum.
        if (!string.IsNullOrWhiteSpace(stageKey)) query = query.Where(j => j.CurrentStage!.StageKey == stageKey);
        if (!string.IsNullOrWhiteSpace(q))
            query = query.Where(j => j.JobCardNumber.Contains(q) || j.Customer!.Name.Contains(q) || j.Customer!.Mobile.Contains(q) || (j.Vehicle!.RegNo != null && j.Vehicle.RegNo.Contains(q)));

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
        var localRows = results.Select(j => (SortKey: j.CreatedAt, Row: Summarize(j)));

        // ---------------- Blend in BAPL DMS's own job cards ----------------
        // Only when the filters in play are ones BAPL DMS rows can actually satisfy: status,
        // technicianId, and stageKey are all JobCardScanner-specific concepts (BAPL DMS's JobStatus
        // vocabulary - "Open", "Material Transfer", ... - doesn't map onto JobCardStatus, and BAPL
        // DMS has no concept of a JobCardScanner technician/stage at all), so any of those filters
        // being set means "only show me JobCardScanner's own job cards" rather than trying to guess
        // a mapping. q (job card #/customer/reg no.) and status-less/technician-less/stage-less
        // browsing both work fine against BAPL DMS too.
        var baplRows = Enumerable.Empty<(DateTime SortKey, object Row)>();
        string? baplDmsWarning = null;
        // Same reasoning as status/technicianId/stageKey above - every new dashboard filter is
        // also a JobCardScanner-specific concept BAPL DMS rows can't be evaluated against, so any
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
                // This dealer has no known BAPL DMS dealer code (never resolved via the Job Card
                // Wizard's dealer picker) - searching BAPL DMS unscoped would leak every other
                // dealer's job cards into this one dealer's list, so skip it entirely rather than
                // guess. Not an error - most dealers simply may not be linked yet.
                canSearchBapl = !string.IsNullOrWhiteSpace(baplDealerCode);
            }

            if (canSearchBapl)
            {
                try
                {
                    var hits = await _baplDms.SearchJobCardsAsync(q, baplDealerCode, 50, HttpContext.RequestAborted);
                    baplRows = hits.Select(r => (
                        SortKey: r.JobInDate?.ToDateTime(TimeOnly.MinValue) ?? DateTime.MinValue,
                        Row: SummarizeBapl(r)));
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogWarning(ex, "Could not blend BAPL DMS job cards into the /jobcards list");
                    baplDmsWarning = "Could not reach BAPL DMS right now - showing JobCardScanner's own job cards only.";
                }
            }
        }

        var merged = localRows.Concat(baplRows).OrderByDescending(x => x.SortKey).Take(200).Select(x => x.Row).ToList();
        return Ok(new { items = merged, baplDmsWarning });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var jc = await FullQuery().FirstOrDefaultAsync(j => j.Id == id);
        return jc is null ? NotFound() : Ok(Detail(jc));
    }

    /// <summary>
    /// GET /api/jobcards/{id}/invoice-pdf - "Download Invoice from DMS": renders BAPL DMS's own
    /// repair bill (RepairBillHeader/RepairBillDetail, read live) for this job card as a GST tax
    /// invoice PDF matching BAPL DMS's own layout - see IInvoicePdfService.BuildInvoicePdfAsync.
    /// Same [Authorize(Policy = Policies.Staff)] as this controller's other GET endpoints (Get()
    /// above, List()) - no stricter policy needed, viewing an invoice PDF isn't a more sensitive
    /// operation than viewing the job card itself. 404 covers both "no such job card" and "nothing
    /// to download yet" (never synced to BAPL DMS, or synced but no repair bill raised there yet) -
    /// both are normal, everyday states, not errors. A real BAPL DMS problem (bad connection/schema
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
            _logger.LogWarning(ex, "Could not build the BAPL DMS invoice PDF for job card {JobCardId}", id);
            return StatusCode(502, new { message = ex.Message });
        }
        if (bytes is null) return NotFound();

        var jobCardNumber = await _db.JobCards.AsNoTracking().Where(j => j.Id == id).Select(j => j.JobCardNumber).FirstOrDefaultAsync();
        var fileNamePart = string.IsNullOrWhiteSpace(jobCardNumber) ? id.ToString() : jobCardNumber;
        return File(bytes, "application/pdf", $"invoice-{fileNamePart}.pdf");
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

        // Same check, but against BAPL DMS's own job cards - catches a job card opened directly in
        // BAPL DMS (outside JobCardScanner entirely), which the local-only check above can never
        // see. Best-effort: a BAPL DMS outage here should never block creating a job card locally,
        // it just means this particular safety check couldn't run this time. Deliberately read-only
        // - a BAPL DMS-only job card is never written into JobCardScanner's own database by this or
        // any other check; the local JobCards table only ever gets a row for a job card actually
        // created through this endpoint.
        if (!string.IsNullOrWhiteSpace(vehicle.Vin))
        {
            try
            {
                var dealerBaplCode = await _db.Dealers.AsNoTracking().Where(d => d.Id == req.DealerId).Select(d => d.BaplDmsDealerCode).FirstOrDefaultAsync();
                var openInDms = await _baplDms.GetOpenJobCardForChassisAsync(vehicle.Vin, dealerBaplCode);
                if (openInDms is not null)
                {
                    var dmsJobNumber = $"{openInDms.JobPrefix}{openInDms.JobNo}";
                    return BadRequest(new { message = $"This chassis already has an open job card in BAPL DMS ({dmsJobNumber}, status: {openInDms.JobStatus}). It must be closed there before a new job card can be created for it here." });
                }
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Could not check BAPL DMS for an open job card on chassis {ChassisNo} - proceeding without this check", vehicle.Vin);
            }
        }

        var firstStage = await _db.WorkflowStages.AsNoTracking()
            .Where(s => (s.DealerId == null || s.DealerId == req.DealerId) && s.Active)
            .OrderBy(s => s.Seq).FirstOrDefaultAsync();

        var jobCard = new JobCard
        {
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

        var customer = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == req.CustomerId);
        if (customer is not null)
            await _notifications.SendAsync(NotificationChannel.Sms, customer.Mobile,
                $"Hi {customer.Name}, your job card {jobCard.JobCardNumber} has been created. Track: /track/{jobCard.TrackingToken}",
                templateKey: "JobCardOpened", jobCardId: jobCard.Id, customerId: customer.Id);

        // ---------------- Best-effort write-back into BAPL DMS's own database ----------------
        // Only attempted when there's actually somewhere to write to (this dealer has a resolved
        // BaplDmsDealerCode) and the wizard captured the full JobType/ServiceHead/ServiceType
        // cascade a BAPL DMS JobCardHeader row requires. A failure here NEVER rolls back or fails
        // this request - the local job card above is already committed and is the source of truth;
        // this is purely "also try to mirror it into BAPL DMS", surfaced as baplSyncWarning on an
        // otherwise-200 response so the wizard can tell the user without blocking them.
        string? baplSyncWarning = null;
        if (req.BaplJobTypeId.HasValue && req.BaplServiceHeadId.HasValue && req.BaplServiceTypeId.HasValue)
        {
            var baplDealerCode = await _db.Dealers.AsNoTracking().Where(d => d.Id == req.DealerId).Select(d => d.BaplDmsDealerCode).FirstOrDefaultAsync();
            if (!string.IsNullOrWhiteSpace(baplDealerCode))
            {
                try
                {
                    var result = await _baplDms.CreateJobCardAsync(new BaplDmsCreateJobCardRequest(
                        DealerCode: baplDealerCode,
                        JobTypeId: req.BaplJobTypeId.Value,
                        ServiceHeadId: req.BaplServiceHeadId.Value,
                        ServiceHeadName: req.BaplServiceHeadName ?? "",
                        ServiceTypeId: req.BaplServiceTypeId.Value,
                        ServiceTypeName: req.BaplServiceTypeName ?? "",
                        ServiceLocationCode: req.BaplServiceLocationCode,
                        ChassisNo: vehicle.Vin ?? "",
                        RegisterNo: vehicle.RegNo,
                        ModelName: vehicle.Model,
                        VehicleKms: (int)req.OdometerAtCheckIn,
                        Supervisor: req.BaplSupervisorName,
                        Technician: req.BaplTechnicianName,
                        ManualJobNo: req.BaplManualJobNo,
                        CustomerName: customer?.Name,
                        CustomerMobile: customer?.Mobile,
                        CustomerLedgerId: req.BaplCustomerLedgerId,
                        MotorNo: vehicle.MotorNo,
                        BatteryNo: vehicle.BatteryNo,
                        ControllerNo: vehicle.ControllerNo,
                        ConverterNo: vehicle.ConverterNo,
                        ChargerNo: vehicle.ChargerNo,
                        SaleDate: null,
                        InsuranceExpDate: vehicle.InsuranceExpiry,
                        NextServiceDueDate: vehicle.NextServiceDueDate,
                        ExpectedDeliveryAt: req.ExpectedDeliveryAt,
                        Complaints: req.Complaints.Select(c => c.Description).ToList(),
                        CreatedBy: $"JobCardScanner:{_currentUser.UserId}",
                        JobSourceId: req.BaplJobSourceId,
                        Priority: req.Priority.ToString()),
                        HttpContext.RequestAborted);

                    jobCard.BaplJobCardHeaderId = result.JobCardHeaderId;
                    // BAPL DMS's own Job Card List shows this JobNo (e.g. "22"), not the internal
                    // JobCardHeaderId (e.g. "70") - kept separate so the Detail page can show staff
                    // the number they actually recognize from BAPL DMS's own screen.
                    jobCard.BaplJobNo = result.JobNo;
                    jobCard.BaplSyncStatus = "Synced";
                    jobCard.BaplSyncError = null;
                    await _db.SaveChangesAsync();
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogWarning(ex, "Could not sync job card {JobCardId} into BAPL DMS", jobCard.Id);
                    jobCard.BaplSyncStatus = "Failed";
                    jobCard.BaplSyncError = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
                    await _db.SaveChangesAsync();
                    baplSyncWarning = $"Job card {jobCard.JobCardNumber} was created, but syncing it into BAPL DMS's own database failed: {ex.Message}";
                }
            }
        }

        var full = await FullQuery().FirstAsync(j => j.Id == jobCard.Id);
        return CreatedAtAction(nameof(Get), new { id = jobCard.Id }, Detail(full, baplSyncWarning));
    }

    // ---------------- Assignment / priority / ETA ----------------
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Update(Guid id, UpdateJobCardRequest req)
    {
        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();

        if (req.AssignedTechnicianId.HasValue) jc.AssignedTechnicianId = req.AssignedTechnicianId;
        // Free-text technician name (see JobCard.AssignedTechnicianName's doc comment) - the Job
        // Card Detail page's "Assign Technician" field types a name directly rather than picking
        // from a User dropdown, since there's no confirmed technician catalog to populate one from.
        if (req.AssignedTechnicianName is not null) jc.AssignedTechnicianName = string.IsNullOrWhiteSpace(req.AssignedTechnicianName) ? null : req.AssignedTechnicianName.Trim();
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
        if (!AllowedPhotoContentTypes.Contains(form.File.ContentType, StringComparer.OrdinalIgnoreCase))
            return BadRequest(new { message = $"Unsupported file type '{form.File.ContentType}'. Upload a photo (JPEG, PNG, WEBP, or HEIC)." });

        var ext = Path.GetExtension(form.File.FileName);
        if (string.IsNullOrWhiteSpace(ext) || ext.Length > 10) ext = ".jpg";
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
            UploadedById = _currentUser.UserId,
        };
        _db.JobCardPhotos.Add(photo);
        await _db.SaveChangesAsync();

        // ---------------- Best-effort write-back into BAPL DMS's own database ----------------
        // Only attempted when this job card actually synced into BAPL DMS (BaplJobCardHeaderId
        // set). The local save above has ALREADY completed and is never affected by anything below
        // - this is purely "also try to mirror the photo into BAPL DMS", mirroring the exact
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
                // Never lets a BAPL DMS problem affect this already-successful upload response.
                _logger.LogWarning(ex, "Could not write job card photo {PhotoId} into BAPL DMS for job card {JobCardId}", photo.Id, id);
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

    /// <summary>Shapes a BAPL DMS job card row (see BaplDmsService.SearchJobCardsAsync) into the
    /// same field names as Summarize() above so the /jobcards list page can render both kinds of
    /// row through one table - Source distinguishes them (BaplDms rows have no JobCardScanner Id,
    /// so the frontend must not try to link to a Job Card Detail page for one). Fields
    /// JobCardScanner tracks but BAPL DMS's own job card doesn't (ServiceType/Priority/StageLabel/
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
        // Suggestion panel can scope its BAPL DMS LabourMaster search by this job card's own
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
        // 2026-09-03: this job card's own dealer, resolved to BAPL DMS's own dealer code (distinct
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
    /// <summary>POST /api/jobcards/{id}/part-suggestions - saves one BAPL DMS PartsInventory item
    /// suggested for this job card, with a Paid/U-W status tracked only in JobCardScannerDb (see
    /// JobCardPartSuggestion's doc comment - this does not write anything back into BAPL DMS).</summary>
    [HttpPost("{id:guid}/part-suggestions")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> AddPartSuggestion(Guid id, AddPartSuggestionRequest req)
    {
        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();
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
    /// <summary>POST /api/jobcards/{id}/labour-suggestions - saves one BAPL DMS LabourMaster line
    /// suggested for this job card. Snapshots Description/HSN/GST/Rate from the request as picked
    /// on the frontend (same trust level as AddPartSuggestion's AvailableQtyAtSuggestion - this is
    /// JobCardScanner-only history/reporting, not re-verified against BAPL DMS server-side) - see
    /// JobCardLabourSuggestion's doc comment. Does not write anything back into BAPL DMS.</summary>
    [HttpPost("{id:guid}/labour-suggestions")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> AddLabourSuggestion(Guid id, AddLabourSuggestionRequest req)
    {
        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == id);
        if (jc is null) return NotFound();
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
}
