using System.Text.Json;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-31 (VAPT retest DMS-07, screenshots of 30.10.2026): the job card list, the search and the card's own page already hide a card that is outside the login's Work Area (User.WorkLocationCodes; the
/// token claim app_work_locations, e.g. ["CUS0288W4"]; an EMPTY list = every location of the dealer). The WRITE routes (PUT /api/jobcards/{id}, stage, inspections, photos, worklogs, suggestions, estimate
/// e-mail ...) only checked the dealer - so a card at another location of the same dealer was invisible ("No job cards found") yet could be edited through the API by its id. TenantIsolationFilter now applies
/// the same Work Area rule to every request that names a job card. The rule is exactly the one JobCardsController.Detail applies: a card with no location code is outside any restricted Work Area.
/// </summary>
public static class WorkArea
{
    /// <summary>The locations in the claim: a JSON array of strings (["CUS0288W4"]); a comma / semicolon list is accepted too. Anything unreadable = empty = unrestricted, as in the controller.</summary>
    public static List<string> Parse(string? claim)
    {
        var result = new List<string>();
        if (string.IsNullOrWhiteSpace(claim)) return result;
        var text = claim.Trim();
        if (text.StartsWith('['))
        {
            try
            {
                foreach (var e in JsonDocument.Parse(text).RootElement.EnumerateArray())
                    if (e.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(e.GetString())) result.Add(e.GetString()!.Trim());
                return result;
            }
            catch (JsonException) { return result; }
        }
        result.AddRange(text.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return result;
    }

    /// <summary>True when the login may use a card at this location: no restriction, or the card's location code is in the list (case-insensitive).</summary>
    public static bool Allows(IReadOnlyCollection<string> allowed, string? cardLocation) =>
        allowed.Count == 0 || (!string.IsNullOrWhiteSpace(cardLocation) && allowed.Contains(cardLocation.Trim(), StringComparer.OrdinalIgnoreCase));
}
