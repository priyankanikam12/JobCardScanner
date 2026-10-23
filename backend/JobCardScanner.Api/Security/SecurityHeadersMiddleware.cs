using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT DMS-13): the HTTP security headers the report found missing - Strict-Transport-Security, Content-Security-Policy, X-Frame-Options / frame-ancestors, X-Content-Type-Options,
/// Referrer-Policy, Permissions-Policy - and removal of X-Powered-By / Server. Added on every response (OnStarting), so error pages and static files carry them too.
///   /api/...    CSP "default-src 'none'; frame-ancestors 'none'" and Cache-Control: no-store (always enforced - an API response is never a page).
///   /uploads/.. CSP "default-src 'none'; sandbox" + Cross-Origin-Resource-Policy (always enforced - even a file that slipped in as HTML cannot run script) (DMS-06).
///   everything else (the React app) the page policy below, in the mode Security:CspMode (default Report-Only so nothing breaks on day one; switch to Enforce after the browser console shows no violations).
/// NOTE: IIS adds "X-Powered-By: ASP.NET" itself, outside this app - it is removed by deploy/web.config.security-snippet.xml (this middleware cannot remove a header IIS adds later).
/// </summary>
public sealed class SecurityHeadersMiddleware
{
    private const string ApiCsp = "default-src 'none'; frame-ancestors 'none'";
    private const string UploadCsp = "default-src 'none'; sandbox";

    private readonly RequestDelegate _next;
    private readonly SecurityOptions _opt;
    private readonly bool _httpsRedirectionOff;
    private readonly string _pageCsp;

    public SecurityHeadersMiddleware(RequestDelegate next, IOptions<SecurityOptions> options, IConfiguration config)
    {
        _next = next;
        _opt = options.Value;
        _httpsRedirectionOff = config.GetValue<bool>("DisableHttpsRedirection");

        var connect = new List<string> { "'self'", "https://login.microsoftonline.com", "https://*.microsoftonline.com", "https://graph.microsoft.com" };
        connect.AddRange(_opt.ExtraConnectSrc.Where(s => !string.IsNullOrWhiteSpace(s)));

        _pageCsp = string.Join("; ", new[]
        {
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",           // the app styles many elements inline
            "img-src 'self' data: blob: https:",
            "media-src 'self' blob:",
            "font-src 'self' data:",
            "connect-src " + string.Join(' ', connect),
            "frame-src https://login.microsoftonline.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
        });
    }

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var h = context.Response.Headers;
            var path = context.Request.Path;

            h["X-Content-Type-Options"] = "nosniff";
            h["X-Frame-Options"] = "DENY";
            h["Referrer-Policy"] = "strict-origin-when-cross-origin";
            h["Permissions-Policy"] = "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()";
            h.Remove("X-Powered-By");
            h.Remove("Server");

            if (_opt.EnableHsts && context.Request.IsHttps && !_httpsRedirectionOff)
                h["Strict-Transport-Security"] = $"max-age={Math.Max(1, _opt.HstsMaxAgeDays) * 86400}";

            if (path.StartsWithSegments("/uploads"))
            {
                h["Content-Security-Policy"] = UploadCsp;
                h["Cross-Origin-Resource-Policy"] = "same-origin";
            }
            else if (path.StartsWithSegments("/api"))
            {
                h["Content-Security-Policy"] = ApiCsp;
                if (!h.ContainsKey("Cache-Control")) h["Cache-Control"] = "no-store";
            }
            else if (!SecurityOptions.Is(_opt.CspMode, "Off"))
            {
                h[SecurityOptions.Is(_opt.CspMode, "Enforce") ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only"] = _pageCsp;
            }

            return Task.CompletedTask;
        });

        return _next(context);
    }
}
