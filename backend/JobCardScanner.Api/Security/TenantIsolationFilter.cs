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
///   0. 2026-10-31 (retest DMS-07): the job card is found by JobCardRoutes from the path in ANY GUID format (the {id:guid} route also accepts it without hyphens or in braces), from the child routes
///      part-suggestions / labour-suggestions / photos / worklogs, and from a jobCardId in the query string or the body (repair bills, material transfers ...).
///   0b. 2026-10-31 (retest DMS-07): the Work Area rule of the card page (claim app_work_locations; empty = every location) applies to the same requests, so a card that is hidden from a login is no longer writable by it.
///   1. Job-card routes: for /api/jobcards/{id}/... (inspections, labour-suggestions, photos/upload, estimates/email, PUT ...) and the child routes /api/jobcards/part-suggestions|labour-suggestions|photos|worklogs/{id}, the job card's
///      DealerId must equal the caller's own dealer (claim app_dealer_id) - reads AND writes. A card that does not exist passes through (the controller answers 404).
///   2. Client-supplied dealer ids: any action parameter named dealerId, and any request-body object with a DealerId property, is forced to the caller's own dealer when empty and REFUSED when it names another dealer -
///      the id is never trusted from the browser. (A "Delhi captain creates a customer in Chennai" request now gets HTTP 403.)
/// Who is exempt: CorporateAdmin / SystemAdmin (org-wide by design) and tokens without an app_role (customer portal, API-key partner routes - they have their own rules).
/// Mode: Security:DealerScopeMode (Enforce | LogOnly | Off).
/// ASSUMES: table dbo.JobCards has DealerId and BaplServiceLocationCode columns; dbo.JobCardWorklogs has JobCardId; dbo.JobCardPartSuggestions / JobCardLabourSuggestions / JobCardPhotos have JobCardId (the names used in the startup SQL of this project). If a name differs the query
/// throws - change the SQL below.
/// NOT covered here (needs the controller): the e-mail recipient of POST /api/jobcards/{id}/estimates/email must be limited to the job card's own customer contact - see the tracker (DMS-03 item 2).
/// </summary>
public sealed class TenantIsolationFilter : IAsyncActionFilter
{
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

        // 1. job-card ownership (reads and writes). 2026-10-31 (retest DMS-07): the job card is found from the path in ANY GUID format (JobCardRoutes), including the child routes photos / part and labour
        // suggestions / worklogs, and from a jobCardId in the query string or the body.
        var route = JobCardRoutes.Parse(http.Request.Path.Value);
        Guid? jobCardId = route.Kind switch
        {
            JobCardRouteKind.JobCard => route.Id,
            JobCardRouteKind.Child => await JobCardOfChildAsync(route.ChildKind!, route.Id, http.RequestAborted),
            _ => null,
        };
        // 2026-10-31 (retest DMS-07, evidence of 30.10.2026): a card of the SAME dealer at a location outside the login's Work Area is hidden from lists, search and the card page, but its write routes only
        // checked the dealer. Both rules - dealer and Work Area - now apply to every request that names a job card.
        var workArea = WorkArea.Parse(user.FindFirst("app_work_locations")?.Value);
        if (jobCardId is not null && await OutsideScopeAsync(jobCardId.Value, myDealer, workArea, http.RequestAborted) is { } why && Refuse(context, $"job card {jobCardId} {why}")) return;
        foreach (var carried in JobCardRoutes.ArgumentJobCardIds(context.ActionArguments))
            if (await OutsideScopeAsync(carried, myDealer, workArea, http.RequestAborted) is { } carriedWhy && Refuse(context, $"the request names job card {carried}, which {carriedWhy}")) return;

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

    /// <summary>Why the login may not use this job card - "belongs to another dealer" or "is outside this login's Work Area" - or null when it may (a card that does not exist passes through: the controller answers 404).</summary>
    private async Task<string?> OutsideScopeAsync(Guid jobCardId, Guid myDealer, IReadOnlyCollection<string> workArea, CancellationToken ct)
    {
        var rows = await _db.Database
            .SqlQueryRaw<string?>("SELECT CAST([DealerId] AS nvarchar(40)) + N'|' + ISNULL([BaplServiceLocationCode], N'') AS [Value] FROM [dbo].[JobCards] WHERE [Id] = {0}", jobCardId)
            .ToListAsync(ct);
        if (rows.Count == 0 || rows[0] is null) return null;
        var parts = rows[0]!.Split('|', 2);
        if (!(Guid.TryParse(parts[0], out var owner) && owner == myDealer)) return "belongs to another dealer";
        return WorkArea.Allows(workArea, parts.Length > 1 ? parts[1] : null) ? null : "is outside this login's Work Area";
    }

    private async Task<Guid?> JobCardOfChildAsync(string kind, Guid id, CancellationToken ct)
    {
        var sql = kind switch
        {
            "part-suggestions" => "SELECT CAST([JobCardId] AS nvarchar(40)) AS [Value] FROM [dbo].[JobCardPartSuggestions] WHERE [Id] = {0}",
            "labour-suggestions" => "SELECT CAST([JobCardId] AS nvarchar(40)) AS [Value] FROM [dbo].[JobCardLabourSuggestions] WHERE [Id] = {0}",
            "worklogs" => "SELECT CAST([JobCardId] AS nvarchar(40)) AS [Value] FROM [dbo].[JobCardWorklogs] WHERE [Id] = {0}",
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
