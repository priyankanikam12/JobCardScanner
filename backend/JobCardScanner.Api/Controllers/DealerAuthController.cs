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

    public DealerAuthController(
        JobCardScannerDbContext db,
        IDealerJwtTokenService tokenService,
        ICurrentUserService currentUser,
        IAuditLogService audit,
        IWebHostEnvironment env)
    {
        _db = db;
        _tokenService = tokenService;
        _currentUser = currentUser;
        _audit = audit;
        _env = env;
    }

    /// <summary>POST /api/dealer-auth/login - email + password sign-in for local staff.</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login(DealerLoginRequest req)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u =>
            u.Email.ToLower() == req.Email.ToLower() && u.AuthType == UserAuthType.Local);

        if (user is null || !user.Active || !PasswordHasher.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new { message = "Invalid email or password." });

        user.LastLoginAt = DateTime.UtcNow;
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
