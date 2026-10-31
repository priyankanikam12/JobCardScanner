using System.Security.Claims;
using Microsoft.AspNetCore.Mvc.Abstractions;

namespace JobCardScanner.Api.Security;

/// <summary>2026-10-31 (VAPT retest): one place for "is this login org-wide?" - CorporateAdmin and SystemAdmin are, every other role is limited to its own dealer.</summary>
public static class DealerScope
{
    private static readonly string[] Corporate = { "CorporateAdmin", "SystemAdmin" };

    public static bool IsCorporate(ClaimsPrincipal? user) =>
        user?.FindFirst("app_role")?.Value is { } role && Corporate.Contains(role, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// 2026-10-31 (VAPT retest DMS-03, found when the chassis lookup answered ANOTHER dealer's customer on the live site): every action parameter called dealerId is forced to the caller's own dealer. An EMPTY or
    /// OMITTED dealerId becomes the caller's dealer, and a dealerId naming another dealer is refused (returns the reason). The earlier filter handled only a dealerId that was PRESENT in the request: for a query
    /// parameter that is left out, ASP.NET does not put the key into ActionArguments at all, so the filter skipped it and lookups such as GET /api/jobcards/vehicle-lookup ran with no dealer filter.
    /// </summary>
    public static string? EnforceDealerIdParameters(IEnumerable<ParameterDescriptor> parameters, IDictionary<string, object?> args, Guid myDealer)
    {
        foreach (var p in parameters)
        {
            if (!string.Equals(p.Name, "dealerId", StringComparison.OrdinalIgnoreCase)) continue;
            if (p.ParameterType != typeof(Guid) && p.ParameterType != typeof(Guid?)) continue;
            args.TryGetValue(p.Name, out var value);   // an omitted parameter is not in the dictionary at all
            var given = value is Guid g ? g : Guid.Empty;
            if (given == Guid.Empty) args[p.Name] = p.ParameterType == typeof(Guid?) ? (Guid?)myDealer : myDealer;
            else if (given != myDealer) return $"dealerId {given} is not this login's dealer";
        }
        return null;
    }
}
