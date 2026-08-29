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

    public JobCardsController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IJobCardNumberingService numbering,
        IErpClient erp, INotificationClient notifications, IOtpService otp, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _numbering = numbering;
        _erp = erp;
        _notifications = notifications;
        _otp = otp;
        _audit = audit;
    }

    // ---------------- List / search / global search ----------------
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? dealerId, [FromQuery] JobCardStatus? status, [FromQuery] Guid? technicianId, [FromQuery] string? q, [FromQuery] string? stageKey)
    {
        var query = _db.JobCards.AsNoTracking()
            .Include(j => j.Customer).Include(j => j.Vehicle).Include(j => j.CurrentStage)
            .Include(j => j.ServiceAdvisor).Include(j => j.AssignedTechnician)
            .AsQueryable();

        var effectiveDealerId = dealerId ?? (_currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin ? null : _currentUser.DealerId);
        if (effectiveDealerId.HasValue) query = query.Where(j => j.DealerId == effectiveDealerId);
        if (status.HasValue) query = query.Where(j => j.Status == status);
        if (technicianId.HasValue) query = query.Where(j => j.AssignedTechnicianId == technicianId);
        // Lets the Dealer Dashboard's Quick Links ("Waiting for Parts", "Ready for Pickup") deep-link
        // straight to the filtered list by workflow stage, not just by the coarser Status enum.
        if (!string.IsNullOrWhiteSpace(stageKey)) query = query.Where(j => j.CurrentStage!.StageKey == stageKey);
        if (!string.IsNullOrWhiteSpace(q))
            query = query.Where(j => j.JobCardNumber.Contains(q) || j.Customer!.Name.Contains(q) || j.Customer!.Mobile.Contains(q) || (j.Vehicle!.RegNo != null && j.Vehicle.RegNo.Contains(q)));

        var results = await query.OrderByDescending(j => j.CreatedAt).Take(200).ToListAsync();
        return Ok(results.Select(Summarize));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var jc = await FullQuery().FirstOrDefaultAsync(j => j.Id == id);
        return jc is null ? NotFound() : Ok(Detail(jc));
    }

    // ---------------- Job Card Opening Wizard: finalize ----------------
    [HttpPost]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> Create(CreateJobCardRequest req)
    {
        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.Id == req.VehicleId);
        if (vehicle is null) return BadRequest(new { message = "Vehicle not found." });

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

        if (req.AssignedTechnicianId.HasValue) jc.AssignedTechnicianId = req.AssignedTechnicianId;
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
        if (stage.IsTerminal && jc.Status != JobCardStatus.Closed) jc.Status = JobCardStatus.PendingClosure;

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
        var effectiveDealerId = dealerId ?? (_currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin ? null : _currentUser.DealerId);
        var q = _db.Users.AsNoTracking().Where(u => u.Role == StaffRole.Technician && u.Active);
        if (effectiveDealerId.HasValue) q = q.Where(u => u.DealerId == effectiveDealerId);

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
        .Include(j => j.Worklogs).Include(j => j.QcChecklistItems)
        .Include(j => j.Estimates).ThenInclude(e => e.Lines)
        .Include(j => j.Parts).ThenInclude(p => p.Part)
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
        TechnicianName = j.AssignedTechnician?.Name,
        j.CreatedAt,
        j.ExpectedDeliveryAt,
    };

    private static object Detail(JobCard j) => new
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
        Customer = j.Customer,
        Vehicle = j.Vehicle,
        Dealer = j.Dealer is null ? null : new { j.Dealer.Id, j.Dealer.Name, j.Dealer.Code },
        CurrentStage = j.CurrentStage,
        ServiceAdvisor = j.ServiceAdvisor is null ? null : new { j.ServiceAdvisor.Id, j.ServiceAdvisor.Name },
        AssignedTechnician = j.AssignedTechnician is null ? null : new { j.AssignedTechnician.Id, j.AssignedTechnician.Name },
        j.Complaints,
        j.Inspections,
        j.Photos,
        StageHistory = j.StageHistory.OrderBy(h => h.EnteredAt),
        j.Worklogs,
        j.QcChecklistItems,
        Estimates = j.Estimates,
        Parts = j.Parts,
        Invoice = j.Invoice,
    };
}