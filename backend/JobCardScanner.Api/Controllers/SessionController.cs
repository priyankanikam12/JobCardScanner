using JobCardScanner.Api.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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
}
