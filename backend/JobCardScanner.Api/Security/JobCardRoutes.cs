using System.Text.RegularExpressions;

namespace JobCardScanner.Api.Security;

public enum JobCardRouteKind { None, JobCard, Child }

/// <param name="Kind">JobCard: the route names a job card (Id). Child: the route names a part / labour suggestion, a photo or a worklog (Id) of some job card, to be looked up.</param>
public readonly record struct JobCardRoute(JobCardRouteKind Kind, Guid Id, string? ChildKind);

/// <summary>
/// 2026-10-31 (VAPT retest, DMS-07 "Job Card of other dealer ... is able to edit by providing the UUID of the Job Card directly in the request"): finds the job card a request is about, whatever shape the
/// request has. TenantIsolationFilter used to match only a job card id written as 36 characters with hyphens under /api/jobcards/{id}/..., but the controller's {id:guid} route also accepts the same GUID without
/// hyphens, in braces or in parentheses - a request written that way was not checked. Now:
///   * /api/jobcards/{guid in ANY format that Guid.TryParse accepts}/...   -> that job card
///   * /api/jobcards/(part-suggestions | labour-suggestions | photos | worklogs)/{guid}/... -> a child record; the filter looks up its job card (worklogs/{id}/end was not covered at all before)
///   * a job card id sent in the query string or the body - an action parameter called jobCardId, or a body property JobCardId (repair bills, material transfers ...)
/// No database access here, so it can be tested on its own.
/// </summary>
public static class JobCardRoutes
{
    private static readonly Regex Prefix = new(@"^/api/jobcards/(?<seg>[^/]+)(?<rest>/.*)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    public static readonly string[] ChildKinds = { "part-suggestions", "labour-suggestions", "photos", "worklogs" };

    private static string Unescape(string s)
    {
        try { return Uri.UnescapeDataString(s).Trim(); } catch (UriFormatException) { return s.Trim(); }
    }

    public static JobCardRoute Parse(string? path)
    {
        var none = new JobCardRoute(JobCardRouteKind.None, Guid.Empty, null);
        if (string.IsNullOrWhiteSpace(path)) return none;
        var m = Prefix.Match(path.Trim());
        if (!m.Success) return none;
        var seg = Unescape(m.Groups["seg"].Value);
        if (Guid.TryParse(seg, out var jobCard)) return new JobCardRoute(JobCardRouteKind.JobCard, jobCard, null);
        var kind = ChildKinds.FirstOrDefault(k => string.Equals(k, seg, StringComparison.OrdinalIgnoreCase));
        if (kind is null) return none;
        var second = m.Groups["rest"].Value.TrimStart('/').Split('/')[0];
        return Guid.TryParse(Unescape(second), out var child) ? new JobCardRoute(JobCardRouteKind.Child, child, kind) : none;
    }

    /// <summary>Every job card id carried by the action arguments: a parameter named jobCardId (Guid, Guid? or a string holding a GUID) and a property JobCardId on a body object.</summary>
    public static List<Guid> ArgumentJobCardIds(IDictionary<string, object?> args)
    {
        var found = new List<Guid>();
        static bool TryId(object? v, out Guid id)
        {
            id = Guid.Empty;
            return v switch { Guid g => (id = g) != Guid.Empty, string s => Guid.TryParse(s.Trim(), out id) && id != Guid.Empty, _ => false };
        }
        foreach (var (name, value) in args)
        {
            if (value is null) continue;
            if (string.Equals(name, "jobCardId", StringComparison.OrdinalIgnoreCase)) { if (TryId(value, out var id)) found.Add(id); continue; }
            var type = value.GetType();
            if (value is string || type.IsPrimitive || type.IsValueType || type.IsEnum) continue;
            var prop = type.GetProperty("JobCardId", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.IgnoreCase);
            if (prop is not null && prop.CanRead && TryId(prop.GetValue(value), out var bodyId)) found.Add(bodyId);
        }
        return found.Distinct().ToList();
    }
}
