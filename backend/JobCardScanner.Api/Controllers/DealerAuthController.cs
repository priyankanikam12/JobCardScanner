using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Local email+password sign-in for dealer/workshop staff who don't have an Azure AD account
/// in the tenant (see Models/MasterData.cs UserAuthType, and Auth/AuthSchemes.DealerJwt). This
/// is the "Dealer / Workshop Login" tab on the web LoginPage, alongside the existing
/// "Continue with Microsoft" (Azure AD) tab used by corporate/system admins - see
/// Controllers/AuthController.cs for the Azure AD side.
///
/// There is no email/SMS provider wired into this build (same as the customer-portal OTP flow
/// in Services/Integrations/MockNotificationClient.cs), so ForgotPassword returns the reset
/// token directly in the response when running in Development, so it can be exercised end to
/// end without a real mail server. Before production, wire SendResetEmail below into a real
/// provider (or into INotificationClient) and stop returning the token in the response body.
/// </summary>
[ApiController]
[Route("api/dealer-auth")]
public class DealerAuthController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly IDealerJwtTokenService _tokenService;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;
    private readonly IWebHostEnvironment _env;
    private readonly IBaplDmsService _baplDms;
    private readonly ILogger<DealerAuthController> _logger;

    public DealerAuthController(
        JobCardScannerDbContext db,
        IDealerJwtTokenService tokenService,
        ICurrentUserService currentUser,
        IAuditLogService audit,
        IWebHostEnvironment env,
        IBaplDmsService baplDms,
        ILogger<DealerAuthController> logger)
    {
        _db = db;
        _tokenService = tokenService;
        _currentUser = currentUser;
        _audit = audit;
        _env = env;
        _baplDms = baplDms;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/dealer-auth/login - email + password sign-in for local staff. Tries
    /// JobCardScanner's own local Users table FIRST (exactly as before, unchanged) - only when
    /// that fails (no such local user, or the password doesn't verify) does this fall back to
    /// checking the SAME email+password against BAPL DMS's own AspNetUsers (standard ASP.NET Core
    /// Identity table, read via the existing BAPLDMSvadConnection - see
    /// BaplDmsService.VerifyDealerCredentialsAsync). A dealer/workshop user who already has real
    /// credentials in BAPL DMS can sign in here with them, and a local Users row is auto-provisioned
    /// (or reused, if one already exists for that email) the same way
    /// BaplDmsController.CreateDealerLoginAsync provisions one for the ERP dealer-resolve flow - so
    /// every downstream DealerJwt-authenticated endpoint keeps working unchanged.
    /// </summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login(DealerLoginRequest req)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u =>
            u.Email.ToLower() == req.Email.ToLower() && u.AuthType == UserAuthType.Local);

        var localOk = user is not null && user.Active && PasswordHasher.Verify(req.Password, user.PasswordHash);

        if (!localOk)
        {
            // ---------------- Fallback: verify against BAPL DMS's own AspNetUsers ----------------
            // Never throws (see VerifyDealerCredentialsAsync's doc comment) - a null here just means
            // "not a valid BAPL DMS login either", falling through to the existing Unauthorized
            // response below exactly as before this fallback was added.
            BaplDmsDealerCredential? baplCred = null;
            try
            {
                baplCred = await _baplDms.VerifyDealerCredentialsAsync(req.Email, req.Password, HttpContext.RequestAborted);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "BAPL DMS credential fallback failed unexpectedly for {Email}", req.Email);
            }

            if (baplCred is null)
                return Unauthorized(new { message = "Invalid email or password." });

            var email = baplCred.Email.Trim().ToLower();
            // Only ever match/reuse an existing LOCAL user for this email - an email that already
            // belongs to an AzureAd-authenticated staff account must never be logged in here just
            // because it happens to also be a valid BAPL DMS login; that would let a BAPL DMS
            // password grant access to an account meant to be gated by Azure AD instead.
            var existingNonLocal = await _db.Users.AnyAsync(u => u.Email.ToLower() == email && u.AuthType != UserAuthType.Local);
            if (existingNonLocal)
                return Unauthorized(new { message = "Invalid email or password." });

            // ---------------- Resolve the role + Dealer/Corporate scope this login gets ----------------
            // Simple case: baplCred.DealerCode straight off AspNetUsers -> a single Dealer, DealerAdmin.
            // BAPL DMS "Employee"-role case (regional/zone BG staff - see ResolveAssignmentAsync): scope
            // comes from BgEmployeeMaster/EmployeeMaster instead, and can span MULTIPLE dealer codes, in
            // which case this account gets CorporateAdmin (org-wide, DealerId=null) rather than being
            // arbitrarily pinned to just one of their dealers - see ResolveAssignmentAsync's doc comment.
            var assignment = await ResolveAssignmentAsync(baplCred, HttpContext.RequestAborted);
            if (assignment is null)
                return Unauthorized(new { message = "Invalid email or password." });

            user = await _db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == email && u.AuthType == UserAuthType.Local);
            if (user is null)
            {
                user = new User
                {
                    Email = email,
                    Name = string.IsNullOrWhiteSpace(baplCred.UserName) ? email.Split('@')[0] : baplCred.UserName,
                    Mobile = baplCred.Phone,
                    Role = assignment.Role,
                    DealerId = assignment.DealerId,
                    AuthType = UserAuthType.Local,
                    // Real authentication now happens against BAPL DMS's own AspNetUsers above, not
                    // this hash - it's set to a random, unguessable value purely so PasswordHash
                    // (which this table treats as required for a Local user) is never null/blank.
                    PasswordHash = PasswordHasher.Hash(Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N")),
                    MustChangePassword = false,
                    // Only ever active when a Dealer (or, for the multi-dealer Employee case, a
                    // CorporateAdmin scope) was actually resolved - see the safety-net comment below
                    // for why an active-with-no-dealer account must never happen for anyone else.
                    Active = assignment.Active,
                };
                _db.Users.Add(user);
                await _db.SaveChangesAsync();
                _logger.LogInformation(
                    assignment.Active
                        ? "Auto-provisioned local User {UserId} for {Email} as {Role} (Dealer {DealerId}, BAPL code {DealerCode}) on first BAPL DMS-backed dealer login"
                        : "Auto-provisioned (INACTIVE, pending Dealer assignment) local User {UserId} for {Email} on first BAPL DMS-backed dealer login",
                    user.Id, email, assignment.Role, assignment.DealerId, baplCred.DealerCode);
            }
            else if (!user.Active)
            {
                // A previously-stuck account (auto-provisioned before DealerCode was wired up, or
                // whose DealerCode couldn't be resolved at the time) gets one more resolution
                // attempt on every login, so it self-heals the next time it can be resolved instead
                // of staying stuck until an admin manually intervenes. Gated on DealerId still being
                // unset AND the account not already being CorporateAdmin - a DealerId that's already
                // set, OR a CorporateAdmin role (which is permanently DealerId=null by design for the
                // multi-dealer Employee case, so "!DealerId.HasValue" alone can't tell "never
                // resolved" apart from "was a resolved CorporateAdmin"), means an admin deliberately
                // deactivated this account (e.g. offboarding), which must NEVER be silently reversed
                // just because their BAPL DMS credentials still work. Safe because a still-pending
                // row's Role is always the DealerAdmin default - ResolveAssignmentAsync only ever
                // returns CorporateAdmin together with Active=true.
                if (assignment.Active && !user.DealerId.HasValue && user.Role != StaffRole.CorporateAdmin)
                {
                    user.Role = assignment.Role;
                    user.DealerId = assignment.DealerId;
                    user.Active = true;
                    await _db.SaveChangesAsync();
                    _logger.LogInformation("Retroactively resolved {Role} scope (Dealer {DealerId}, BAPL code {DealerCode}) for previously-pending User {UserId}", assignment.Role, assignment.DealerId, baplCred.DealerCode, user.Id);
                }
                else
                {
                    // ---------------- Safety net: no Dealer to assign ----------------
                    // Active=true with DealerId=null must never happen for a non-corporate role -
                    // every dealer-scoped query in this app (see the
                    // "Corporate/SystemAdmin ? null : DealerId" pattern in JobCardsController.List
                    // and elsewhere) treats a null DealerId the same as "show every dealer's data".
                    return StatusCode(403, new
                    {
                        message = user.DealerId.HasValue
                            ? "Your account is deactivated. Contact a Corporate/System Admin."
                            : "Your BAPL DMS credentials are valid, but your account isn't linked to a dealer in JobCardScanner yet (BAPL DMS has no DealerCode on file for this login). Ask a Corporate/System Admin to assign your dealer and activate your account from Admin → Users, then sign in again.",
                        pendingDealerAssignment = !user.DealerId.HasValue,
                    });
                }
            }
        }

        user!.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        var token = _tokenService.IssueToken(user);
        var dealer = user.DealerId.HasValue ? await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == user.DealerId) : null;

        return Ok(new
        {
            accessToken = token,
            mustChangePassword = user.MustChangePassword,
            user = new
            {
                user.Id,
                user.Name,
                user.Email,
                user.Mobile,
                Role = user.Role.ToString(),
                user.DealerId,
                DealerName = dealer?.Name,
                user.AvatarColor,
            },
        });
    }

    /// <summary>Outcome of ResolveAssignmentAsync - the role/dealer scope a BAPL DMS-backed login
    /// should get. Active=false means "credentials are good but there's nothing to assign yet",
    /// which Login's caller turns into the existing pending-assignment 403 safety net rather than
    /// ever creating/reactivating an Active user with no scope.</summary>
    private record ResolvedAssignment(StaffRole Role, Guid? DealerId, bool Active);

    /// <summary>
    /// Decides the StaffRole + DealerId a BAPL DMS-backed login should get, per the two shapes BAPL
    /// DMS's own AuthController.Login itself distinguishes (you pasted its real source):
    ///   - The simple case (not the "Employee" role): AspNetUsers.DealerCode names exactly one
    ///     dealer -> DealerAdmin scoped to that one Dealer, same as before this method existed.
    ///   - The "Employee" role case (regional/zone BG staff, e.g. BgEmployeeMaster row "Mayank
    ///     Maheshwari": DealerCode = "CUS0347,CUS0440"): scope comes from
    ///     BaplDmsService.ResolveEmployeeDealerScopeAsync (BgEmployeeMaster/EmployeeMaster by email),
    ///     never from AspNetUsers.DealerCode directly, mirroring BAPL DMS's own
    ///     ResolveEmployeeLoginInfo branch. A rejected/not-found/inactive Employee row returns null
    ///     here (Login then 401s immediately), mirroring BAPL DMS's own rejection of the same case.
    ///     One mapped dealer code -> DealerAdmin scoped to that Dealer, same as the simple case.
    ///     MULTIPLE mapped dealer codes -> CorporateAdmin with DealerId=null (org-wide visibility) -
    ///     JobCardScanner has no way to represent "scoped to exactly these N dealers", and pinning to
    ///     just one of them would be arbitrary and wrong, so per the explicit decision made for this
    ///     feature, a multi-dealer Employee gets the same org-wide access a Corporate Admin has.
    ///     Zero mapped dealer codes (an active BG employee row exists, but with no DealerCode at all)
    ///     -> DealerAdmin with DealerId=null and Active=false, same pending-assignment shape as the
    ///     simple case's unresolved DealerCode - an admin has to sort out that mapping manually.
    /// Never throws - every BAPL DMS call inside here already degrades to a safe default/false on its
    /// own (see VerifyDealerCredentialsAsync/ResolveEmployeeDealerScopeAsync's own doc comments), so
    /// nothing here needs its own additional try/catch.
    /// </summary>
    private async Task<ResolvedAssignment?> ResolveAssignmentAsync(BaplDmsDealerCredential cred, CancellationToken ct)
    {
        if (cred.IsBgEmployeeRole)
        {
            var scope = await _baplDms.ResolveEmployeeDealerScopeAsync(cred.Email, ct);
            if (!scope.Found || !scope.IsActive) return null; // mirrors BAPL DMS's own "Employee account not found or inactive" rejection

            if (scope.DealerCodes.Count > 1)
                return new ResolvedAssignment(StaffRole.CorporateAdmin, null, true);

            if (scope.DealerCodes.Count == 1)
            {
                var dealer = await ResolveDealerByBaplCodeAsync(scope.DealerCodes[0], ct);
                return new ResolvedAssignment(StaffRole.DealerAdmin, dealer?.Id, dealer is not null);
            }

            // Active BG employee row, but it maps to no dealer at all yet - pending, same shape as
            // the simple case's unresolved DealerCode.
            return new ResolvedAssignment(StaffRole.DealerAdmin, null, false);
        }

        var resolvedDealer = string.IsNullOrWhiteSpace(cred.DealerCode) ? null : await ResolveDealerByBaplCodeAsync(cred.DealerCode, ct);
        return new ResolvedAssignment(StaffRole.DealerAdmin, resolvedDealer?.Id, resolvedDealer is not null);
    }

    /// <summary>
    /// Resolves a BAPL DMS DealerCode (e.g. "CUS0001", from AspNetUsers.DealerCode) to a local
    /// <see cref="Dealer"/> row, find-or-create - same fields/Source as
    /// BaplDmsController.ResolveDealer's own dealer-creation path, kept independent (not a shared
    /// helper) since that controller's version also creates a separate DealerAdmin login this path
    /// doesn't need (Login is already creating/updating the User itself). Returns null when the
    /// code can't be found locally OR in BAPL DMS's own DealerMaster (including on any BAPL DMS
    /// error - this must never throw, since a real failure here should degrade a login to the
    /// pending-assignment safety net, not a 500).
    /// </summary>
    private async Task<Dealer?> ResolveDealerByBaplCodeAsync(string dealerCode, CancellationToken ct)
    {
        var code = dealerCode.Trim();
        var existing = await _db.Dealers.FirstOrDefaultAsync(d => d.Code == code || d.BaplDmsDealerCode == code, ct);
        if (existing is not null) return existing;

        try
        {
            var matches = await _baplDms.SearchDealersAsync(code, ct);
            var row = matches.FirstOrDefault(m => string.Equals(m.DealerCode, code, StringComparison.OrdinalIgnoreCase));
            if (row is null) return null;

            var dealer = new Dealer
            {
                Name = row.DealerName,
                Code = row.DealerCode,
                BaplDmsDealerCode = row.DealerCode,
                City = string.IsNullOrWhiteSpace(row.City) ? null : row.City,
                State = string.IsNullOrWhiteSpace(row.State) ? null : row.State,
                Phone = string.IsNullOrWhiteSpace(row.Mobile) ? null : row.Mobile,
                Email = string.IsNullOrWhiteSpace(row.Email) || !row.Email.Contains('@') ? null : row.Email.Trim(),
                Source = DealerSource.BaplImport,
            };
            _db.Dealers.Add(dealer);
            await _db.SaveChangesAsync();
            _logger.LogInformation("Created Dealer {DealerId} from BAPL DMS dealer {DealerCode} via dealer-login resolve", dealer.Id, code);
            return dealer;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not resolve BAPL DMS dealer code {DealerCode} while logging in", code);
            return null;
        }
    }

    /// <summary>POST /api/dealer-auth/forgot-password - issues a one-hour reset token. Always
    /// returns 200 (never reveals whether the email exists) to avoid account enumeration.</summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    public async Task<IActionResult> ForgotPassword(DealerForgotPasswordRequest req)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u =>
            u.Email.ToLower() == req.Email.ToLower() && u.AuthType == UserAuthType.Local && u.Active);

        if (user is null)
            return Ok(new { message = "If that email has a Dealer/Workshop login, a reset link has been sent." });

        var (rawToken, tokenHash) = PasswordHasher.GenerateResetToken();
        user.PasswordResetTokenHash = tokenHash;
        user.PasswordResetExpiresAt = DateTime.UtcNow.AddHours(1);
        await _db.SaveChangesAsync();

        // TODO before production: send `rawToken` via email/SMS instead of returning it here.
        var response = new { message = "If that email has a Dealer/Workshop login, a reset link has been sent." };
        if (_env.IsDevelopment())
            return Ok(new { response.message, devResetToken = rawToken, devNote = "Only returned in Development - wire a real email provider before production." });
        return Ok(response);
    }

    /// <summary>POST /api/dealer-auth/reset-password - completes a forgot-password reset.</summary>
    [HttpPost("reset-password")]
    [AllowAnonymous]
    public async Task<IActionResult> ResetPassword(DealerResetPasswordRequest req)
    {
        var tokenHash = PasswordHasher.HashResetToken(req.Token);
        var user = await _db.Users.FirstOrDefaultAsync(u =>
            u.Email.ToLower() == req.Email.ToLower() &&
            u.AuthType == UserAuthType.Local &&
            u.PasswordResetTokenHash == tokenHash);

        if (user is null || user.PasswordResetExpiresAt is null || user.PasswordResetExpiresAt < DateTime.UtcNow)
            return BadRequest(new { message = "This reset link is invalid or has expired. Request a new one." });

        user.PasswordHash = PasswordHasher.Hash(req.NewPassword);
        user.PasswordResetTokenHash = null;
        user.PasswordResetExpiresAt = null;
        user.MustChangePassword = false;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("DealerAuth.ResetPassword", "User", user.Id.ToString());

        return Ok(new { message = "Password updated. You can sign in now." });
    }

    /// <summary>PATCH /api/dealer-auth/change-password - a signed-in dealer/workshop user
    /// changing their own password (also clears the first-login MustChangePassword flag).</summary>
    [HttpPatch("change-password")]
    [Authorize(AuthenticationSchemes = AuthSchemes.DealerJwt)]
    public async Task<IActionResult> ChangePassword(DealerChangePasswordRequest req)
    {
        if (_currentUser.UserId is null) return Forbid();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == _currentUser.UserId && u.AuthType == UserAuthType.Local);
        if (user is null) return NotFound();

        if (!PasswordHasher.Verify(req.CurrentPassword, user.PasswordHash))
            return BadRequest(new { message = "Current password is incorrect." });

        user.PasswordHash = PasswordHasher.Hash(req.NewPassword);
        user.MustChangePassword = false;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("DealerAuth.ChangePassword", "User", user.Id.ToString());

        return Ok(new { message = "Password changed." });
    }

    /// <summary>POST /api/dealer-auth/{id}/admin-reset-password - a Dealer/Corporate/System
    /// Admin resetting another local user's password (e.g. they're locked out). Accepts either
    /// scheme, so an Azure AD-signed-in corporate admin or a locally-signed-in dealer admin can
    /// both perform this.</summary>
    [HttpPost("{id:guid}/admin-reset-password")]
    [Authorize(Policy = Policies.DealerAdminUp)]
    public async Task<IActionResult> AdminResetPassword(Guid id, DealerAdminResetPasswordRequest req)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.AuthType == UserAuthType.Local);
        if (user is null) return NotFound();
        if (_currentUser.Role is not (StaffRole.CorporateAdmin or StaffRole.SystemAdmin) && user.DealerId != _currentUser.DealerId)
            return Forbid();

        user.PasswordHash = PasswordHasher.Hash(req.NewPassword);
        user.MustChangePassword = true;
        user.PasswordResetTokenHash = null;
        user.PasswordResetExpiresAt = null;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("DealerAuth.AdminResetPassword", "User", user.Id.ToString());

        return Ok(new { message = "Password reset. The user must change it on next sign-in." });
    }
}
