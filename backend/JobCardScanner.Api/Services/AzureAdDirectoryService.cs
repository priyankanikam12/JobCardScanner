using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace JobCardScanner.Api.Services;

/// <summary>One row from the tenant's Azure AD directory, as returned by Microsoft Graph.</summary>
public record AzureAdDirectoryUser(string ObjectId, string DisplayName, string? Email, bool AccountEnabled);

public interface IAzureAdDirectoryService
{
    /// <summary>
    /// Returns every user in the Azure AD tenant (cached for a few minutes so repeated searches
    /// on the Admin -> Users page don't re-hit Microsoft Graph on every keystroke). Throws
    /// <see cref="InvalidOperationException"/> with a human-readable message if AzureAdGraph
    /// isn't configured yet, or Graph rejects the credentials/permissions.
    /// </summary>
    Task<IReadOnlyList<AzureAdDirectoryUser>> ListUsersAsync(CancellationToken ct = default);
}

/// <summary>
/// Reads the tenant's full user directory from Microsoft Graph using the app's own identity
/// (client-credentials / daemon flow - no signed-in user involved), so Admin -> Users can let an
/// admin browse real @bgauss.com accounts and provision/re-role them instead of typing emails
/// blind. Requires a SEPARATE setup step in the Azure Portal beyond the sign-in App Registration
/// - see appsettings.json's "AzureAdGraph" section and docs/AZURE_AD_SETUP.md:
///   1. App registration (the "JobCardScanner API" one) -> API permissions -> Add a permission
///      -> Microsoft Graph -> Application permissions -> User.Read.All -> Add -> Grant admin
///      consent.
///   2. Same app registration -> Certificates &amp; secrets -> New client secret -> copy the
///      VALUE (not the secret ID) into AzureAdGraph:ClientSecret below.
/// Deliberately implemented with plain HttpClient + Graph's REST API rather than the
/// Microsoft.Graph/Azure.Identity SDKs, so no new NuGet package is required.
/// </summary>
public class AzureAdDirectoryService : IAzureAdDirectoryService
{
    private static readonly HttpClient Http = new();
    private readonly IConfiguration _config;
    private readonly IMemoryCache _cache;
    private const string CacheKey = "AzureAdDirectoryService.AllUsers";

    public AzureAdDirectoryService(IConfiguration config, IMemoryCache cache)
    {
        _config = config;
        _cache = cache;
    }

    public async Task<IReadOnlyList<AzureAdDirectoryUser>> ListUsersAsync(CancellationToken ct = default)
    {
        if (_cache.TryGetValue(CacheKey, out IReadOnlyList<AzureAdDirectoryUser>? cached) && cached is not null)
            return cached;

        var section = _config.GetSection("AzureAdGraph");
        var tenantId = section["TenantId"];
        var clientId = section["ClientId"];
        var clientSecret = section["ClientSecret"];
        if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            throw new InvalidOperationException(
                "Azure AD directory sync isn't configured yet. Fill in AzureAdGraph:ClientSecret in " +
                "appsettings.json (TenantId/ClientId are already set) - see the comment above " +
                "AzureAdDirectoryService.cs for the exact Azure Portal steps (Application permission " +
                "User.Read.All with admin consent, plus a client secret).");
        }

        var accessToken = await GetAppOnlyAccessTokenAsync(tenantId, clientId, clientSecret, ct);

        var users = new List<AzureAdDirectoryUser>();
        var url = "https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName,accountEnabled&$top=999";
        while (!string.IsNullOrEmpty(url))
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var resp = await Http.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                throw new InvalidOperationException(
                    $"Microsoft Graph rejected the directory request ({(int)resp.StatusCode} {resp.StatusCode}). " +
                    "This usually means the User.Read.All Application permission on the 'JobCardScanner API' " +
                    $"app registration hasn't been granted admin consent yet. Graph response: {body}");
            }

            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("value", out var value))
            {
                foreach (var u in value.EnumerateArray())
                {
                    var displayName = u.TryGetProperty("displayName", out var dn) ? dn.GetString() : null;
                    var mail = u.TryGetProperty("mail", out var m) ? m.GetString() : null;
                    var upn = u.TryGetProperty("userPrincipalName", out var up) ? up.GetString() : null;
                    var enabled = u.TryGetProperty("accountEnabled", out var ae) && ae.ValueKind == JsonValueKind.True;
                    var id = u.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    if (string.IsNullOrWhiteSpace(id)) continue;

                    users.Add(new AzureAdDirectoryUser(id, displayName ?? (mail ?? upn ?? "(no name)"), mail ?? upn, enabled));
                }
            }

            url = doc.RootElement.TryGetProperty("@odata.nextLink", out var next) ? next.GetString() : null;
        }

        _cache.Set(CacheKey, (IReadOnlyList<AzureAdDirectoryUser>)users, TimeSpan.FromMinutes(5));
        return users;
    }

    private static async Task<string> GetAppOnlyAccessTokenAsync(string tenantId, string clientId, string clientSecret, CancellationToken ct)
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["scope"] = "https://graph.microsoft.com/.default",
            ["grant_type"] = "client_credentials",
        });

        using var resp = await Http.PostAsync($"https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token", form, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Could not get an app-only token from Azure AD ({(int)resp.StatusCode} {resp.StatusCode}). " +
                "Double-check AzureAdGraph:ClientSecret in appsettings.json is the secret VALUE (not the " +
                $"secret ID) and hasn't expired. Azure AD response: {body}");
        }

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("access_token").GetString()!;
    }
}