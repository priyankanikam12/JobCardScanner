using System.Reflection;
using System.Text.RegularExpressions;
using JobCardScanner.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT DMS-03, DMS-07): one global filter - registered once, applies to EVERY controller action - that keeps a dealer login inside its own dealer. It does not change any controller.
///   1. Job-card routes: for /api/jobcards/{id}/... (inspections, labour-suggestions, photos/upload, estimates/email, PUT ...) and the child routes /api/jobcards/part-suggestions|labour-suggestions|photos/{id}, the job card's
///      DealerId must equal the caller's own dealer (claim app_dealer_id) - reads AND writes. A card that does not exist passes through (the controller answers 404).
///   2. Client-supplied dealer ids: any action parameter named dealerId, and any request-body object with a DealerId property, is forced to the caller's own dealer when empty and REFUSED when it names another dealer -
///      the id is never trusted from the browser. (A "Delhi captain creates a customer in Chennai" request now gets HTTP 403.)
/// Who is exempt: CorporateAdmin / SystemAdmin (org-wide by design) and tokens without an app_role (customer portal, API-key partner routes - they have their own rules).
/// Mode: Security:DealerScopeMode (Enforce | LogOnly | Off).
/// ASSUMES: table dbo.JobCards has a DealerId column; dbo.JobCardPartSuggestions / JobCardLabourSuggestions / JobCardPhotos have JobCardId (the names used in the startup SQL of this project). If a name differs the query
/// throws - change the SQL below.
/// NOT covered here (needs the controller): the e-mail recipient of POST /api/jobcards/{id}/estimates/email must be limited to the job card's own customer contact - see the tracker (DMS-03 item 2).
/// </summary>
public sealed class TenantIsolationFilter : IAsyncActionFilter
{
    private const string Guid36 = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    private static readonly Regex JobCardPath = new($"^/api/jobcards/(?<id>{Guid36})(/|$)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex ChildPath = new($"^/api/jobcards/(?<kind>part-suggestions|labour-suggestions|photos)/(?<id>{Guid36})(/|$)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly string[] Corporate = { "CorporateAdmin", "SystemAdmin" };

    private readonly JobCardScannerDbContext _db;
    private readonly SecurityOptions _opt;
    private readonly ILogger<TenantIsolationFilter> _log;

    public TenantIsolationFilter(JobCardScannerDbContext db, IOptions<SecurityOptions> options, ILogger<TenantIsolationFilter> log)
    {
        _db = db;
        _opt = options.Value;
        _log = log;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (SecurityOptions.Is(_opt.DealerScopeMode, "Off")) { await next(); return; }

        var http = context.HttpContext;
        var user = http.User;
        var role = user.FindFirst("app_role")?.Value;
        if (user.Identity?.IsAuthenticated != true || role is null || Corporate.Contains(role, StringComparer.OrdinalIgnoreCase))
        {
            await next();
            return;
        }

        if (!Guid.TryParse(user.FindFirst("app_dealer_id")?.Value, out var myDealer))
        {
            if (Refuse(context, "this login has no dealer assigned")) return;
            await next();
            return;
        }

        // 1. job-card ownership (reads and writes)
        var path = http.Request.Path.Value ?? "";
        Guid? jobCardId = null;
        var m = JobCardPath.Match(path);
        if (m.Success) jobCardId = Guid.Parse(m.Groups["id"].Value);
        else
        {
            var c = ChildPath.Match(path);
            if (c.Success) jobCardId = await JobCardOfChildAsync(c.Groups["kind"].Value.ToLowerInvariant(), Guid.Parse(c.Groups["id"].Value), http.RequestAborted);
        }
        if (jobCardId is not null)
        {
            var rows = await _db.Database
                .SqlQueryRaw<string?>("SELECT CAST([DealerId] AS nvarchar(40)) AS [Value] FROM [dbo].[JobCards] WHERE [Id] = {0}", jobCardId.Value)
                .ToListAsync(http.RequestAborted);
            if (rows.Count > 0)
            {
                var ownerOk = Guid.TryParse(rows[0], out var owner) && owner == myDealer;
                if (!ownerOk && Refuse(context, $"job card {jobCardId} belongs to another dealer")) return;
            }
        }

        // 2. dealer ids sent by the browser
        foreach (var p in context.ActionDescriptor.Parameters)
        {
            if (!string.Equals(p.Name, "dealerId", StringComparison.OrdinalIgnoreCase)) continue;
            if (!context.ActionArguments.TryGetValue(p.Name, out var value)) continue;
            if (p.ParameterType != typeof(Guid) && p.ParameterType != typeof(Guid?)) continue;
            var given = value is Guid g ? g : Guid.Empty;
            if (given == Guid.Empty) context.ActionArguments[p.Name] = p.ParameterType == typeof(Guid?) ? (Guid?)myDealer : myDealer;
            else if (given != myDealer && Refuse(context, $"dealerId {given} is not this login's dealer")) return;
        }
        foreach (var arg in context.ActionArguments.Values)
        {
            if (arg is null || arg is string || arg.GetType().IsPrimitive || arg.GetType().IsValueType) continue;
            var prop = arg.GetType().GetProperty("DealerId", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (prop is null || !prop.CanRead || !prop.CanWrite) continue;
            if (prop.PropertyType != typeof(Guid) && prop.PropertyType != typeof(Guid?)) continue;
            var current = prop.GetValue(arg) is Guid cg ? cg : Guid.Empty;
            if (current == Guid.Empty) prop.SetValue(arg, myDealer);
            else if (current != myDealer && Refuse(context, $"body dealerId {current} is not this login's dealer")) return;
        }

        await next();
    }

    private async Task<Guid?> JobCardOfChildAsync(string kind, Guid id, CancellationToken ct)
    {
        var sql = kind switch
        {
            "part-suggestions" => "SELECT CAST([JobCardId] AS nvarchar(40)) AS [Value] FROM [dbo].[JobCardPartSuggestions] WHERE [Id] = {0}",
            "labour-suggestions" => "SELECT CAST([JobCardId] AS nvarchar(40)) AS [Value] FROM [dbo].[JobCardLabourSuggestions] WHERE [Id] = {0}",
            _ => "SELECT CAST([JobCardId] AS nvarchar(40)) AS [Value] FROM [dbo].[JobCardPhotos] WHERE [Id] = {0}",
        };
        var rows = await _db.Database.SqlQueryRaw<string?>(sql, id).ToListAsync(ct);
        return rows.Count > 0 && Guid.TryParse(rows[0], out var jc) ? jc : null;
    }

    /// <summary>Logs; in Enforce mode sets HTTP 403 and returns true (the action must not run); in LogOnly returns false.</summary>
    private bool Refuse(ActionExecutingContext context, string what)
    {
        _log.LogWarning("Tenant isolation: {What} - {Method} {Path} (user {User}).", what, context.HttpContext.Request.Method, context.HttpContext.Request.Path, context.HttpContext.User.FindFirst("app_user_id")?.Value ?? "?");
        if (SecurityOptions.Is(_opt.DealerScopeMode, "LogOnly")) return false;
        context.Result = new ObjectResult(new { message = "You are not allowed to access another dealer's data." }) { StatusCode = StatusCodes.Status403Forbidden };
        return true;
    }
}
