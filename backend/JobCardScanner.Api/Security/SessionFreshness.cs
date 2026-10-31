using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>What the database says about a user right now (read through ISessionUserLookup; EfSessionUserLookup is the real one).</summary>
public sealed record SessionUserState(string Role, bool Active, Guid? DealerId, string? Designation = null, string? DealerBaplCode = null);   // Designation (2026-10-31): Captain / ViceCaptain ... - used to reduce the menu matrix to what the caller's own identity can use

public interface ISessionUserLookup
{
    Task<SessionUserState?> FindAsync(Guid userId, CancellationToken ct);
}

/// <summary>
/// 2026-10-23 (VAPT DMS-16, the part of the remediation that was still open: "server-side invalidation on logout, PASSWORD CHANGE and ROLE CHANGE" and "token lifetimes of 1 hour or less with silent renewal").
/// A Dealer / Workshop login and a customer-portal login are bearer tokens that carry their claims (role, dealer ...) for as long as they live; before this nothing looked at them again after sign-in. For
/// every request that arrives with such a token (a token issued by DealerAuthJwt:Issuer or CustomerPortalJwt:Issuer - Microsoft tokens are checked by Microsoft and their role is read from the database on every
/// request anyway):
///   1. the token must not be older than Security:MaxTokenMinutes (60) - measured from its "iat" / "nbf" claim, or - for a token with neither - from the first time this API saw it. The apps renew it silently
///      with POST /api/session/renew, so a person who keeps working is not signed out;
///   2. (Dealer / Workshop only) the user must not have been changed since the token was issued - RevokedTokenStore.RevokeUser is called by UserChangeRevocationInterceptor on a change of role, active flag,
///      dealer or password, or a delete;
///   3. (Dealer / Workshop only) the database must still agree with the token: the user exists, is active, has the role and the dealer written in the token (answer remembered for SessionCheckSeconds).
/// A request that fails answers HTTP 401, which both apps already treat as "your session ended" and return to the sign-in screen. If the database cannot be read the request is let through (a database outage must
/// not sign everybody out). Security:SessionFreshnessMode = LogOnly only logs ("Session freshness: ...") - use it for the first working day, then Enforce.
/// </summary>
public sealed class SessionFreshnessMiddleware
{
    private readonly RequestDelegate _next;
    private readonly RevokedTokenStore _revoked;
    private readonly IMemoryCache _cache;
    private readonly SecurityOptions _opt;
    private readonly ILogger<SessionFreshnessMiddleware> _log;
    private readonly string? _dealerIssuer;
    private readonly string? _customerIssuer;
    private readonly ConcurrentDictionary<string, DateTimeOffset> _firstSeen = new();

    public SessionFreshnessMiddleware(RequestDelegate next, RevokedTokenStore revoked, IMemoryCache cache, IConfiguration cfg, IOptions<SecurityOptions> opt, ILogger<SessionFreshnessMiddleware> log)
    {
        _next = next;
        _revoked = revoked;
        _cache = cache;
        _opt = opt.Value;
        _log = log;
        _dealerIssuer = cfg["DealerAuthJwt:Issuer"];
        _customerIssuer = cfg["CustomerPortalJwt:Issuer"];
    }

    public async Task InvokeAsync(HttpContext ctx, ISessionUserLookup lookup)
    {
        if (SecurityOptions.Is(_opt.SessionFreshnessMode, "Off") || ctx.User.Identity?.IsAuthenticated != true)
        {
            await _next(ctx);
            return;
        }

        var issuer = ctx.User.FindFirst("iss")?.Value;
        var isDealer = !string.IsNullOrEmpty(issuer) && string.Equals(issuer, _dealerIssuer, StringComparison.Ordinal);
        var isCustomer = !string.IsNullOrEmpty(issuer) && string.Equals(issuer, _customerIssuer, StringComparison.Ordinal);
        if (!isDealer && !isCustomer)
        {
            await _next(ctx);
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var issuedAt = IssuedAt(ctx, now);
        string? reason = null;

        if (now - issuedAt > TimeSpan.FromMinutes(Math.Max(5, _opt.MaxTokenMinutes)))
            reason = $"the token is older than {_opt.MaxTokenMinutes} minutes";
        else if (isDealer && Guid.TryParse(ctx.User.FindFirst("app_user_id")?.Value, out var userId))
        {
            if (_revoked.IsUserRevoked(userId, issuedAt)) reason = "the user was changed after this token was issued";
            else
            {
                try
                {
                    var state = await _cache.GetOrCreateAsync($"sf:{userId}", async entry =>
                    {
                        entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(Math.Max(5, _opt.SessionCheckSeconds));
                        return await lookup.FindAsync(userId, ctx.RequestAborted);
                    });
                    reason = Disagreement(ctx, state);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Session freshness: the user could not be read, request let through");
                }
            }
        }

        if (reason is null)
        {
            await _next(ctx);
            return;
        }

        _log.LogWarning("Session freshness: {Reason} - {Method} {Path} ({Mode})", reason, ctx.Request.Method, ctx.Request.Path, _opt.SessionFreshnessMode);
        if (SecurityOptions.Is(_opt.SessionFreshnessMode, "LogOnly"))
        {
            await _next(ctx);
            return;
        }
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new { message = "Your session has ended. Please sign in again." });
    }

    /// <summary>When the token was issued: its "iat" or "nbf" claim, else the first time this API saw it.</summary>
    private DateTimeOffset IssuedAt(HttpContext ctx, DateTimeOffset now)
    {
        foreach (var name in new[] { "iat", "nbf" })
            if (long.TryParse(ctx.User.FindFirst(name)?.Value, out var seconds)) return DateTimeOffset.FromUnixTimeSeconds(seconds);

        var header = ctx.Request.Headers.Authorization.ToString();
        var token = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : header;
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        if (_firstSeen.Count > 5000)
        {
            var limit = now.AddMinutes(-(Math.Max(5, _opt.MaxTokenMinutes) + 5));
            foreach (var kv in _firstSeen.Where(kv => kv.Value < limit).ToList()) _firstSeen.TryRemove(kv.Key, out _);
        }
        return _firstSeen.GetOrAdd(key, now);
    }

    private static string? Disagreement(HttpContext ctx, SessionUserState? state)
    {
        if (state is null) return "the user no longer exists";
        if (!state.Active) return "the user is deactivated";
        var role = ctx.User.FindFirst("app_role")?.Value;
        if (!string.IsNullOrEmpty(role) && !string.Equals(role, state.Role, StringComparison.OrdinalIgnoreCase))
            return $"the role in the token ({role}) is not the user's role now ({state.Role})";
        var dealer = ctx.User.FindFirst("app_dealer_id")?.Value;
        var tokenDealer = Guid.TryParse(dealer, out var d) ? d : (Guid?)null;
        if (tokenDealer != state.DealerId) return "the dealer in the token is not the user's dealer now";
        return null;
    }
}
