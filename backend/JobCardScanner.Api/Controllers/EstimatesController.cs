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

/// <summary>Additional-work (over-and-above) estimate approval flow: a Service Advisor drafts
/// an estimate, sends it to the customer (SMS + portal link), and the customer approves or
/// rejects it from the tracking portal after verifying an OTP sent to their mobile.</summary>
[ApiController]
[Route("api")]
public class EstimatesController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IJobCardNumberingService _numbering;
    private readonly INotificationClient _notifications;
    private readonly IOtpService _otp;
    private readonly IAuditLogService _audit;

    public EstimatesController(JobCardScannerDbContext db, ICurrentUserService currentUser, IJobCardNumberingService numbering, INotificationClient notifications, IOtpService otp, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _numbering = numbering;
        _notifications = notifications;
        _otp = otp;
        _audit = audit;
    }

    [HttpPost("jobcards/{jobCardId:guid}/estimates")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> Create(Guid jobCardId, CreateEstimateRequest req)
    {
        var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == jobCardId);
        if (jc is null) return NotFound();

        var estimate = new Estimate
        {
            JobCardId = jobCardId,
            EstimateNumber = await _numbering.NextEstimateNumberAsync(jc.DealerId),
            Reason = req.Reason,
            CreatedById = _currentUser.UserId,
            Status = EstimateStatus.Draft,
        };
        foreach (var l in req.Lines)
        {
            var amount = (decimal)l.Quantity * l.UnitPrice;
            estimate.Lines.Add(new EstimateLine { Type = l.Type, Description = l.Description, PartId = l.PartId, Quantity = l.Quantity, UnitPrice = l.UnitPrice, Amount = amount });
        }
        estimate.TotalAmount = estimate.Lines.Sum(l => l.Amount);

        _db.Estimates.Add(estimate);
        jc.Status = JobCardStatus.PendingCustomerApproval;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Estimate.Create", "Estimate", estimate.Id.ToString(), new { estimate.TotalAmount });

        return Ok(estimate);
    }

    [HttpPost("estimates/{id:guid}/send")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> SendToCustomer(Guid id)
    {
        var estimate = await _db.Estimates.Include(e => e.JobCard).ThenInclude(j => j!.Customer).FirstOrDefaultAsync(e => e.Id == id);
        if (estimate?.JobCard?.Customer is null) return NotFound();

        estimate.Status = EstimateStatus.PendingCustomerApproval;
        estimate.SentToCustomerAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _notifications.SendAsync(NotificationChannel.Sms, estimate.JobCard.Customer.Mobile,
            $"Additional work of Rs.{estimate.TotalAmount:N2} found for job card {estimate.JobCard.JobCardNumber}. Review & approve: /track/{estimate.JobCard.TrackingToken}",
            templateKey: "EstimateReady", jobCardId: estimate.JobCardId, customerId: estimate.JobCard.CustomerId);

        return Ok(new { estimate.Id, estimate.Status });
    }

    /// <summary>Staff-side view of an estimate (e.g. to check its approval status).</summary>
    [HttpGet("estimates/{id:guid}")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<IActionResult> Get(Guid id)
    {
        var estimate = await _db.Estimates.AsNoTracking().Include(e => e.Lines).FirstOrDefaultAsync(e => e.Id == id);
        return estimate is null ? NotFound() : Ok(estimate);
    }

    // ---------------- Customer portal: OTP-gated approve/reject ----------------

    [HttpPost("estimates/{id:guid}/otp")]
    [Authorize(Policy = Policies.Customer)]
    public async Task<IActionResult> IssueApprovalOtp(Guid id)
    {
        var estimate = await _db.Estimates.Include(e => e.JobCard).ThenInclude(j => j!.Customer).FirstOrDefaultAsync(e => e.Id == id);
        if (estimate?.JobCard?.Customer is null) return NotFound();
        if (estimate.JobCard.CustomerId != _currentUser.CustomerId) return Forbid();

        var result = await _otp.IssueOtpAsync(OtpPurpose.EstimateApproval, estimate.JobCard.Customer.Mobile, estimate.JobCardId, estimate.Id, email: estimate.JobCard.Customer.Email);
        return Ok(new OtpIssueResponse(result.RequestId, estimate.JobCard.Customer.Mobile, "OTP sent to your registered mobile.", result.DevCode));
    }

    [HttpPost("estimates/{id:guid}/approve")]
    [Authorize(Policy = Policies.Customer)]
    public Task<IActionResult> Approve(Guid id, OtpVerifyRequest req) => RespondAsync(id, req, approve: true);

    [HttpPost("estimates/{id:guid}/reject")]
    [Authorize(Policy = Policies.Customer)]
    public Task<IActionResult> Reject(Guid id, OtpVerifyRequest req) => RespondAsync(id, req, approve: false);

    private async Task<IActionResult> RespondAsync(Guid id, OtpVerifyRequest req, bool approve)
    {
        var estimate = await _db.Estimates.Include(e => e.JobCard).FirstOrDefaultAsync(e => e.Id == id);
        if (estimate?.JobCard is null) return NotFound();
        if (estimate.JobCard.CustomerId != _currentUser.CustomerId) return Forbid();

        if (!await _otp.VerifyOtpAsync(req.OtpRequestId, req.Code))
            return BadRequest(new { message = "Invalid or expired OTP." });

        estimate.OtpVerified = true;
        estimate.RespondedAt = DateTime.UtcNow;
        estimate.Status = approve ? EstimateStatus.Approved : EstimateStatus.Rejected;
        // Either way the customer has responded, so the workshop can resume work - on approval
        // with the extra scope included, on rejection with just the originally-agreed work.
        estimate.JobCard.Status = JobCardStatus.InProgress;
        await _db.SaveChangesAsync();

        return Ok(new { estimate.Id, estimate.Status });
    }
}