using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Options;

namespace JobCardScanner.Api.Services.Zoho;

/// <summary>
/// 2026-10-28 - drains dbo.ZohoPushOutbox (the same queue ZohoPushStore/ZohoPushDispatcher already use) straight into Zoho Books' real API via ZohoBooksApiClient, instead of
/// the Learnall webhook URL ZohoPushDispatcher.RunZohoBooksAsync posts to. Wired in as a THIRD provider value - ZohoPush:Provider = "ZohoBooksDirect" - alongside the existing
/// "ZohoBooks" (webhook) and unset/"generic" (the original ZohoPushDispatcher.SendAsync webhook) modes; see ZOHO_BOOKS_INTEGRATION.md for the one-branch addition to
/// ZohoPushDispatcher.RunOnceAsync that calls this.
///
/// ITEMS ONLY for now. Customer rows are deliberately left queued (not drained) in this mode - see the big comment on ProcessCustomersInThisMode below for why: the tested
/// Payloads document describes customers as created only at invoice time (section 6), not pushed proactively on every Ledger Master change the way ZohoPushStore's existing
/// TryEnqueueCustomerAsync does. Wiring the existing proactive customer.created/.updated events straight into Zoho's /contacts API would contradict the document BGauss and
/// Learnall already tested against, so this is left as an explicit open question (see the cover note) rather than guessed at here.
/// </summary>
public static class ZohoBooksDirectRunner
{
    private static readonly SemaphoreSlim RunLock = new(1, 1);

    /// <summary>Flip to true only after Vijay/Learnall confirm customers should also be pushed proactively (and, if so, what a Zoho Books "update" of a customer should even
    /// do, since section 6 says "Customers are not updated, deactivated or re-activated through the integration"). Left false so this file compiles and is safe to drop in
    /// without silently resolving that open question.</summary>
    public const bool ProcessCustomersInThisMode = false;

    private sealed class EnqueuedEnvelope<T>
    {
        [JsonPropertyName("eventId")] public Guid EventId { get; set; }
        [JsonPropertyName("event")] public string Event { get; set; } = "";
        [JsonPropertyName("data")] public T? Data { get; set; }
    }

    /// <summary>Mirrors exactly the anonymous object ZohoPushStore.ItemPayload builds (ItemCode, ItemName, DisplayName, HsnCode, DealerPrice, Sgst, Cgst, Igst, ItemType,
    /// Status, CreatedOn, ModifiedOn) with camelCase names, since that is how ZohoPushStore.JsonOpts serialized it into OutboxRow.PayloadJson.</summary>
    private sealed class EnqueuedItemData
    {
        [JsonPropertyName("itemCode")] public string ItemCode { get; set; } = "";
        [JsonPropertyName("itemName")] public string? ItemName { get; set; }
        [JsonPropertyName("displayName")] public string? DisplayName { get; set; }
        [JsonPropertyName("hsnCode")] public string? HsnCode { get; set; }
        [JsonPropertyName("dealerPrice")] public decimal? DealerPrice { get; set; }
        [JsonPropertyName("sgst")] public decimal? Sgst { get; set; }
        [JsonPropertyName("cgst")] public decimal? Cgst { get; set; }
        [JsonPropertyName("igst")] public decimal? Igst { get; set; }
        [JsonPropertyName("status")] public string? Status { get; set; }
    }

    /// <summary>One pass over whatever Item events are due, each upserted into Zoho Books via ZohoBooksApiClient.UpsertItemAsync (find by SKU, then create or update - section
    /// 4.1-4.4). Returns (sent, failed); stops a run early on the first retryable failure so a Zoho outage does not get hammered, same discipline as
    /// ZohoPushDispatcher.RunOnceAsync.</summary>
    public static async Task<(int Sent, int Failed)> RunAsync(JobCardScannerDbContext db, ZohoBooksApiClient client, IOptions<ZohoBooksOptions> options, ILogger logger, CancellationToken ct)
    {
        if (!await RunLock.WaitAsync(0, ct)) return (0, 0);
        try
        {
            var entityTypes = ProcessCustomersInThisMode ? new[] { "Item", "Customer" } : new[] { "Item" };
            int sent = 0, failed = 0;
            const int maxAttempts = 8;
            int[] backoffMinutes = { 1, 5, 15, 60, 360, 720, 1440 };

            for (var loop = 0; loop < 100; loop++)
            {
                var rows = await ZohoPushStore.GetDueAsync(db, 50, ct, entityTypes);
                if (rows.Count == 0) break;
                var stop = false;

                foreach (var row in rows)
                {
                    if (row.EntityType != "Item")
                    {
                        logger.LogDebug("Zoho Books direct mode: skipping a {Entity} event ({Key}) - customer push is not wired into this mode yet.", row.EntityType, row.EntityKey);
                        continue;
                    }

                    EnqueuedItemData? itemData;
                    try { itemData = JsonSerializer.Deserialize<EnqueuedEnvelope<EnqueuedItemData>>(row.PayloadJson)?.Data; }
                    catch (JsonException ex)
                    {
                        logger.LogError(ex, "Zoho Books direct mode: outbox row {Id} ({Key}) has an unreadable payload - marking it Failed rather than retrying forever.", row.Id, row.EntityKey);
                        await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, null, "Unreadable outbox payload: " + ex.Message, null, ct);
                        failed++;
                        continue;
                    }
                    if (itemData is null)
                    {
                        await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, null, "Outbox payload had no data.", null, ct);
                        failed++;
                        continue;
                    }

                    var source = new ZohoPushStore.ItemData
                    {
                        ItemCode = itemData.ItemCode, ItemName = itemData.ItemName, DisplayName = itemData.DisplayName, HsnCode = itemData.HsnCode,
                        DealerPrice = itemData.DealerPrice, Sgst = itemData.Sgst, Cgst = itemData.Cgst, Igst = itemData.Igst, Status = itemData.Status,
                    };
                    var (request, shouldBeActive, mapErrors) = ZohoBooksMappers.ToCreateItemRequest(source, options.Value);
                    if (request is null)
                    {
                        // a check from section 8 failed (bad HSN, GST not an allowed rate, missing tax/account config, ...) - held back, not sent and not endlessly retried
                        await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, null, string.Join(" ", mapErrors), null, ct);
                        logger.LogWarning("Zoho Books direct mode: item {Code} held back (section 8 checks failed): {Errors}", itemData.ItemCode, string.Join(" ", mapErrors));
                        failed++;
                        continue;
                    }

                    ZohoBooksResult<ZohoItem> result;
                    try { result = await client.UpsertItemAsync(request, shouldBeActive, ct); }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                    catch (Exception ex)
                    {
                        // 2026-10-28: defensive - ZohoBooksApiClient.CallAsync now catches OAuth/config errors itself and returns a Fail result instead of throwing, but this
                        // still guards against any OTHER unexpected exception (a bad cast, a null somewhere) taking down the whole run silently with no outbox row ever
                        // marked Sent/Failed - which is exactly the symptom of "item pushed via the ops endpoint but never appears in Zoho Books with no visible error".
                        failed++;
                        await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, null, $"{ex.GetType().Name}: {ex.Message}", null, ct);
                        logger.LogError(ex, "Zoho Books direct mode: item {Code} threw an unexpected exception - marked Failed rather than left stuck Pending.", itemData.ItemCode);
                        continue;
                    }
                    if (result.Success) { await ZohoPushStore.MarkSentAsync(db, row.Id, result.HttpStatus ?? 200, ct); sent++; continue; }

                    failed++;
                    var attemptNo = row.Attempts + 1;
                    DateTime? retryAt = result.Retryable && attemptNo < maxAttempts
                        ? DateTime.UtcNow.AddMinutes(backoffMinutes[Math.Min(attemptNo - 1, backoffMinutes.Length - 1)])
                        : null;
                    await ZohoPushStore.MarkAttemptFailedAsync(db, row.Id, result.HttpStatus, $"Zoho code {result.ZohoCode}: {result.Message}", retryAt, ct);
                    logger.LogWarning("Zoho Books direct mode: item {Code} failed (attempt {Attempt}, HTTP {Status}, Zoho code {ZohoCode}): {Message} - {Next}",
                        itemData.ItemCode, attemptNo, result.HttpStatus, result.ZohoCode, result.Message, retryAt.HasValue ? $"retry at {retryAt:u}" : "given up");
                    if (result.Retryable) { stop = true; break; }   // Zoho is down / throttling: stop instead of hammering it, same as the webhook mode
                }
                if (stop) break;
            }
            return (sent, failed);
        }
        finally { RunLock.Release(); }
    }
}
