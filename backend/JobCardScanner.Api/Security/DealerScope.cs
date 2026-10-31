using System.Security.Claims;

namespace JobCardScanner.Api.Security;

/// <summary>2026-10-31 (VAPT retest): one place for "is this login org-wide?" - CorporateAdmin and SystemAdmin are, every other role is limited to its own dealer.</summary>
public static class DealerScope
{
    private static readonly string[] Corporate = { "CorporateAdmin", "SystemAdmin" };

    public static bool IsCorporate(ClaimsPrincipal? user) =>
        user?.FindFirst("app_role")?.Value is { } role && Corporate.Contains(role, StringComparer.OrdinalIgnoreCase);
}
