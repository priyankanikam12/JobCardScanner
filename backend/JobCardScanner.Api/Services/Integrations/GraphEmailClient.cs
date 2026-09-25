using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services.Integrations;

/// <summary>One file to attach to an outgoing email - see IEmailClient.SendAsync's optional
/// attachment parameter. Matches the shape Microsoft Graph's sendMail expects
/// (fileAttachment: name/contentType/contentBytes), kept provider-agnostic here so callers don't
/// need to know that.</summary>
public record EmailAttachment(string FileName, string ContentType, byte[] Bytes);

/// <summary>Wire shape for one entry in Graph sendMail's `message.attachments` array
/// (https://learn.microsoft.com/graph/api/resources/fileattachment) - a plain record (not an
/// anonymous object like the rest of GraphEmailClient's payload) purely because "@odata.type"
/// isn't expressible as a C# identifier without [JsonPropertyName].</summary>
internal record GraphFileAttachment(
    [property: JsonPropertyName("@odata.type")] string OdataType,
    // Lowercase-first C# property names (not the usual PascalCase) so the default
    // JsonSerializerOptions (no naming policy - property names serialize exactly as declared)
    // emits "name"/"contentType"/"contentBytes" the way Graph expects, matching how the rest of
    // this payload is already written as camelCase anonymous-object members for the same reason.
    string name,
    string contentType,
    string contentBytes);

/// <summary>Result of one SendAsync call - <c>Success</c> mirrors the old bool-only return, and
/// <c>Error</c> (2026-09-07) carries the actual failure reason (the Graph HTTP error body, the
/// token-endpoint error, or "not configured yet") instead of forcing every caller to go dig it out
/// of IntegrationLogEntries. OtpService's OTP-email path only reads Success (email is best-effort
/// there, SMS is the channel that matters); JobCardsController.EmailEstimate surfaces Error
/// straight back to the caller, since a failed "email the estimate" IS the whole request.</summary>
public record EmailSendResult(bool Success, string? Error);

public interface IEmailClient
{
    /// <summary>Best-effort: returns Success=false (never throws) if Graph isn't configured yet or
    /// the send fails, so a caller can fire this alongside a more critical channel (SMS) without
    /// risking that channel on an email misconfiguration - see EmailSendResult's doc comment for
    /// why Error exists alongside Success. `attachment` is optional - added for the Estimates
    /// Amount "email with attached PDF" feature (JobCardsController.EmailEstimate); the original
    /// OTP-email caller (OtpService) passes none and is unaffected.
    ///
    /// `fromMailbox` (2026-09-24, "mail going from fixed mailid... which user logged from this
    /// logged user mailid wants to sent mail add this") - optional override for which mailbox
    /// Graph sends "as" (see GraphEmailClient's class doc comment for how this is used and its one
    /// real caveat re: Exchange Application Access Policy). Null/blank falls back to the
    /// configured AzureAdGraph:SenderMailbox default - this is what OtpService's OTP-email path
    /// keeps doing unchanged, since a customer OTP has no signed-in staff user to send "as".</summary>
    Task<EmailSendResult> SendAsync(string toEmail, string subject, string htmlBody, EmailAttachment? attachment = null, string? fromMailbox = null, CancellationToken ct = default);
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
/// 2026-09-24 CHANGE ("mail going from fixed mailid currently... which user logged from this
/// logged user mailid wants to sent mail add this"): SendAsync's `fromMailbox` parameter, when
/// given, is sent "as" INSTEAD of the configured SenderMailbox - JobCardsController.EmailEstimate
/// passes the signed-in staff user's own Users.Email (via ICurrentUserService.Email) so the
/// Estimate email goes out from that person's real mailbox rather than one fixed address for
/// everyone. This works through the exact same app-only Mail.Send permission as before - Graph's
/// application-permission Mail.Send is NOT scoped to one mailbox by default, it can send "as" any
/// mailbox in the tenant. ONE CAVEAT worth flagging to whoever manages the Azure/Exchange tenant:
/// if an Exchange Online "Application Access Policy" has been set up to restrict this app's
/// Mail.Send to specific mailboxes (a common tenant-hardening step, and not something visible from
/// this code), sending "as" a staff member outside that policy's scope will fail with a 403
/// ErrorAccessDenied - which SendAsync already surfaces as EmailSendResult.Error, so it fails
/// loud/visibly rather than silently, but widening that policy (if one exists) is an Exchange
/// admin-center change, not something this code can do. Every staff mailbox must also actually be
/// a real, licensed Exchange Online mailbox for the same reason the single SenderMailbox needed to
/// be (see the paragraph above) - a staff User.Email that isn't a real mailbox (e.g. a
/// locally-created login not backed by an Exchange account) will 404 the same way.
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

    public async Task<EmailSendResult> SendAsync(string toEmail, string subject, string htmlBody, EmailAttachment? attachment = null, string? fromMailbox = null, CancellationToken ct = default)
    {
        var section = _config.GetSection("AzureAdGraph");
        var tenantId = section["TenantId"];
        var clientId = section["ClientId"];
        var clientSecret = section["ClientSecret"];
        // fromMailbox (the signed-in staff user's own mailbox, when the caller has one - see
        // JobCardsController.EmailEstimate) wins over the configured default; blank/whitespace is
        // treated the same as "not passed" so a caller can pass ICurrentUserService.Email straight
        // through even when it's null for an unauthenticated/customer-context call.
        var sender = string.IsNullOrWhiteSpace(fromMailbox) ? section["SenderMailbox"] : fromMailbox;
        if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId) ||
            string.IsNullOrWhiteSpace(clientSecret) || string.IsNullOrWhiteSpace(sender))
        {
            const string notConfiguredError = "AzureAdGraph:SenderMailbox isn't configured yet in appsettings.json " +
                "(TenantId/ClientId/ClientSecret are shared with directory sync - SenderMailbox is new).";
            _logger.LogWarning("Email skipped for {To}: {Error}", toEmail, notConfiguredError);
            return new EmailSendResult(false, notConfiguredError);
        }

        try
        {
            await ExecuteAsync(IntegrationSystem.Email, "POST /users/{sender}/sendMail", new { to = toEmail, subject, hasAttachment = attachment != null, sender }, async () =>
            {
                var accessToken = await GetAppOnlyAccessTokenAsync(tenantId, clientId, clientSecret, ct);

                var payload = new
                {
                    message = new
                    {
                        subject,
                        body = new { contentType = "HTML", content = htmlBody },
                        toRecipients = new[] { new { emailAddress = new { address = toEmail } } },
                        // Graph's fileAttachment shape - contentBytes is base64, exactly what
                        // Convert.ToBase64String gives us from the PDF's raw bytes. Omitted
                        // entirely (not an empty array) when there's nothing to attach, matching
                        // every other optional Graph field in this payload. "@odata.type" isn't a
                        // legal C# identifier, hence the dedicated GraphFileAttachment record with
                        // a [JsonPropertyName] below instead of an anonymous object like the rest
                        // of this payload.
                        attachments = attachment == null ? null : new[]
                        {
                            new GraphFileAttachment(
                                "#microsoft.graph.fileAttachment",
                                attachment.FileName,
                                attachment.ContentType,
                                Convert.ToBase64String(attachment.Bytes)),
                        },
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
            return new EmailSendResult(true, null);
        }
        catch (Exception ex)
        {
            // Email is a best-effort ADDITION to SMS, not a replacement - Mail.Send not consented
            // yet, the sender mailbox not existing, or a transient Graph error must never take
            // down the OTP flow itself. ExecuteAsync already retried (see IntegrationClientBase)
            // and logged the failure to IntegrationLogEntries before rethrowing; this is just
            // where that final "give up" gets swallowed instead of bubbling to the caller. ex.Message
            // (2026-09-07: now returned, not just logged) is the real diagnostic - for a Graph HTTP
            // failure this is the exact string built above ("Graph sendMail 404/403/... (sender
            // ...): <response body>"), which is what actually tells apart "Mail.Send not consented",
            // "SenderMailbox isn't a real/licensed Exchange Online mailbox" (404 ResourceNotFound /
            // 403 ErrorAccessDenied - see this class's header doc comment), a bad ClientSecret, or a
            // genuine transient Graph outage.
            _logger.LogWarning(ex, "Email send failed for {To} (non-fatal - other channels unaffected).", toEmail);
            return new EmailSendResult(false, ex.Message);
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
