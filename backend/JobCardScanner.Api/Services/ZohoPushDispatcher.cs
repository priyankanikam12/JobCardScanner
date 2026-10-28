using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using JobCardScanner.Api.Data;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using JobCardScanner.Api.Services.Zoho;
using JobCardScanner.Api.Options;

namespace JobCardScanner.Api.Services;

/// <summary>
/// 2026-10-14 ("we want PUSH API"): sends the queued events (ZohoPushStore / dbo.ZohoPushOutbox) to Zoho and retries the ones Zoho could not take. Two ways it runs:
///   * as a background service (AddHostedService&lt;ZohoPushDispatcher&gt;() in Program.cs) every ZohoPush:IntervalSeconds (default 30), and
///   * on demand: POST /api/zoho-push/run (ZohoPushController) calls ZohoPushDispatcher.RunOnceAsync.
/// A static lock makes sure two runs never send the same event twice.
///
/// appsettings.json (ConnectionStrings are untouched), section "ZohoPush" - all values come from Zoho:
///   Enabled         true / false (default false - nothing is sent until this is true AND BaseUrl is set; events are still queued)
///   BaseUrl         e.g. https://zoho.example.com/api/bgauss          (no trailing slash needed)
///   CustomersPath   default /customers        - customer.created / .updated / .deleted events are POSTed to BaseUrl + CustomersPath
///   ItemsPath       default /items            - item.created / .updated events are POSTed to BaseUrl + ItemsPath
///   Headers         authentication / extra headers Zoho wants, as name: value pairs, e.g. "Headers": { "X-API-Key": "...", "Authorization": "Bearer ..." }
///   SigningSecret   optional - when set, every request carries X-BGauss-Signature: sha256=hex(HMAC-SHA256(body, secret)) so Zoho can verify it came from BGauss
///   IntervalSeconds default 30        MaxAttempts default 8        BatchSize default 50
/// LIVE: every event is sent with an HTTP POST. ZohoPushStore.EnqueueAsync calls Nudge() right after it queues an event, which wakes this loop immediately, so a customer saved in BGauss reaches Zoho within a
/// second or two (the IntervalSeconds timer only paces RETRIES and anything queued while the push was off). Needs the hosted service registered in Program.cs.
/// BULK MODE ("we cant post bulk data?"): ZohoPush:Mode = "bulk" sends many events in ONE POST instead of one per request - up to ZohoPush:BulkSize (default 100, max 1000) events of the same kind, to
///   ZohoPush:ItemsBulkPath (default /items/bulk) / ZohoPush:CustomersBulkPath (default /customers/bulk). Body: { batchId, entity, event: "item.batch" | "customer.batch", sentAt, source, count, events: [ the normal
///   single-event envelopes ] }; headers X-BGauss-Event (item.batch / customer.batch) and X-BGauss-Batch-Id. Live updates still work: a change queued on its own goes out at once as a batch of one, while a
///   first load or a backlog goes out 100 at a time. Answer 2xx = every event in the batch accepted; to refuse single events answer 2xx with { "failed": [ { "eventId": "...", "error": "..." } ] } - those are marked
///   rejected (not retried) and the rest delivered. Any other non-2xx = the WHOLE batch is retried by the rules below. Default mode is "single" (unchanged).
/// Delivery rules: 2xx = delivered. 408 / 429 / 5xx / timeout / network error = retried after 1 min, 5 min, 15 min, 1 h, 6 h, 12 h, 24 h (up to MaxAttempts).
/// Any other 4xx = Zoho rejected the event: it is NOT retried automatically (status Failed, the reason is stored) - fix it and press "retry failed".
/// Headers on every request: Content-Type: application/json, X-BGauss-Event (event name), X-BGauss-Event-Id (the eventId in the body - use it as the idempotency key).
///
/// 2026-10-28: a THIRD provider mode was added alongside the two below - ZohoPush:Provider = "ZohoBooksDirect" - which calls Zoho Books' own REST API directly via the new
/// ZohoBooksApiClient (OAuth2, Zoho's real field names and reply shape - see ZOHO_BOOKS_INTEGRATION.md). It is additive: the two modes below are completely unchanged and
/// still work exactly as before if ZohoPush:Provider is left unset or set to "ZohoBooks".
/// </summary>
public class ZohoPushDispatcher : BackgroundService
{
    private static readonly SemaphoreSlim RunLock = new(1, 1);
    private static readonly SemaphoreSlim WakeSignal = new(0, int.MaxValue);
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private static readonly int[] BackoffMinutes = { 1, 5, 15, 60, 360, 720, 1440 };

    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _config;
    private readonly ILogger<ZohoPushDispatcher> _logger;

    public ZohoPushDispatcher(IServiceScopeFactory scopes, IConfiguration config, ILogger<ZohoPushDispatcher> logger,
        ZohoBooksApiClient zohoBooksClient, IOptions<ZohoBooksOptions> zohoBooksOptions)
    {
        _scopes = scopes;
        _config = config;
        _logger = logger;
        ZohoPushStore.Configure(config);
        ConfigureZohoBooksDirect(zohoBooksClient, zohoBooksOptions);
    }

    // 2026-10-28: static handoff (same pattern as ZohoPushStore.Configure) so the static RunOnceAsync - already called directly by ZohoPushController / ZohoPushOpsController
    // without an instance of this class - can reach the new direct-API client too. Set once, here, when the hosted service is constructed at start-up.
    private static ZohoBooksApiClient? _zohoBooksClient;
    private static IOptions<ZohoBooksOptions>? _zohoBooksOptions;
    public static void ConfigureZohoBooksDirect(ZohoBooksApiClient client, IOptions<ZohoBooksOptions> options)
    {
        _zohoBooksClient = client;
        _zohoBooksOptions = options;
    }

    /// <summary>Wakes the dispatcher loop now (called right after an event is queued) so the event goes out immediately instead of at the next timer tick.</summary>
    public static void Nudge()
    {
        if (WakeSignal.CurrentCount == 0) WakeSignal.Release();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); } catch (OperationCanceledException) { return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
                await RunOnceAsync(db, _config, _logger, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Zoho push: a dispatcher cycle failed.");
            }
            var seconds = Math.Max(5, _config.GetValue("ZohoPush:IntervalSeconds", 30));
            // sleeps until the next timer tick OR until Nudge() says a new event was queued, whichever comes first
            try { await WakeSignal.WaitAsync(TimeSpan.FromSeconds(seconds), stoppingToken); } catch (OperationCanceledException) { return; }
            while (WakeSignal.CurrentCount > 0) WakeSignal.Wait(0);   // several events queued together = one run
        }
    }

    /// <summary>2026-10-28: Provider = "ZohoBooksDirect" - the new direct-API mode (ZohoBooksApiClient / OAuth2), separate from the "ZohoBooks" webhook mode below.</summary>
    public static bool IsZohoBooksDirect(IConfiguration config) => string.Equals(config["ZohoPush:Provider"], "ZohoBooksDirect", StringComparison.OrdinalIgnoreCase);

    public static bool IsConfigured(IConfiguration config) =>
        config.GetValue("ZohoPush:Enabled", false)
        && (IsZohoBooksDirect(config)
            ? _zohoBooksClient is not null && !string.IsNullOrWhiteSpace(_zohoBooksOptions?.Value.OrganizationId)
            : IsZohoBooks(config)
                ? !string.IsNullOrWhiteSpace(config["ZohoPush:ItemsUrl"]) || !string.IsNullOrWhiteSpace(config["ZohoPush:CustomersUrl"])
                : !string.IsNullOrWhiteSpace(config["ZohoPush:BaseUrl"]));

    private static DateTime? RetryAt(bool retryable, int attemptNo, int maxAttempts) =>
        retryable && attemptNo < maxAttempts ? DateTime.UtcNow.AddMinutes(BackoffMinutes[Math.Min(attemptNo - 1, BackoffMinutes.Length - 1)]) : null;

    /// <summary>Sends every due event (one request per event, or batches in bulk mode) and keeps going until nothing is due. Returns (sent, failedThisRun). Does nothing when the push is not enabled / configured.</summary>
    public static async Task<(int Sent, int Failed)> RunOnceAsync(JobCardScannerDbContext db, IConfiguration config, ILogger logger, CancellationToken ct)
    {
        if (!IsConfigured(config)) return (0, 0);
        if (IsZohoBooksDirect(config))
        {
            if (_zohoBooksClient is null || _zohoBooksOptions is null)
            {
                logger.LogError("Zoho push: ZohoPush:Provider is ZohoBooksDirect but ZohoBooksApiClient was never configured (DI registration missing in Program.cs - see ZOHO_BOOKS_INTEGRATION.md section 4).");
                return (0, 0);
            }
            return await ZohoBooksDirectRunner.RunAsync(db, _zohoBooksClient, _zohoBooksOptions, logger, ct);   // new direct-API path - items only for now, see ZohoBooksDirectRunner's own doc comment
        }
        if (IsZohoBooks(config)) return await RunZohoBooksAsync(db, config, logger, ct);   // Learnall's Zoho Books webhook: its own URL / reply rules
        if (!await RunLock.WaitAsync(0, ct)) return (0, 0);   // another run is in progress
        try
        {
            var bulk = string.Equals(config["ZohoPush:Mode"], "bulk", StringComparison.OrdinalIgnoreCase);
            var bulkSize = Math.Clamp(config.GetValue("ZohoPush:BulkSize", 100), 1, 1000);
            var fetch = bulk ? bulkSize * 5 : Math.Clamp(config.GetValue("ZohoPush:BatchSize", 50), 1, 500);
            var maxAttempts = Math.Max(1, config.GetValue("ZohoPush:MaxAttempts", 8));
            int sent = 0, failed = 0;

            for (var loop = 0; loop < 100; loop++)   // drains a big backlog (a first load) without waiting for the next timer tick
            {
                var rows = await ZohoPushStore.GetDueAsync(db, fetch, ct);
                if (rows.Count == 0) break;
                var stop = false;

                if (!bulk)
                {
                    foreach (var row in rows)
                    {
                        var (ok, status, error, retryable, _) = await SendAsync(config, row.EntityType, row.PayloadJson, row.EventName, "X-BGauss-Event-Id", row.EventId.ToString(), null, ct);
                        if (ok) { await ZohoPushStore.MarkSentAsync(db, row.Id, status ?? 200, ct); sent++; continue; }
                        failed++;
                        var attemptNo = row.Attempts + 1;
                        var retryAt = RetryAt(retryable, attemptNo, maxAttempts);
                        await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, status, error ?? "unknown error", retryAt, ct);
                        logger.LogWarning("Zoho push: {Event} {Key} failed (attempt {Attempt}, HTTP {Status}): {Error} - {Next}",
                            row.EventName, row.EntityKey, attemptNo, status, error, retryAt.HasValue ? $"retry at {retryAt:u}" : "given up");
                        if (retryable) { stop = true; break; }   // Zoho is down / throttling: stop instead of hammering it
                    }
                }
                else
                {
                    foreach (var group in rows.GroupBy(r => r.EntityType))
                    {
                        foreach (var chunk in group.Chunk(bulkSize))
                        {
                            var batchId = Guid.NewGuid();
                            var eventName = group.Key == "Item" ? "item.batch" : "customer.batch";
                            var body = BuildBatchBody(batchId, group.Key, eventName, chunk);
                            var (ok, status, error, retryable, rejected) = await SendAsync(config, group.Key, body, eventName, "X-BGauss-Batch-Id", batchId.ToString(), true, ct);
                            if (ok)
                            {
                                foreach (var row in chunk)
                                {
                                    if (rejected.TryGetValue(row.EventId, out var why))
                                    {
                                        failed++;
                                        await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, status, $"Rejected by Zoho in a batch: {why}", null, ct);
                                    }
                                    else { sent++; await ZohoPushStore.MarkSentAsync(db, row.Id, status ?? 200, ct); }
                                }
                                continue;
                            }
                            foreach (var row in chunk)
                            {
                                failed++;
                                var attemptNo = row.Attempts + 1;
                                await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, status, error ?? "unknown error", RetryAt(retryable, attemptNo, maxAttempts), ct);
                            }
                            logger.LogWarning("Zoho push: a batch of {Count} {Entity} event(s) failed (HTTP {Status}): {Error} - {Next}",
                                chunk.Length, group.Key, status, error, retryable ? "will be retried" : "given up");
                            if (retryable) { stop = true; break; }
                        }
                        if (stop) break;
                    }
                }
                if (stop) break;
            }
            return (sent, failed);
        }
        finally { RunLock.Release(); }
    }


    // ======================================================================================================================================================================================
    // ZOHO BOOKS MODE (2026-10-16) - ZohoPush:Provider = "ZohoBooks". Built from Learnall's "Zoho Books Item Push - Details for BGauss":
    //   * the URL Zoho gave (the key is INSIDE it) is used exactly as it is - ZohoPush:ItemsUrl - for single AND bulk; NO auth header is sent (ZohoPush:Headers is ignored); keep the URL out of source control
    //     (environment variable  ZohoPush__ItemsUrl  or user secrets). Customers are only sent if ZohoPush:CustomersUrl is set - until then customer events simply stay queued.
    //   * the decision comes from the reply BODY, not the HTTP status: 201 + response.code 0 = delivered; 1 = rejected (Failed, kept, reason stored); 2 = temporary (retry on the schedule); 400 = rejected;
    //     401 / code 57 = wrong or old URL key -> the push PAUSES (nothing is consumed) until Resume; 408 / 429 / 5xx / timeout = retry. Bulk: response.failed lists the events that did not make it
    //     (code 1 rejected, code 2 retry that event); events not listed were delivered.
    //   * "Logged only - nothing created in Books" (Zoho's test mode) is NOT delivery: the event is parked as LoggedOnly and re-sent after go-live (POST .../requeue-logged-only).
    //   * bulk batches are capped at 20 items with at least PauseBetweenBatchesSeconds (default 15) between batches; single mode waits PauseBetweenRequestsMs (default 700) between requests -
    //     Zoho Books allows 100 API calls a minute and each item needs about one.
    // ======================================================================================================================================================================================
    public static bool IsZohoBooks(IConfiguration config) => string.Equals(config["ZohoPush:Provider"], "ZohoBooks", StringComparison.OrdinalIgnoreCase);

    /// <summary>Set when Zoho answered 401 (wrong / old URL key): nothing is sent until someone calls Resume (POST .../resume) after getting the current URL from Learnall.</summary>
    public static string? PauseReason { get; private set; }
    public static void Resume() => PauseReason = null;

    private enum Outcome { Delivered, LoggedOnly, Rejected, Retry, AuthFailed }

    private static string Snip(string? s) => string.IsNullOrEmpty(s) ? "" : (s.Length > 300 ? s[..300] : s);

    /// <summary>Turns Zoho's reply into one outcome per event of the request.</summary>
    private static Dictionary<long, (Outcome Outcome, string? Detail)> InterpretZoho(int? status, string? body, string? netError, ZohoPushStore.OutboxRow[] rows, bool bulk)
    {
        var res = new Dictionary<long, (Outcome, string?)>();
        void All(Outcome o, string? d) { foreach (var r in rows) res[r.Id] = (o, d); }

        if (status is null) { All(Outcome.Retry, netError ?? "no answer from Zoho"); return res; }
        if (status == 401) { All(Outcome.AuthFailed, "HTTP 401: " + Snip(body)); return res; }
        if (status == 400) { All(Outcome.Rejected, "HTTP 400: " + Snip(body)); return res; }
        if (status is 408 or 429 or >= 500) { All(Outcome.Retry, $"HTTP {status}: " + Snip(body)); return res; }
        if (status is < 200 or >= 300) { All(Outcome.Rejected, $"HTTP {status}: " + Snip(body)); return res; }

        try
        {
            using var doc = JsonDocument.Parse(body ?? "");
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) { All(Outcome.Retry, "unreadable reply: " + Snip(body)); return res; }
            if (root.TryGetProperty("code", out var top) && top.ValueKind == JsonValueKind.Number && top.TryGetInt32(out var topCode) && topCode != 0)
            {
                All(Outcome.Rejected, $"Zoho code {topCode}: " + (root.TryGetProperty("message", out var tm) ? tm.GetString() : null));
                return res;
            }
            if (!root.TryGetProperty("response", out var resp) || resp.ValueKind != JsonValueKind.Object) { All(Outcome.Retry, "unreadable reply (no response object): " + Snip(body)); return res; }

            var code = resp.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.Number && c.TryGetInt32(out var ci) ? ci : -99;
            var message = resp.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
            var version = resp.TryGetProperty("version", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            var logOnly = string.Equals(version, "v1-log-only", StringComparison.OrdinalIgnoreCase) || (message?.StartsWith("Logged only", StringComparison.OrdinalIgnoreCase) ?? false);

            switch (code)
            {
                case 0:
                    All(logOnly ? Outcome.LoggedOnly : Outcome.Delivered, message);
                    if (bulk && resp.TryGetProperty("failed", out var failed) && failed.ValueKind == JsonValueKind.Array)
                        foreach (var f in failed.EnumerateArray())
                        {
                            if (f.ValueKind != JsonValueKind.Object || !f.TryGetProperty("eventId", out var idEl) || !Guid.TryParse(idEl.GetString(), out var eid)) continue;
                            var row = rows.FirstOrDefault(r => r.EventId == eid);
                            if (row is null) continue;
                            var fcode = f.TryGetProperty("code", out var fc) && fc.TryGetInt32(out var fci) ? fci : 1;
                            var err = f.TryGetProperty("error", out var fe) ? fe.GetString() : null;
                            res[row.Id] = (fcode == 2 ? Outcome.Retry : Outcome.Rejected, $"code {fcode}: {err}");
                        }
                    break;
                case 1: All(Outcome.Rejected, message); break;
                case 2: All(Outcome.Retry, message); break;
                default: All(Outcome.Retry, $"unexpected response.code {code}: {message}"); break;
            }
        }
        catch (JsonException) { All(Outcome.Retry, "unreadable reply (not JSON): " + Snip(body)); }
        return res;
    }

    private static async Task<(int? Status, string? Body, string? NetError)> PostRawAsync(string url, string body, string eventName, string idHeaderName, string idValue, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(body, Encoding.UTF8) };
            req.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
            req.Headers.TryAddWithoutValidation("X-BGauss-Event", eventName);
            req.Headers.TryAddWithoutValidation(idHeaderName, idValue);   // no X-API-Key / Authorization: the key is in the URL
            using var resp = await Http.SendAsync(req, ct);
            return ((int)resp.StatusCode, await resp.Content.ReadAsStringAsync(ct), null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { return (null, null, $"{ex.GetType().Name}: {ex.GetBaseException().Message}"); }   // the message never contains the URL's query string (the key)
    }

    private static async Task<(int Sent, int Failed)> RunZohoBooksAsync(JobCardScannerDbContext db, IConfiguration config, ILogger logger, CancellationToken ct)
    {
        if (PauseReason is not null) return (0, 0);
        if (!await RunLock.WaitAsync(0, ct)) return (0, 0);
        try
        {
            var urls = new Dictionary<string, string>();
            if (!string.IsNullOrWhiteSpace(config["ZohoPush:ItemsUrl"])) urls["Item"] = config["ZohoPush:ItemsUrl"]!.Trim();
            if (!string.IsNullOrWhiteSpace(config["ZohoPush:CustomersUrl"])) urls["Customer"] = config["ZohoPush:CustomersUrl"]!.Trim();
            if (urls.Count == 0) return (0, 0);

            var bulk = string.Equals(config["ZohoPush:Mode"], "bulk", StringComparison.OrdinalIgnoreCase);
            var bulkSize = Math.Clamp(config.GetValue("ZohoPush:BulkSize", 20), 1, 20);   // Zoho: at most 20 items per request
            var pauseBatchMs = Math.Max(0, config.GetValue("ZohoPush:PauseBetweenBatchesSeconds", 15)) * 1000;
            var pauseRequestMs = Math.Max(0, config.GetValue("ZohoPush:PauseBetweenRequestsMs", 700));
            var maxAttempts = Math.Max(1, config.GetValue("ZohoPush:MaxAttempts", 8));
            var fetch = bulk ? bulkSize * 5 : 50;
            int sent = 0, failed = 0, logOnlyCount = 0;
            var first = true;

            for (var loop = 0; loop < 400; loop++)
            {
                var rows = await ZohoPushStore.GetDueAsync(db, fetch, ct, urls.Keys.ToArray());
                if (rows.Count == 0) break;
                var requests = bulk
                    ? rows.GroupBy(r => r.EntityType).SelectMany(g => g.Chunk(bulkSize).Select(chunk => (Entity: g.Key, Rows: chunk)))
                    : rows.Select(r => (Entity: r.EntityType, Rows: new[] { r }));

                var stop = false;
                foreach (var (entity, chunk) in requests)
                {
                    if (!first) { try { await Task.Delay(bulk ? pauseBatchMs : pauseRequestMs, ct); } catch (OperationCanceledException) { throw; } }
                    first = false;

                    string body, eventName, idHeader, idValue;
                    if (bulk)
                    {
                        var batchId = Guid.NewGuid();
                        eventName = entity == "Item" ? "item.batch" : "customer.batch";
                        body = BuildBatchBody(batchId, entity, eventName, chunk);
                        idHeader = "X-BGauss-Batch-Id"; idValue = batchId.ToString();
                    }
                    else { body = chunk[0].PayloadJson; eventName = chunk[0].EventName; idHeader = "X-BGauss-Event-Id"; idValue = chunk[0].EventId.ToString(); }

                    var (status, replyBody, netError) = await PostRawAsync(urls[entity], body, eventName, idHeader, idValue, ct);
                    var outcomes = InterpretZoho(status, replyBody, netError, chunk, bulk);

                    var authFailed = false;
                    foreach (var row in chunk)
                    {
                        var (outcome, detail) = outcomes[row.Id];
                        switch (outcome)
                        {
                            case Outcome.Delivered: await ZohoPushStore.MarkSentAsync(db, row.Id, status ?? 201, ct); sent++; break;
                            case Outcome.LoggedOnly: await ZohoPushStore.MarkLoggedOnlyAsync(db, row.Id, status ?? 201, detail, ct); logOnlyCount++; break;
                            case Outcome.Rejected:
                                await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, status, detail ?? "rejected by Zoho", null, ct); failed++;
                                logger.LogWarning("Zoho push: {Event} {Key} rejected: {Detail}", row.EventName, row.EntityKey, detail);
                                break;
                            case Outcome.Retry:
                                var attemptNo = row.Attempts + 1;
                                await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, status, detail ?? "retry", RetryAt(true, attemptNo, maxAttempts), ct); failed++; stop = true;
                                logger.LogWarning("Zoho push: {Event} {Key} will be retried (attempt {Attempt}): {Detail}", row.EventName, row.EntityKey, attemptNo, detail);
                                break;
                            case Outcome.AuthFailed: authFailed = true; break;
                        }
                    }
                    if (authFailed)
                    {
                        PauseReason = "Zoho answered 401 (wrong or old URL key). Get the current URL from Learnall, update ZohoPush:ItemsUrl, then call POST /api/zoho-push-ops/resume.";
                        logger.LogError("Zoho push PAUSED: {Reason}", PauseReason);
                        return (sent, failed);
                    }
                    if (stop) break;   // Zoho is temporarily unavailable or at its API limit: stop this run, the events are retried on the schedule
                }
                if (stop) break;
            }
            if (logOnlyCount > 0) logger.LogInformation("Zoho push: {Count} event(s) were only LOGGED by Zoho (test mode) - parked as LoggedOnly, not delivered.", logOnlyCount);
            return (sent, failed);
        }
        finally { RunLock.Release(); }
    }

    /// <summary>{ batchId, entity, event, sentAt, source, count, events: [ the stored single-event envelopes, as they are ] }</summary>
    private static string BuildBatchBody(Guid batchId, string entity, string eventName, ZohoPushStore.OutboxRow[] chunk)
    {
        var sb = new StringBuilder(256 + chunk.Sum(r => r.PayloadJson.Length + 1));
        sb.Append("{\"batchId\":\"").Append(batchId).Append("\",\"entity\":\"").Append(entity).Append("\",\"event\":\"").Append(eventName)
          .Append("\",\"sentAt\":\"").Append(DateTime.UtcNow.ToString("o")).Append("\",\"source\":\"BGAUSS-DMS\",\"count\":").Append(chunk.Length).Append(",\"events\":[");
        sb.Append(string.Join(",", chunk.Select(r => r.PayloadJson)));
        sb.Append("]}");
        return sb.ToString();
    }

    private static async Task<(bool Ok, int? Status, string? Error, bool Retryable, Dictionary<Guid, string> Rejected)> SendAsync(
        IConfiguration config, string entityType, string body, string eventName, string idHeaderName, string idValue, bool? bulk, CancellationToken ct)
    {
        var rejected = new Dictionary<Guid, string>();
        var baseUrl = config["ZohoPush:BaseUrl"]!.TrimEnd('/');
        string path;
        if (bulk == true) path = entityType == "Item" ? config["ZohoPush:ItemsBulkPath"] ?? "/items/bulk" : config["ZohoPush:CustomersBulkPath"] ?? "/customers/bulk";
        else path = entityType == "Item" ? config["ZohoPush:ItemsPath"] ?? "/items" : config["ZohoPush:CustomersPath"] ?? "/customers";
        if (!path.StartsWith('/')) path = "/" + path;

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + path)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            req.Headers.TryAddWithoutValidation("X-BGauss-Event", eventName);
            req.Headers.TryAddWithoutValidation(idHeaderName, idValue);
            foreach (var h in config.GetSection("ZohoPush:Headers").GetChildren())
                if (!string.IsNullOrWhiteSpace(h.Key) && !string.IsNullOrEmpty(h.Value)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
            var secret = config["ZohoPush:SigningSecret"];
            if (!string.IsNullOrEmpty(secret))
            {
                using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
                req.Headers.TryAddWithoutValidation("X-BGauss-Signature", "sha256=" + Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant());
            }

            using var resp = await Http.SendAsync(req, ct);
            var code = (int)resp.StatusCode;
            var text = await resp.Content.ReadAsStringAsync(ct);
            if (code is >= 200 and < 300)
            {
                // bulk only: { "failed": [ { "eventId": "...", "error": "..." } ] } lets Zoho refuse single events while accepting the rest
                if (bulk == true && !string.IsNullOrWhiteSpace(text))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(text);
                        if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("failed", out var f) && f.ValueKind == JsonValueKind.Array)
                            foreach (var item in f.EnumerateArray())
                                if (item.TryGetProperty("eventId", out var id) && Guid.TryParse(id.GetString(), out var g))
                                    rejected[g] = item.TryGetProperty("error", out var err) ? (err.GetString() ?? "rejected") : "rejected";
                    }
                    catch (JsonException) { /* a non-JSON 2xx body is simply "all accepted" */ }
                }
                return (true, code, null, false, rejected);
            }
            var snippet = text.Length > 300 ? text[..300] : text;
            var retryable = code is 408 or 429 or >= 500;
            return (false, code, $"HTTP {code}: {snippet}", retryable, rejected);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            return (false, null, $"{ex.GetType().Name}: {ex.GetBaseException().Message}", true, rejected);   // timeout / DNS / connection refused: Zoho may just be down
        }
    }
}
