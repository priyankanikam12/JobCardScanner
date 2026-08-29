using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;

    public AuthController(JobCardScannerDbContext db, ICurrentUserService currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Called immediately after the web/mobile client signs in with MSAL against Azure AD.
    /// Returns the resolved app profile (role, dealer) for the signed-in user, or 403 with a
    /// clear message if their email has not been provisioned in the app yet - see
    /// docs/AZURE_AD_SETUP.md for how an admin adds a staff user before their first sign-in.
    /// </summary>
    [HttpGet("me")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<IActionResult> Me()
    {
        if (_currentUser.UserId is null)
            return StatusCode(403, new { message = "Your Azure AD account is not provisioned in JobCardScanner. Ask your Dealer/System Admin to add you as a user with this exact email." });

        var user = await _db.Users.AsNoTracking()
            .Include(u => u.Dealer)
            .FirstOrDefaultAsync(u => u.Id == _currentUser.UserId);
        if (user is null) return NotFound();

        return Ok(new
        {
            user.Id,
            user.Name,
            user.Email,
            user.Mobile,
            Role = user.Role.ToString(),
            user.DealerId,
            DealerName = user.Dealer?.Name,
            user.AvatarColor,
            user.LastLoginAt,
            AuthType = user.AuthType.ToString(),
        });
    }
}