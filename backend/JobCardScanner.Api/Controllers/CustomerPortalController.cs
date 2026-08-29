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

/// <summary>
/// The customer-facing side of the app: mobile+OTP login (no Azure AD - customers are not
/// staff), the real-time job-status tracking link/QR code (public, read-only), and the
/// customer's own job card list once logged in.
/// </summary>
[ApiController]
[Route("api/portal")]
public class CustomerPortalController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly IOtpService _otp;
    private readonly ICustomerTokenService _tokens;

    public CustomerPortalController(JobCardScannerDbContext db, IOtpService otp, ICustomerTokenService tokens)
    {
        _db = db;
        _otp = otp;
        _tokens = tokens;
    }

    [HttpPost("otp/request")]
    public async Task<IActionResult> RequestOtp(CustomerOtpRequestDto req)
    {
        var customer = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Mobile == req.Mobile);
        if (customer is null) return NotFound(new { message = "No account found for this mobile number." });

        var result = await _otp.IssueOtpAsync(OtpPurpose.CustomerPortalLogin, req.Mobile, email: customer.Email);
        return Ok(new OtpIssueResponse(result.RequestId, req.Mobile, "OTP sent to your mobile.", result.DevCode));
    }

    [HttpPost("otp/verify")]
    public async Task<IActionResult> VerifyOtp(CustomerOtpVerifyRequest req)
    {
        if (!await _otp.VerifyOtpAsync(req.OtpRequestId, req.Code))
            return BadRequest(new { message = "Invalid or expired OTP." });

        var customer = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Mobile == req.Mobile);
        if (customer is null) return NotFound();

        var token = _tokens.IssueToken(customer.Id, customer.Mobile);
        return Ok(new { accessToken = token, customerId = customer.Id, customer.Name });
    }

    /// <summary>Public read-only status view behind the unguessable tracking token embedded in
    /// the QR code/SMS link - no login required, mirrors a shipment-tracking page.</summary>
    [HttpGet("track/{token}")]
    [AllowAnonymous]
    public async Task<IActionResult> Track(string token)
    {
        var jc = await _db.JobCards.AsNoTracking()
            .Include(j => j.Vehicle).Include(j => j.CurrentStage)
            .Include(j => j.StageHistory).ThenInclude(h => h.Stage)
            .Include(j => j.Estimates).ThenInclude(e => e.Lines)
            .FirstOrDefaultAsync(j => j.TrackingToken == token);
        if (jc is null) return NotFound();

        // Full active stage list (global template + this dealer's own overrides, same merge as
        // WorkflowStagesController.List) so the customer's "Live Status" timeline can show every
        // stage the job card will pass through - not just the ones already reached - the same
        // way the staff Job Card detail page's Workflow Timeline does.
        var allStages = await _db.WorkflowStages.AsNoTracking()
            .Where(s => s.DealerId == null || s.DealerId == jc.DealerId)
            .ToListAsync();
        var stages = allStages
            .GroupBy(s => s.StageKey)
            .Select(g => g.OrderByDescending(s => s.DealerId.HasValue).First())
            .Where(s => s.Active)
            .OrderBy(s => s.Seq)
            .ToList();

        return Ok(new
        {
            jc.Id,
            jc.JobCardNumber,
            Status = jc.Status.ToString(),
            StageLabel = jc.CurrentStage?.Label,
            CurrentStageId = jc.CurrentStageId,
            Stages = stages,
            VehicleModel = jc.Vehicle?.Model,
            VehicleRegNo = jc.Vehicle?.RegNo,
            jc.ExpectedDeliveryAt,
            Timeline = jc.StageHistory.OrderBy(h => h.EnteredAt).Select(h => new { StageLabel = h.Stage?.Label, h.EnteredAt, h.ExitedAt }),
            PendingEstimates = jc.Estimates.Where(e => e.Status == EstimateStatus.PendingCustomerApproval),
        });
    }

    [HttpGet("me/jobcards")]
    [Authorize(Policy = Policies.Customer)]
    public async Task<IActionResult> MyJobCards([FromServices] ICurrentUserService currentUser)
    {
        var jobCards = await _db.JobCards.AsNoTracking()
            .Include(j => j.Vehicle).Include(j => j.CurrentStage)
            .Where(j => j.CustomerId == currentUser.CustomerId)
            .OrderByDescending(j => j.CreatedAt)
            .ToListAsync();

        return Ok(jobCards.Select(j => new
        {
            j.Id,
            j.JobCardNumber,
            Status = j.Status.ToString(),
            StageLabel = j.CurrentStage?.Label,
            VehicleModel = j.Vehicle?.Model,
            j.TrackingToken,
            j.CreatedAt,
            j.ExpectedDeliveryAt,
        }));
    }
}