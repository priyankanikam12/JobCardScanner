using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace JobCardScanner.Api.Services.Integrations;

public interface IEmailClient
{
    /// <summary>Best-effort: returns false (never throws) if Graph isn't configured yet or the
    /// send fails, so a caller can fire this alongside a more critical channel (SMS) without
    /// risking that channel on an email misconfiguration.</summary>
    Task<bool> SendAsync(string toEmail, string subject, string htmlBody, CancellationToken ct = default);
}

/// <summary>
/// Sends mail through Microsoft Graph using the API's OWN app-only identity (client-credentials),
/// NOT a signed-in user's delegated token. This matters for OTP emails specifically: they have to
/// go out for customers who were never signed into Azure AD at all (job card closure, estimate
/// approval, tracking-portal login are all customer-facing), so there is no live user token to
/// send "as". Reuses the exact same AzureAdGraph tenant/app registration/client secret that
/// AzureAdDirectoryService already uses for directory sync (see that file's doc comment) - same
/// credentials, but this needs a SEPARATE Application permission consented on top of that one's
/// User.Read.All:
///
///   Azure Portal -> App registrations -> JobCardScanner API -> API permissions -> Add a
///   permission -> Microsoft Graph -> Application permissions -> Mail.Send -> Add permissions ->
///   Grant admin consent.
///
/// AzureAdGraph:SenderMailbox (appsettings.json) must be a real, licensed Exchange Online mailbox
/// address - app-only Graph sends "as" that specific mailbox via POST
/// /v1.0/users/{mailbox}/sendMail (there is no "me" to send as without a signed-in user), which
/// 404s/403s if that mailbox doesn't actually exist or isn't licensed for Exchange.
///
/// Deliberately plain HttpClient, no Microsoft.Graph/Azure.Identity SDK, matching
/// AzureAdDirectoryService for the same reason (no new NuGet package needed, and this sandbox/dev
/// environment can't reach NuGet to add one anyway).
/// </summary>
public class GraphEmailClient : IntegrationClientBase, IEmailClient
{
    private static readonly HttpClient Http = new();
    private readonly IConfiguration _config;
    private readonly ILogger<GraphEmailClient> _logger;

    public GraphEmailClient(JobCardScannerDbContext db, IConfiguration config, ILogger<GraphEmailClient> logger) : base(db, logger)
    {
        _config = config;
        _logger = logger;
    }

    public async Task<bool> SendAsync(string toEmail, string subject, string htmlBody, CancellationToken ct = default)
    {
        var section = _config.GetSection("AzureAdGraph");
        var tenantId = section["TenantId"];
        var clientId = section["ClientId"];
        var clientSecret = section["ClientSecret"];
        var sender = section["SenderMailbox"];
        if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId) ||
            string.IsNullOrWhiteSpace(clientSecret) || string.IsNullOrWhiteSpace(sender))
        {
            _logger.LogWarning(
                "Email skipped for {To}: AzureAdGraph:SenderMailbox isn't configured yet in appsettings.json " +
                "(TenantId/ClientId/ClientSecret are shared with directory sync - SenderMailbox is new).", toEmail);
            return false;
        }

        try
        {
            return await ExecuteAsync(IntegrationSystem.Email, "POST /users/{sender}/sendMail", new { to = toEmail, subject }, async () =>
            {
                var accessToken = await GetAppOnlyAccessTokenAsync(tenantId, clientId, clientSecret, ct);

                var payload = new
                {
                    message = new
                    {
                        subject,
                        body = new { contentType = "HTML", content = htmlBody },
                        toRecipients = new[] { new { emailAddress = new { address = toEmail } } },
                    },
                    saveToSentItems = false,
                };

                using var req = new HttpRequestMessage(
                    HttpMethod.Post, $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(sender)}/sendMail")
                { Content = JsonContent.Create(payload) };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

                using var resp = await Http.SendAsync(req, ct);
                if (!resp.IsSuccessStatusCode)
                {
                    var body = await resp.Content.ReadAsStringAsync(ct);
                    throw new InvalidOperationException(
                        $"Graph sendMail {(int)resp.StatusCode} {resp.StatusCode} (sender {sender}): {body}");
                }
                return true;
            });
        }
        catch (Exception ex)
        {
            // Email is a best-effort ADDITION to SMS, not a replacement - Mail.Send not consented
            // yet, the sender mailbox not existing, or a transient Graph error must never take
            // down the OTP flow itself. ExecuteAsync already retried (see IntegrationClientBase)
            // and logged the failure to IntegrationLogEntries before rethrowing; this is just
            // where that final "give up" gets swallowed instead of bubbling to the caller.
            _logger.LogWarning(ex, "Email send failed for {To} (non-fatal - other channels unaffected).", toEmail);
            return false;
        }
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
            throw new InvalidOperationException($"Could not get an app-only Graph token ({(int)resp.StatusCode} {resp.StatusCode}): {body}");

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("access_token").GetString()!;
    }
}