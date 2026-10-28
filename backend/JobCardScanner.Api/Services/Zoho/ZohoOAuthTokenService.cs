using System.Text.Json;
using Microsoft.Extensions.Options;
using JobCardScanner.Api.Options;

namespace JobCardScanner.Api.Services.Zoho;

/// <summary>
/// 2026-10-28 ("BGauss_DMS_Zoho_Books_API_Payloads.docx", section 2): gets and caches the OAuth2 access token used on every Zoho Books API call. One access token is shared by
/// the whole process (Zoho Books access tokens are not tied to a single DMS user), refreshed proactively a few minutes before the document's stated 55-minute mark, and
/// refreshed again on demand when a call comes back HTTP 401 / code 57 ("Access token expired or wrong header... Refresh the token, retry once" - section 8).
///
/// Registered in Program.cs as a true singleton (NOT via AddHttpClient&lt;T&gt;() + AddSingleton&lt;T&gt;() - that combination registers this type twice and the second
/// registration fails to resolve a bare HttpClient; see ZOHO_BOOKS_INTEGRATION.md section 4 for why and for the corrected snippet):
///   builder.Services.Configure&lt;ZohoBooksOptions&gt;(builder.Configuration.GetSection(ZohoBooksOptions.SectionName));
///   builder.Services.AddHttpClient("ZohoOAuth");
///   builder.Services.AddSingleton&lt;ZohoOAuthTokenService&gt;(sp => new ZohoOAuthTokenService(
///       sp.GetRequiredService&lt;IHttpClientFactory&gt;().CreateClient("ZohoOAuth"),
///       sp.GetRequiredService&lt;IOptions&lt;ZohoBooksOptions&gt;&gt;(),
///       sp.GetRequiredService&lt;ILogger&lt;ZohoOAuthTokenService&gt;&gt;()));
/// </summary>
public sealed class ZohoOAuthTokenService
{
    private readonly HttpClient _http;
    private readonly ZohoBooksOptions _options;
    private readonly ILogger<ZohoOAuthTokenService> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);

    private string? _accessToken;
    private DateTime _expiresAtUtc = DateTime.MinValue;

    public ZohoOAuthTokenService(HttpClient http, IOptions<ZohoBooksOptions> options, ILogger<ZohoOAuthTokenService> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>The cached token, refreshed first if it is missing or within 5 minutes of the document's 55-minute mark. Section 2: "the DMS uses the refresh token to get an
    /// access token, which lasts 1 hour" / "refresh the token every 55 minutes" - this refreshes at 50 minutes so a slow request never straddles the expiry.</summary>
    public async Task<string> GetAccessTokenAsync(CancellationToken ct)
    {
        if (_accessToken is not null && DateTime.UtcNow < _expiresAtUtc) return _accessToken;
        return await RefreshAsync(ct);
    }

    /// <summary>Called by ZohoBooksApiClient after a call fails with HTTP 401 / code 57, to get a fresh token before retrying the call ONCE (section 8's documented rule - this
    /// service does not loop; the one-retry policy lives in ZohoBooksApiClient).</summary>
    public async Task<string> ForceRefreshAsync(CancellationToken ct)
    {
        _accessToken = null;
        return await RefreshAsync(ct);
    }

    private async Task<string> RefreshAsync(CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        try
        {
            // another caller may have already refreshed while this one was waiting on the lock
            if (_accessToken is not null && DateTime.UtcNow < _expiresAtUtc) return _accessToken;

            if (string.IsNullOrWhiteSpace(_options.ClientId) || string.IsNullOrWhiteSpace(_options.ClientSecret) || string.IsNullOrWhiteSpace(_options.RefreshToken))
                throw new InvalidOperationException(
                    "ZohoBooksApi:ClientId / ClientSecret / RefreshToken are not configured. Learnall shares these \"through a secure channel, never by email\" " +
                    "(Payloads doc, section 2) - set them as user secrets or environment variables (ZohoBooksApi__ClientSecret, ZohoBooksApi__RefreshToken), never in " +
                    "appsettings.json committed to source control.");

            var url = $"{_options.AccountsBaseUrl.TrimEnd('/')}/oauth/v2/token" +
                      $"?refresh_token={Uri.EscapeDataString(_options.RefreshToken)}" +
                      $"&client_id={Uri.EscapeDataString(_options.ClientId)}" +
                      $"&client_secret={Uri.EscapeDataString(_options.ClientSecret)}" +
                      $"&grant_type=refresh_token";

            using var resp = await _http.PostAsync(url, content: null, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogError("Zoho OAuth token refresh failed: HTTP {Status}: {Body}", (int)resp.StatusCode, Snip(body));
                throw new InvalidOperationException($"Zoho OAuth token refresh failed: HTTP {(int)resp.StatusCode}.");
            }

            var token = JsonSerializer.Deserialize<ZohoOAuthTokenResponse>(body)
                ?? throw new InvalidOperationException("Zoho OAuth token refresh returned an unreadable reply.");
            if (string.IsNullOrWhiteSpace(token.AccessToken))
                throw new InvalidOperationException("Zoho OAuth token refresh reply had no access_token.");

            _accessToken = token.AccessToken;
            var ttlSeconds = token.ExpiresInSeconds > 0 ? token.ExpiresInSeconds : 3600;
            // document says "lasts 1 hour" / "refresh every 55 minutes" - refresh 10 minutes early regardless of what expires_in actually says, so a token is never used past
            // the document's own stated safety margin
            _expiresAtUtc = DateTime.UtcNow.AddSeconds(Math.Max(60, ttlSeconds - 600));
            _logger.LogInformation("Zoho OAuth access token refreshed; next refresh due at {NextRefresh:u}.", _expiresAtUtc);
            return _accessToken;
        }
        finally { _lock.Release(); }
    }

    private static string Snip(string s) => s.Length > 300 ? s[..300] : s;
}
