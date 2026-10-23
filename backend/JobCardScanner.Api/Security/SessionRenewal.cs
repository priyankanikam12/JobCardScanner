using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-23 (VAPT DMS-16): the logic of POST /api/session/renew, kept out of the controller so it can be tested on its own. The caller is a Dealer / Workshop login whose token the API has just accepted
/// (signature, expiry, sign-out list, SessionFreshnessMiddleware - a deactivated user or a changed role never gets here). It answers a new token with the same claims and Security:RenewedTokenMinutes of life.
/// The old token is NOT revoked: requests that are already on their way with it must still succeed (they would otherwise return to the sign-in screen); it expires on its own, and the apps renew it only in its
/// last 15 minutes. A Microsoft session renews itself (MSAL), so it is refused here.
/// </summary>
public static class SessionRenewal
{
    private const string DevelopmentSecret = "dev-only-insecure-secret-change-me-min-32-chars";

    public static (int Status, object Body) Handle(HttpContext ctx, IConfiguration cfg, IHostEnvironment env, SecurityOptions opt)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return (StatusCodes.Status400BadRequest, new { message = "No token to renew." });

        var section = cfg.GetSection("DealerAuthJwt");
        var issuer = section["Issuer"];
        var secret = section["Secret"];
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32) secret = env.IsDevelopment() ? DevelopmentSecret : null;
        if (string.IsNullOrWhiteSpace(issuer) || secret is null) return (StatusCodes.Status500InternalServerError, new { message = "The Dealer / Workshop login is not configured on this server." });

        var now = DateTimeOffset.UtcNow;
        var token = DealerTokenRenewer.Renew(header[7..].Trim(), secret, issuer, opt.RenewedTokenMinutes, now, out var error);
        if (token is null) return (StatusCodes.Status400BadRequest, new { message = error });
        return (StatusCodes.Status200OK, new { accessToken = token, expiresAt = now.AddMinutes(Math.Max(5, opt.RenewedTokenMinutes)).ToString("O") });
    }
}
