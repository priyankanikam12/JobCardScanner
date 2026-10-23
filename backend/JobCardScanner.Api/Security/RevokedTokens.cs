using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-23 (VAPT DMS-16): "Signing out only deletes the key locally; the token itself remains valid on the server for up to eight hours." Now sign-out (POST /api/session/logout, SessionController) puts the
/// token on this list and RevokedTokenMiddleware answers 401 for it from then on - whichever sign-in produced it (dealer / workshop login, Microsoft, customer portal). Only a SHA-256 fingerprint of the
/// token is kept (never the token), and each entry disappears when the token would have expired anyway.
/// Limits to know: the list lives in the API's memory, so an API restart / IIS recycle clears it (a token stolen before that can then be used until it expires). A role change or a password change does not
/// revoke tokens yet - that needs UsersController / DealerAuthController (call Revoke there); a shorter dealer token lifetime (the report asks for 1 hour or less) is DealerAuthJwt:ExpiryMinutes.
/// </summary>
public sealed class RevokedTokenStore
{
    private const int PurgeAbove = 5000;
    private readonly ConcurrentDictionary<string, DateTimeOffset> _revoked = new();

    public static string Fingerprint(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public void Revoke(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) return;
        _revoked[Fingerprint(token)] = ExpiryOf(token) ?? DateTimeOffset.UtcNow.AddHours(12);
        if (_revoked.Count > PurgeAbove) Purge();
    }

    public bool IsRevoked(string token)
    {
        var key = Fingerprint(token);
        if (!_revoked.TryGetValue(key, out var until)) return false;
        if (until > DateTimeOffset.UtcNow) return true;
        _revoked.TryRemove(key, out _);
        return false;
    }

    public int Count => _revoked.Count;

    private void Purge()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var kv in _revoked.Where(kv => kv.Value <= now).ToList()) _revoked.TryRemove(kv.Key, out _);
    }

    /// <summary>The "exp" claim of a JWT (plus a minute of margin), or null when it cannot be read.</summary>
    private static DateTimeOffset? ExpiryOf(string jwt)
    {
        try
        {
            var parts = jwt.Split('.');
            if (parts.Length < 2) return null;
            var payload = parts[1].Replace('-', '+').Replace('_', '/');
            payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
            using var doc = JsonDocument.Parse(Convert.FromBase64String(payload));
            return doc.RootElement.TryGetProperty("exp", out var exp) && exp.TryGetInt64(out var seconds)
                ? DateTimeOffset.FromUnixTimeSeconds(seconds).AddMinutes(1)
                : null;
        }
        catch (Exception)
        {
            return null;
        }
    }
}

/// <summary>Runs before authentication: a bearer token that was signed out is refused with 401, whatever its signature and expiry say.</summary>
public sealed class RevokedTokenMiddleware
{
    private readonly RequestDelegate _next;
    private readonly RevokedTokenStore _store;

    public RevokedTokenMiddleware(RequestDelegate next, RevokedTokenStore store)
    {
        _next = next;
        _store = store;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) && _store.IsRevoked(header[7..].Trim()))
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await ctx.Response.WriteAsJsonAsync(new { message = "This session was signed out. Please sign in again." });
            return;
        }
        await _next(ctx);
    }
}
