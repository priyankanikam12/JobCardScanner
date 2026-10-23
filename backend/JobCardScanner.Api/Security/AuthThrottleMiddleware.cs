using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT DMS-11, DMS-12): lockout on the two guessable sign-ins, WITHOUT touching their controllers - it reads the account / mobile number from the request body, refuses with 429 while the key is locked,
/// and counts a 4xx answer as a failure and a 2xx answer as a success (which clears the count).
///   POST /api/dealer-auth/login     key = the account (email / username field): Security:LoginMaxFailures failures -> locked Security:LockoutMinutes; also per IP at 5x that (password spraying across accounts)
///   POST /api/portal/otp/verify     key = the mobile number: Security:OtpMaxFailures wrong codes -> locked (the six-digit code can no longer be brute-forced inside its validity window)
/// Trade-off to know: a lockout by account lets someone deliberately lock a known account for 15 minutes; the report asks for exactly this lockout, and it ends by itself.
/// Runs before authentication (these endpoints are anonymous). Alert emails on lockout are not sent from here - see the log line "Auth lockout".
/// </summary>
public sealed class AuthThrottleMiddleware
{
    private sealed record Target(string Path, string Kind, int MaxFailures, string[] KeyFields);

    private readonly RequestDelegate _next;
    private readonly ILoginThrottle _throttle;
    private readonly ILogger<AuthThrottleMiddleware> _log;
    private readonly TimeSpan _lockout;
    private readonly Target[] _targets;

    public AuthThrottleMiddleware(RequestDelegate next, ILoginThrottle throttle, IOptions<SecurityOptions> options, ILogger<AuthThrottleMiddleware> log)
    {
        _next = next;
        _throttle = throttle;
        _log = log;
        var o = options.Value;
        _lockout = TimeSpan.FromMinutes(Math.Max(1, o.LockoutMinutes));
        _targets = new[]
        {
            new Target("/api/dealer-auth/login", "dealer", Math.Max(3, o.LoginMaxFailures), new[] { "email", "username", "userName", "loginId", "login" }),
            new Target("/api/portal/otp/verify", "otp", Math.Max(3, o.OtpMaxFailures), new[] { "mobile", "mobileNumber", "phone", "phoneNumber" }),
        };
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        if (!HttpMethods.IsPost(ctx.Request.Method))
        {
            await _next(ctx);
            return;
        }

        Target? target = null;
        foreach (var t in _targets)
        {
            if (ctx.Request.Path.StartsWithSegments(t.Path, StringComparison.OrdinalIgnoreCase)) { target = t; break; }
        }
        if (target is null)
        {
            await _next(ctx);
            return;
        }

        var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var account = await ReadKeyAsync(ctx, target.KeyFields);
        var accountKey = account is null ? null : $"{target.Kind}:{account}";
        var ipKey = $"{target.Kind}-ip:{ip}";
        var window = TimeSpan.FromMinutes(Math.Max(10, _lockout.TotalMinutes));

        TimeSpan wait = TimeSpan.Zero;
        var locked = (accountKey is not null && _throttle.IsLocked(accountKey, out wait))
                     || _throttle.IsLocked(ipKey, out wait);
        if (locked)
        {
            ctx.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            ctx.Response.Headers["Retry-After"] = ((int)Math.Ceiling(wait.TotalSeconds)).ToString();
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(JsonSerializer.Serialize(new { message = $"Too many failed attempts. Please try again in {Math.Max(1, (int)Math.Ceiling(wait.TotalMinutes))} minute(s)." }));
            return;
        }

        await _next(ctx);

        var status = ctx.Response.StatusCode;
        if (status is >= 200 and < 300)
        {
            if (accountKey is not null) _throttle.RecordSuccess(accountKey);
        }
        else if (status is >= 400 and < 500 && status != StatusCodes.Status429TooManyRequests)
        {
            if (accountKey is not null)
            {
                _throttle.RecordFailure(accountKey, target.MaxFailures, window, _lockout);
                if (_throttle.IsLocked(accountKey, out _)) _log.LogWarning("Auth lockout: {Kind} key {Key} locked for {Minutes} min after repeated failures (client {Ip}).", target.Kind, account, (int)_lockout.TotalMinutes, ip);
            }
            _throttle.RecordFailure(ipKey, target.MaxFailures * 5, window, _lockout);
        }
    }

    /// <summary>The account / mobile from the JSON body (first of the field names that holds a string), normalised; the body is rewound for the controller.</summary>
    private static async Task<string?> ReadKeyAsync(HttpContext ctx, string[] fields)
    {
        try
        {
            if (ctx.Request.ContentLength is null or <= 0 or > 65536) return null;
            ctx.Request.EnableBuffering();
            using var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8, false, 1024, leaveOpen: true);
            var body = await reader.ReadToEndAsync();
            ctx.Request.Body.Position = 0;
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                if (p.Value.ValueKind != JsonValueKind.String) continue;
                if (!fields.Any(f => string.Equals(f, p.Name, StringComparison.OrdinalIgnoreCase))) continue;
                var v = p.Value.GetString()?.Trim().ToLowerInvariant();
                if (!string.IsNullOrEmpty(v)) return v.Length > 200 ? v[..200] : v;
            }
        }
        catch (JsonException)
        {
        }
        return null;
    }
}
