using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT DMS-01, 02, 04, 05, 09, 10): the "centralised, default-deny" authorization the report asks for, for the endpoints it proved reachable by dealer logins. It runs AFTER authentication /
/// authorization and BEFORE the controller, so it works whatever the controller's own [Authorize] says (the report's finding is exactly that the menu hides these and the API does not enforce them).
///
/// Corporate-only rules (CorporateAdmin / SystemAdmin; every other role gets HTTP 403, an anonymous caller 401):
///   any method   /api/admin/**                      (the Azure directory list, the dealer import ... - DMS-02)     also requires a Microsoft-issued token (see CorporateRequiresAzureAd)
///   writes only  /api/vehicle-sale-overrides        (DMS-04: registration-number overwrite)
///                /api/menu-access                   (DMS-04: role matrix, role modes)   - reading stays open to the menu code
///                /api/workflow-stages               (DMS-10)
///                /api/service-menu-master           (DMS-09)
///                /api/extended-battery-warranty-schemes (DMS-09)
///                /api/oem-models, /api/oem-model-warranties (same class of master)
/// /api/users (POST / PUT / PATCH / DELETE) from a NON-corporate login (DMS-01, DMS-05):
///   - the "role" in the body must be a string from the assignable list (never SystemAdmin / CorporateAdmin, never a number that could decode to one);
///   - a login can never change its own role, and can never delete itself.
///   A corporate login passes. The server never derives a role from anything but this checked body.
/// A DECISION for BGauss: vehicle-sale-overrides and the masters above are corporate-only because the report says no dealer role may write them. If a dealer role really needs one, remove its line below.
/// Mode: Security:RouteGuardMode (Enforce | LogOnly | Off).
/// </summary>
public sealed class RouteGuardMiddleware
{
    private sealed record Rule(string Prefix, bool WritesOnly, bool NeedsAzureToken);

    private static readonly string[] Corporate = { "CorporateAdmin", "SystemAdmin" };

    private static readonly HashSet<string> WriteMethods = new(StringComparer.OrdinalIgnoreCase) { "POST", "PUT", "PATCH", "DELETE" };

    /// <summary>The roles a dealer-tier login may ever hand out.</summary>
    private static readonly HashSet<string> AssignableByDealer = new(StringComparer.OrdinalIgnoreCase)
    {
        "ServiceAdvisor", "Technician", "PartsUser", "Cashier", "WorkshopManager", "Supervisor", "DealerAdmin", "Captain", "ViceCaptain",
    };

    private static readonly Rule[] CorporateOnly =
    {
        new("/api/admin", false, true),
        new("/api/vehicle-sale-overrides", true, false),
        new("/api/menu-access", true, false),
        new("/api/workflow-stages", true, false),
        new("/api/service-menu-master", true, false),
        new("/api/extended-battery-warranty-schemes", true, false),
        new("/api/oem-models", true, false),
        new("/api/oem-model-warranties", true, false),
    };

    private readonly RequestDelegate _next;
    private readonly SecurityOptions _opt;
    private readonly string _dealerIssuer;
    private readonly ILogger<RouteGuardMiddleware> _log;

    public RouteGuardMiddleware(RequestDelegate next, IOptions<SecurityOptions> options, IConfiguration config, ILogger<RouteGuardMiddleware> log)
    {
        _next = next;
        _opt = options.Value;
        _dealerIssuer = config["DealerAuthJwt:Issuer"] ?? "JobCardScanner.DealerAuth";
        _log = log;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        if (SecurityOptions.Is(_opt.RouteGuardMode, "Off"))
        {
            await _next(ctx);
            return;
        }

        var path = ctx.Request.Path;
        var isWrite = WriteMethods.Contains(ctx.Request.Method);
        var user = ctx.User;
        var authed = user.Identity?.IsAuthenticated == true;
        var role = user.FindFirst("app_role")?.Value;
        var isCorporate = role is not null && Corporate.Contains(role, StringComparer.OrdinalIgnoreCase);

        foreach (var rule in CorporateOnly)
        {
            if (!path.StartsWithSegments(rule.Prefix, StringComparison.OrdinalIgnoreCase)) continue;
            if (rule.WritesOnly && !isWrite) break;

            if (!authed)
            {
                await Deny(ctx, StatusCodes.Status401Unauthorized, "Sign in is required.");
                return;
            }
            if (!isCorporate)
            {
                if (await Violation(ctx, $"role '{role}' called a corporate-only route")) return;
                break;
            }
            if (rule.NeedsAzureToken && _opt.CorporateRequiresAzureAd && IsDealerIssued(user))
            {
                if (await Violation(ctx, "a token from the dealer login was used on a corporate route")) return;
            }
            break;
        }

        if (authed && isWrite && !isCorporate && path.StartsWithSegments("/api/users", StringComparison.OrdinalIgnoreCase))
        {
            if (await CheckUserWriteAsync(ctx, role)) return;
        }

        await _next(ctx);
    }

    /// <summary>True when the request was refused (HTTP 403 written).</summary>
    private async Task<bool> CheckUserWriteAsync(HttpContext ctx, string? callerRole)
    {
        string? bodyRole = null;
        var hasRole = false;
        var roleIsString = true;

        if (ctx.Request.ContentLength is > 0 and <= 262144)
        {
            ctx.Request.EnableBuffering();
            using var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8, false, 1024, leaveOpen: true);
            var body = await reader.ReadToEndAsync();
            ctx.Request.Body.Position = 0;
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    foreach (var p in doc.RootElement.EnumerateObject())
                    {
                        if (!string.Equals(p.Name, "role", StringComparison.OrdinalIgnoreCase)) continue;
                        hasRole = true;
                        if (p.Value.ValueKind == JsonValueKind.String) bodyRole = p.Value.GetString();
                        else roleIsString = false;
                    }
                }
            }
            catch (JsonException)
            {
            }
        }

        if (hasRole && (!roleIsString || string.IsNullOrWhiteSpace(bodyRole) || !AssignableByDealer.Contains(bodyRole.Trim())))
            return await Violation(ctx, $"role '{callerRole}' tried to assign role '{bodyRole ?? "(not a string)"}'");

        var lastSegment = ctx.Request.Path.Value?.TrimEnd('/').Split('/').LastOrDefault();
        var targetsSelf = Guid.TryParse(lastSegment, out var targetId)
                          && Guid.TryParse(ctx.User.FindFirst("app_user_id")?.Value, out var ownId)
                          && targetId == ownId;
        if (targetsSelf)
        {
            if (HttpMethods.IsDelete(ctx.Request.Method)) return await Violation(ctx, "a login tried to delete itself");
            if (hasRole && !string.Equals(bodyRole?.Trim(), callerRole, StringComparison.OrdinalIgnoreCase))
                return await Violation(ctx, $"role '{callerRole}' tried to change its own role to '{bodyRole}'");
        }
        return false;
    }

    private bool IsDealerIssued(System.Security.Claims.ClaimsPrincipal user) =>
        string.Equals(user.FindFirst("iss")?.Value, _dealerIssuer, StringComparison.OrdinalIgnoreCase)
        || user.Claims.Any(c => string.Equals(c.Issuer, _dealerIssuer, StringComparison.OrdinalIgnoreCase));

    /// <summary>Logs; in Enforce mode writes HTTP 403 and returns true (the caller stops); in LogOnly returns false.</summary>
    private async Task<bool> Violation(HttpContext ctx, string what)
    {
        _log.LogWarning("Route guard: {What} - {Method} {Path} (user {User}).", what, ctx.Request.Method, ctx.Request.Path, ctx.User.FindFirst("app_user_id")?.Value ?? "?");
        if (SecurityOptions.Is(_opt.RouteGuardMode, "LogOnly")) return false;
        await Deny(ctx, StatusCodes.Status403Forbidden, "You are not allowed to do this.");
        return true;
    }

    private static async Task Deny(HttpContext ctx, int status, string message)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new { message }));
    }
}
