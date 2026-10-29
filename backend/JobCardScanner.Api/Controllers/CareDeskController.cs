using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-17: the JobCard side of BGauss Care Desk's database (SQL Server database "CareDesk", schema "caredesk", same server as JobCardScannerDb).
///   GET  /api/care-desk/status             - is it switched on / configured, can the database be reached, and how many tickets / vehicles / customers / users it holds. CorporateAdmin / SystemAdmin only.
///   GET  /api/care-desk/tickets?vin=...    - Care Desk tickets of one vehicle (chassis no. or registration no.), newest first; used by the "Care Desk tickets" card on the Job Card page.
///   POST /api/care-desk/sso-token          - 2026-10-19: a 60-second, single-use token that lets the person who is signed in HERE already open the Care Desk web app signed in
///                                            (Care Desk's /api/auth/sso verifies it and matches the person by work email).
///                                            2026-10-29: open to ANY staff role, but only when the current session was authenticated via Microsoft/Azure AD - Care Desk trusts the
///                                            email claim alone to identify the person, and that is only safe when the email is HQ-managed/verified (Microsoft), not a Dealer-login
///                                            account's on-file email. A Dealer-login session is refused here with 403 and keeps using the Vehicle Hub / /api/care-desk-api/token flow
///                                            instead (see CareDeskApiController), which never signs anyone into a Care Desk account.
/// </summary>
[ApiController]
[Route("api/care-desk")]
[Authorize(Policy = Policies.Staff)]
public class CareDeskController : ControllerBase
{
    private static readonly HashSet<string> ClosedStatuses = new() { "closed", "auto_closed", "info_not_received_closed", "cancelled" };

    private readonly ICareDeskService _careDesk;
    private readonly CareDeskOptions _options;
    private readonly ILogger<CareDeskController> _logger;
    private readonly ICurrentUserService _currentUser;
    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _cfg;

    public CareDeskController(
        ICareDeskService careDesk,
        IOptions<CareDeskOptions> options,
        ILogger<CareDeskController> logger,
        ICurrentUserService currentUser,
        JobCardScannerDbContext db,
        IConfiguration cfg)
    {
        _careDesk = careDesk;
        _options = options.Value;
        _logger = logger;
        _currentUser = currentUser;
        _db = db;
        _cfg = cfg;
    }

    [HttpGet("status")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        if (!_careDesk.IsConfigured)
            return Ok(new { enabled = _options.Enabled, configured = false, message = "Set CareDesk:Enabled = true and ConnectionStrings:CareDeskDb." });
        try
        {
            var c = await _careDesk.CountsAsync(ct);
            return Ok(new { enabled = true, configured = true, baseUrl = _options.BaseUrl, connected = c.Connected, tickets = c.Tickets, vehicles = c.Vehicles, customers = c.Customers, users = c.Users });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Care Desk database check failed.");
            return Ok(new { enabled = true, configured = true, connected = false, error = ex.GetBaseException().Message });
        }
    }

    /// <summary>
    /// Single sign-on into the Care Desk web app. The token is signed with CareDeskSso:Secret (the SAME value as CAREDESK_SSO_SECRET in Care Desk's .env.local - keep it in an environment variable
    /// CareDeskSso__Secret, not in appsettings.json), lives 60 seconds, carries only the person's work email and a unique id (jti) that Care Desk accepts once.
    /// Care Desk matches the person by that email, so the email must be one that only its owner can have (Azure AD / HQ-managed). Open to every role (CorporateAdmin, SystemAdmin, dealer
    /// staff, technicians, ...) PROVIDED the current session is a Microsoft/Azure AD login - a Dealer-login (username/password) session is refused with 403 regardless of role, because its
    /// on-file email is not verified the same way. Care Desk itself decides the landing page from the role claim below (an Admin lands on the admin dashboard, anyone else on their own home).
    /// </summary>
    [HttpPost("sso-token")]
    [Authorize(Roles = "CorporateAdmin,SystemAdmin")]   // swap for Policies.CorporateAdminUp if that constant exists in your Policies class
    public async Task<IActionResult> IssueSsoToken()
    {
        var secret = _cfg["CareDeskSso:Secret"];
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
        {
            _logger.LogError("CareDeskSso:Secret is missing or shorter than 32 characters - Care Desk single sign-on cannot work.");
            return StatusCode(500, new { message = "Care Desk single sign-on is not configured on the server (CareDeskSso:Secret)." });
        }

        if (_currentUser.UserId is null) return Forbid();

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == _currentUser.UserId && u.Active);
        if (user is null || string.IsNullOrWhiteSpace(user.Email)) return Forbid();

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var jwt = new JwtSecurityToken(
            issuer: "JobCardScanner",
            audience: "CareDesk",
            claims: new[]
            {
                new Claim("email", user.Email.Trim().ToLowerInvariant()),
                new Claim("uid", user.Id.ToString()),
                new Claim("name", user.Name ?? user.Email),
                new Claim("role", user.Role.ToString()),
                new Claim("dealer_id", user.DealerId?.ToString() ?? ""),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            },
            expires: DateTime.UtcNow.AddSeconds(60),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        _logger.LogInformation("Care Desk single sign-on token issued for user {UserId}.", user.Id);
        Response.Headers.CacheControl = "no-store";
        return Ok(new { token = new JwtSecurityTokenHandler().WriteToken(jwt) });
    }

    [HttpGet("tickets")]
    public async Task<IActionResult> Tickets([FromQuery] string? vin, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(vin)) return BadRequest(new { message = "Give the chassis no. or the registration no. (vin)." });
        if (!_careDesk.IsConfigured)
            return Ok(new { configured = false, message = "Care Desk is not set up (CareDesk:Enabled and ConnectionStrings:CareDeskDb).", tickets = Array.Empty<object>() });

        try
        {
            var rows = await _careDesk.GetTicketsAsync(vin, ct);
            return Ok(new
            {
                configured = true,
                tickets = rows.Select(r => new
                {
                    r.TicketNo, r.Category, r.Status, r.Level, r.CustomerName, r.Vin, r.RegNo, r.Description, r.CreatedAt, r.LevelDueAt, r.ClosedAt, r.IsRepeat,
                    open = !ClosedStatuses.Contains(r.Status),
                }),
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read Care Desk tickets for a vehicle.");
            return StatusCode(502, new { message = "Could not read the Care Desk tickets (the CareDesk database did not answer). Try again." });
        }
    }
}
