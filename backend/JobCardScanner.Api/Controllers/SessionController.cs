using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-23 (VAPT DMS-16): server-side sign-out. The web and the Android app call POST /api/session/logout with the bearer token they are about to throw away; from then on that token is refused
/// (RevokedTokenMiddleware). Anonymous on purpose: the token in the Authorization header IS the proof, it works for every kind of token (dealer login, Microsoft, customer portal), and a token that is
/// already expired or invalid is simply remembered harmlessly until it would have expired.
/// </summary>
[ApiController]
[Route("api/session")]
public sealed class SessionController : ControllerBase
{
    private readonly RevokedTokenStore _revoked;

    public SessionController(RevokedTokenStore revoked) => _revoked = revoked;

    [HttpPost("logout")]
    [AllowAnonymous]
    public IActionResult Logout()
    {
        var header = Request.Headers.Authorization.ToString();
        if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) _revoked.Revoke(header[7..].Trim());
        return NoContent();
    }

    /// <summary>
    /// 2026-10-23 (VAPT DMS-16, "token lifetimes of 1 hour or less with silent renewal"): POST /api/session/renew - a Dealer / Workshop login (any staff role) swaps the token it is about to run out of for a new one with
    /// the same claims (see SessionRenewal). The web and Android apps call it in the last 15 minutes of the token's life, so a person who keeps working stays signed in while no token lives longer than
    /// Security:MaxTokenMinutes. Answers { accessToken, expiresAt }; HTTP 400 for a Microsoft session (MSAL renews that one itself).
    /// </summary>
    [HttpPost("renew")]
    [Authorize(Policy = Policies.Staff)]
    public IActionResult Renew([FromServices] IConfiguration cfg, [FromServices] IWebHostEnvironment env, [FromServices] IOptions<SecurityOptions> options)
    {
        var (status, body) = SessionRenewal.Handle(HttpContext, cfg, env, options.Value);
        return StatusCode(status, body);
    }
}
