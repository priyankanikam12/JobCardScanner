using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using Microsoft.Extensions.Hosting;

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
/// Delivery rules: 2xx = delivered. 408 / 429 / 5xx / timeout / network error = retried after 1 min, 5 min, 15 min, 1 h, 6 h, 12 h, 24 h (up to MaxAttempts).
/// Any other 4xx = Zoho rejected the event: it is NOT retried automatically (status Failed, the reason is stored) - fix it and press "retry failed".
/// Headers on every request: Content-Type: application/json, X-BGauss-Event (event name), X-BGauss-Event-Id (the eventId in the body - use it as the idempotency key).
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

    public ZohoPushDispatcher(IServiceScopeFactory scopes, IConfiguration config, ILogger<ZohoPushDispatcher> logger)
    {
        _scopes = scopes;
        _config = config;
        _logger = logger;
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

    public static bool IsConfigured(IConfiguration config) =>
        config.GetValue("ZohoPush:Enabled", false) && !string.IsNullOrWhiteSpace(config["ZohoPush:BaseUrl"]);

    /// <summary>Sends every due event once. Returns (sent, failedThisRun). Does nothing - and queues nothing away - when the push is not enabled / configured.</summary>
    public static async Task<(int Sent, int Failed)> RunOnceAsync(JobCardScannerDbContext db, IConfiguration config, ILogger logger, CancellationToken ct)
    {
        if (!IsConfigured(config)) return (0, 0);
        if (!await RunLock.WaitAsync(0, ct)) return (0, 0);   // another run is in progress
        try
        {
            var batch = Math.Clamp(config.GetValue("ZohoPush:BatchSize", 50), 1, 500);
            var maxAttempts = Math.Max(1, config.GetValue("ZohoPush:MaxAttempts", 8));
            int sent = 0, failed = 0;
            foreach (var row in await ZohoPushStore.GetDueAsync(db, batch, ct))
            {
                var (ok, status, error, retryable) = await SendAsync(config, row, ct);
                if (ok)
                {
                    await ZohoPushStore.MarkSentAsync(db, row.Id, status ?? 200, ct);
                    sent++;
                    continue;
                }
                failed++;
                var attemptNo = row.Attempts + 1;
                DateTime? retryAt = retryable && attemptNo < maxAttempts
                    ? DateTime.UtcNow.AddMinutes(BackoffMinutes[Math.Min(attemptNo - 1, BackoffMinutes.Length - 1)])
                    : null;
                await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, status, error ?? "unknown error", retryAt, ct);
                logger.LogWarning("Zoho push: {Event} {Key} failed (attempt {Attempt}, HTTP {Status}): {Error} - {Next}",
                    row.EventName, row.EntityKey, attemptNo, status, error, retryAt.HasValue ? $"retry at {retryAt:u}" : "given up");
                // Zoho is down / throttling: stop this run instead of hammering it with the rest of the batch
                if (retryable) break;
            }
            return (sent, failed);
        }
        finally { RunLock.Release(); }
    }

    private static async Task<(bool Ok, int? Status, string? Error, bool Retryable)> SendAsync(IConfiguration config, ZohoPushStore.OutboxRow row, CancellationToken ct)
    {
        var baseUrl = config["ZohoPush:BaseUrl"]!.TrimEnd('/');
        var path = row.EntityType == "Item" ? config["ZohoPush:ItemsPath"] ?? "/items" : config["ZohoPush:CustomersPath"] ?? "/customers";
        if (!path.StartsWith('/')) path = "/" + path;

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + path)
            {
                Content = new StringContent(row.PayloadJson, Encoding.UTF8, "application/json"),
            };
            req.Headers.TryAddWithoutValidation("X-BGauss-Event", row.EventName);
            req.Headers.TryAddWithoutValidation("X-BGauss-Event-Id", row.EventId.ToString());
            foreach (var h in config.GetSection("ZohoPush:Headers").GetChildren())
                if (!string.IsNullOrWhiteSpace(h.Key) && !string.IsNullOrEmpty(h.Value)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
            var secret = config["ZohoPush:SigningSecret"];
            if (!string.IsNullOrEmpty(secret))
            {
                using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
                req.Headers.TryAddWithoutValidation("X-BGauss-Signature", "sha256=" + Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(row.PayloadJson))).ToLowerInvariant());
            }

            using var resp = await Http.SendAsync(req, ct);
            var code = (int)resp.StatusCode;
            if (code is >= 200 and < 300) return (true, code, null, false);
            var body = await resp.Content.ReadAsStringAsync(ct);
            var snippet = body.Length > 300 ? body[..300] : body;
            var retryable = code is 408 or 429 or >= 500;
            return (false, code, $"HTTP {code}: {snippet}", retryable);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            return (false, null, $"{ex.GetType().Name}: {ex.GetBaseException().Message}", true);   // timeout / DNS / connection refused: Zoho may just be down
        }
    }
}