using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT, Securepoint report v1.0): the single entry point of the security layer, so Program.cs needs only six one-line additions (see patches/vapt/apply-program-cs-security.js):
///   builder.AddAppSecurity();            services: options, rate limiter, lockout, the tenant filter, forwarded headers, no Server header
///   app.UseAppSecurityEarly();           right after Build(): forwarded headers (real client IP / https behind the proxy) + security headers
///   app.UseAppRateLimit();               after CORS: request rate limits + failed-login lockout
///   app.UseAppStaticFiles(provider);     replaces UseStaticFiles: /uploads served only as safe media types, never as HTML (DMS-06)
///   app.UseAppGuards();                  after UseAuthorization(): session checks + route guard + OTP answer normalizer + response sanitizer
///   builder.AddAppSecurityEf();          (2026-10-23, DMS-16) right after AddAppSecurity(): the database part of the session checks - see SessionFreshnessEf.cs
/// </summary>
public static class SecurityExtensions
{
    /// <summary>Sign-in style endpoints that get the strict per-IP rate (DMS-11, DMS-12).</summary>
    private static readonly string[] AuthPaths = { "/api/dealer-auth/login", "/api/portal/otp", "/api/portal/login" };

    public static WebApplicationBuilder AddAppSecurity(this WebApplicationBuilder builder)
    {
        var section = builder.Configuration.GetSection(SecurityOptions.Section);
        var sec = section.Get<SecurityOptions>() ?? new SecurityOptions();
        builder.Services.Configure<SecurityOptions>(section);

        // no "Server: Kestrel" header (harmless when hosted in IIS in-process)
        builder.WebHost.ConfigureKestrel(k => k.AddServerHeader = false);

        // the site sits behind a proxy / Cloudflare: take the client IP and the original scheme from X-Forwarded-*. KEEP the server reachable only through that proxy (firewall / security group),
        // otherwise a caller can fake the header and dodge the IP-based limits.
        builder.Services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            o.KnownNetworks.Clear();
            o.KnownProxies.Clear();
        });

        builder.Services.AddSingleton<ILoginThrottle, LoginThrottle>();
        builder.Services.AddSingleton<SignedMedia>();          // DMS-14: expiring photo links
        builder.Services.AddSingleton<RevokedTokenStore>();    // DMS-16: signed-out tokens, and users whose role / password changed
        builder.Services.AddMemoryCache();                     // DMS-16: SessionFreshnessMiddleware remembers a user's database state for a few seconds
        builder.Services.AddScoped<TenantIsolationFilter>();
        builder.Services.Configure<MvcOptions>(o => o.Filters.AddService<TenantIsolationFilter>());

        builder.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.OnRejected = async (context, cancellationToken) =>
            {
                context.HttpContext.Response.Headers["Retry-After"] = "60";
                await context.HttpContext.Response.WriteAsJsonAsync(new { message = "Too many requests. Please wait a minute and try again." }, cancellationToken);
            };
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
            {
                var path = ctx.Request.Path;
                var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

                foreach (var p in AuthPaths)
                {
                    if (!path.StartsWithSegments(p, StringComparison.OrdinalIgnoreCase)) continue;
                    return RateLimitPartition.GetFixedWindowLimiter($"auth:{p}:{ip}", _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = Math.Max(1, sec.AuthRequestsPerMinute),
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    });
                }
                if (path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase))
                {
                    return RateLimitPartition.GetSlidingWindowLimiter($"api:{ip}", _ => new SlidingWindowRateLimiterOptions
                    {
                        PermitLimit = Math.Max(60, sec.ApiRequestsPerMinute),
                        Window = TimeSpan.FromMinutes(1),
                        SegmentsPerWindow = 6,
                        QueueLimit = 0,
                    });
                }
                return RateLimitPartition.GetNoLimiter("static");
            });
        });

        return builder;
    }

    public static WebApplication UseAppSecurityEarly(this WebApplication app)
    {
        app.UseForwardedHeaders();
        app.UseMiddleware<SecurityHeadersMiddleware>();
        return app;
    }

    public static WebApplication UseAppRateLimit(this WebApplication app)
    {
        app.UseRateLimiter();
        app.UseMiddleware<AuthThrottleMiddleware>();
        app.UseMiddleware<RevokedTokenMiddleware>();   // DMS-16: before authentication, so a signed-out token never gets in
        return app;
    }

    public static WebApplication UseAppGuards(this WebApplication app)
    {
        app.UseMiddleware<SessionFreshnessMiddleware>();    // DMS-16: token age, user changed / deactivated / role changed (needs ISessionUserLookup - AddAppSecurityEf())
        app.UseMiddleware<RouteGuardMiddleware>();
        app.UseMiddleware<OtpEnumerationMiddleware>();      // DMS-12: one answer for every mobile number (outside the sanitizer, so it sees the answer after devOtpCode was removed)
        app.UseMiddleware<ResponseSanitizerMiddleware>();
        return app;
    }

    /// <summary>
    /// Replaces the single app.UseStaticFiles(...) call. (1) /uploads is served only for photo / video extensions, always with the matching image / video content type, plus nosniff and a sandboxing CSP; an
    /// .html / .svg / .js ... file that is already on disk is answered 404 and can never run as a page (DMS-06). (2) Everything else in wwwroot is served as before (the SPA, the .apk).
    /// </summary>
    public static WebApplication UseAppStaticFiles(this WebApplication app, IContentTypeProvider siteContentTypes)
    {
        var uploadsDir = Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads");
        Directory.CreateDirectory(uploadsDir);

        // DMS-14: a job-card photo is served only with a valid, unexpired signature (added by the API to every address it returns to a signed-in user). No / wrong / expired signature = 404, so the
        // answer does not even confirm that the file exists.
        var media = app.Services.GetRequiredService<SignedMedia>();
        app.UseWhen(c => c.Request.Path.StartsWithSegments("/uploads/jobcard-photos", StringComparison.OrdinalIgnoreCase), b => b.Use(async (ctx, next) =>
        {
            var q = ctx.Request.Query;
            if (media.Verify(ctx.Request.Path.Value ?? "", q["exp"].ToString(), q["sig"].ToString()))
            {
                await next();
                return;
            }
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        }));

        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(uploadsDir),
            RequestPath = "/uploads",
            ContentTypeProvider = new FileExtensionContentTypeProvider(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                [".jpg"] = "image/jpeg",
                [".jpeg"] = "image/jpeg",
                [".png"] = "image/png",
                [".gif"] = "image/gif",
                [".webp"] = "image/webp",
                [".heic"] = "image/heic",
                [".heif"] = "image/heif",
                [".mp4"] = "video/mp4",
                [".mov"] = "video/quicktime",
                [".webm"] = "video/webm",
                [".3gp"] = "video/3gpp",
                [".avi"] = "video/x-msvideo",
            }),
            ServeUnknownFileTypes = false,
            OnPrepareResponse = ctx =>
            {
                var h = ctx.Context.Response.Headers;
                h["X-Content-Type-Options"] = "nosniff";
                h["Content-Security-Policy"] = "default-src 'none'; sandbox";
                h["Cross-Origin-Resource-Policy"] = "same-origin";
                h["Content-Disposition"] = "inline";
                h["Cache-Control"] = "private, max-age=3600";
            },
        });

        // anything under /uploads that the handler above did not serve (unknown extension, missing file) ends here - it must not fall through to the SPA's index.html
        app.UseWhen(c => c.Request.Path.StartsWithSegments("/uploads"), b => b.Run(c =>
        {
            c.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        }));

        app.UseWhen(c => !c.Request.Path.StartsWithSegments("/uploads"), b => b.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = siteContentTypes }));
        return app;
    }
}
