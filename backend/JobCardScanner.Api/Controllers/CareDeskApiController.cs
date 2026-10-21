using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-21: lets the JobCardScanner web app call Care Desk's own API (Care Desk's /api/integration/jobcard/*) directly from the browser, to show a vehicle's Care Desk tickets and to raise one.
///   POST /api/care-desk-api/token  - ANY signed-in staff role (Policies.Staff, Microsoft or Dealer login). Returns a 10-minute HS256 token (issuer "JobCardScanner", audience "CareDeskApi",
///                                    claims uid / email / name / role / dealer_id) signed with CareDeskApi:Secret = the SAME value as CAREDESK_API_SECRET on the Care Desk server
///                                    (32+ random characters, keep it in an environment variable CareDeskApi__Secret, not in appsettings.json). Care Desk checks the signature, the audience, the
///                                    expiry and its own CARE_DESK_INTEGRATION_ROLES list. The token says WHO the person is; it opens nothing else (it is not the Care Desk sign-in).
/// Separate from CareDeskController on purpose: that one is CorporateAdminUp (the one-click sign-in), this one is for every staff role.
/// </summary>
[ApiController]
[Route("api/care-desk-api")]
[Authorize(Policy = Policies.Staff)]
public class CareDeskApiController : ControllerBase
{
    private const int TokenMinutes = 10;

    private readonly ILogger<CareDeskApiController> _logger;
    private readonly ICurrentUserService _currentUser;
    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _cfg;

    public CareDeskApiController(ILogger<CareDeskApiController> logger, ICurrentUserService currentUser, JobCardScannerDbContext db, IConfiguration cfg)
    {
        _logger = logger;
        _currentUser = currentUser;
        _db = db;
        _cfg = cfg;
    }

    [HttpPost("token")]
    public async Task<IActionResult> IssueToken()
    {
        var secret = _cfg["CareDeskApi:Secret"];
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
        {
            _logger.LogError("CareDeskApi:Secret is missing or shorter than 32 characters - the Care Desk link from the JobCardScanner web cannot work.");
            return StatusCode(503, new { message = "The Care Desk link is not configured on the server (CareDeskApi:Secret)." });
        }

        if (_currentUser.UserId is null) return Forbid();
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == _currentUser.UserId && u.Active);
        if (user is null || string.IsNullOrWhiteSpace(user.Email)) return Forbid();

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var jwt = new JwtSecurityToken(
            issuer: "JobCardScanner",
            audience: "CareDeskApi",
            claims: new[]
            {
                new Claim("uid", user.Id.ToString()),
                new Claim("email", user.Email.Trim().ToLowerInvariant()),
                new Claim("name", user.Name ?? user.Email),
                new Claim("role", user.Role.ToString()),
                new Claim("dealer_id", user.DealerId?.ToString() ?? ""),
            },
            expires: DateTime.UtcNow.AddMinutes(TokenMinutes),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        Response.Headers.CacheControl = "no-store";
        return Ok(new { token = new JwtSecurityTokenHandler().WriteToken(jwt), expiresInSeconds = TokenMinutes * 60 });
    }
}
