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
/// staff), the new password login below (added alongside OTP, not a replacement - see Login's
/// doc comment), the real-time job-status tracking link/QR code (public, read-only), and the
/// customer's own job card list once logged in.
/// </summary>
[ApiController]
[Route("api/portal")]
public class CustomerPortalController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly IOtpService _otp;
    private readonly ICustomerTokenService _tokens;
    private readonly IWebHostEnvironment _env;
    private readonly IAuditLogService _audit;
    private readonly ILogger<CustomerPortalController> _logger;

    public CustomerPortalController(
        JobCardScannerDbContext db, IOtpService otp, ICustomerTokenService tokens,
        IWebHostEnvironment env, IAuditLogService audit, ILogger<CustomerPortalController> logger)
    {
        _db = db;
        _otp = otp;
        _tokens = tokens;
        _env = env;
        _audit = audit;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/portal/login - mobile/email + password sign-in for a customer, alongside (NOT
    /// replacing) the existing OTP flow above. A customer who never set a password (PasswordHash
    /// is null - the normal state for anyone who has only ever used OTP) gets a clear "set up
    /// password login first" message rather than a generic "invalid credentials", since there's
    /// nothing wrong with their password - they just don't have one yet. Issues the exact same
    /// JWT shape as VerifyOtp above (via the same ICustomerTokenService), so every existing
    /// customer-scoped endpoint (GET /api/portal/me/jobcards, Policies.Customer) works unchanged
    /// regardless of which login path was used.
    /// </summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login(CustomerLoginRequest req)
    {
        var identifier = req.MobileOrEmail.Trim();
        var customer = await _db.Customers.FirstOrDefaultAsync(c =>
            c.Mobile == identifier || (c.Email != null && c.Email.ToLower() == identifier.ToLower()));

        if (customer is null)
            return Unauthorized(new { message = "Invalid mobile/email or password." });
        if (string.IsNullOrWhiteSpace(customer.PasswordHash))
            return Unauthorized(new { message = "Password login isn't set up for this account yet - use the OTP option below, or ask your dealer to set a password for you.", passwordNotSet = true });
        if (!PasswordHasher.Verify(req.Password, customer.PasswordHash))
            return Unauthorized(new { message = "Invalid mobile/email or password." });

        var token = _tokens.IssueToken(customer.Id, customer.Mobile);
        return Ok(new { accessToken = token, customerId = customer.Id, customer.Name });
    }

    /// <summary>POST /api/portal/forgot-password - issues a one-hour reset token, mirrors
    /// DealerAuthController.ForgotPassword exactly (dev-only raw token in the response, never
    /// reveals whether the account exists).</summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    public async Task<IActionResult> ForgotPassword(CustomerForgotPasswordRequest req)
    {
        var identifier = req.MobileOrEmail.Trim();
        var customer = await _db.Customers.FirstOrDefaultAsync(c =>
            c.Mobile == identifier || (c.Email != null && c.Email.ToLower() == identifier.ToLower()));

        if (customer is null)
            return Ok(new { message = "If that mobile number or email has an account, a reset link has been sent." });

        var (rawToken, tokenHash) = PasswordHasher.GenerateResetToken();
        customer.PasswordResetTokenHash = tokenHash;
        customer.PasswordResetExpiresAt = DateTime.UtcNow.AddHours(1);
        await _db.SaveChangesAsync();

        // TODO before production: send `rawToken` via SMS/email instead of returning it here -
        // same gap as DealerAuthController.ForgotPassword (no provider wired in yet).
        var response = new { message = "If that mobile number or email has an account, a reset link has been sent." };
        if (_env.IsDevelopment())
            return Ok(new { response.message, devResetToken = rawToken, devNote = "Only returned in Development - wire a real SMS/email provider before production." });
        return Ok(response);
    }

    /// <summary>POST /api/portal/reset-password - completes a forgot-password reset, or sets a
    /// FIRST password for a customer who's only ever used OTP (same token flow either way - a
    /// customer with no PasswordHash yet can still request a reset token via ForgotPassword above
    /// and use it here to set one for the first time).</summary>
    [HttpPost("reset-password")]
    [AllowAnonymous]
    public async Task<IActionResult> ResetPassword(CustomerResetPasswordRequest req)
    {
        var identifier = req.MobileOrEmail.Trim();
        var tokenHash = PasswordHasher.HashResetToken(req.Token);
        var customer = await _db.Customers.FirstOrDefaultAsync(c =>
            (c.Mobile == identifier || (c.Email != null && c.Email.ToLower() == identifier.ToLower())) &&
            c.PasswordResetTokenHash == tokenHash);

        if (customer is null || customer.PasswordResetExpiresAt is null || customer.PasswordResetExpiresAt < DateTime.UtcNow)
            return BadRequest(new { message = "This reset link is invalid or has expired. Request a new one." });

        customer.PasswordHash = PasswordHasher.Hash(req.NewPassword);
        customer.PasswordResetTokenHash = null;
        customer.PasswordResetExpiresAt = null;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("CustomerPortal.ResetPassword", "Customer", customer.Id.ToString());

        return Ok(new { message = "Password updated. You can sign in now." });
    }

    /// <summary>PATCH /api/portal/change-password - a signed-in customer changing their own
    /// password. Only reachable once a password already exists (Login above is what a customer
    /// who's never set one uses ForgotPassword/ResetPassword for instead) - CurrentPassword must
    /// verify against it either way.</summary>
    [HttpPatch("change-password")]
    [Authorize(Policy = Policies.Customer)]
    public async Task<IActionResult> ChangePassword(CustomerChangePasswordRequest req, [FromServices] ICurrentUserService currentUser)
    {
        if (currentUser.CustomerId is null) return Forbid();
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == currentUser.CustomerId);
        if (customer is null) return NotFound();

        if (!PasswordHasher.Verify(req.CurrentPassword, customer.PasswordHash))
            return BadRequest(new { message = "Current password is incorrect." });

        customer.PasswordHash = PasswordHasher.Hash(req.NewPassword);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("CustomerPortal.ChangePassword", "Customer", customer.Id.ToString());

        return Ok(new { message = "Password changed." });
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
