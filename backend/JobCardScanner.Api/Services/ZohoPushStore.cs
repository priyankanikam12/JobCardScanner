using System.Data;
using System.Text.Json;
using JobCardScanner.Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>
/// 2026-10-14 ("we want PUSH API ... make push api"): the queue (dbo.ZohoPushOutbox, sql/2026-10-14_zoho_push_outbox.sql) behind the BGauss -> Zoho push. Static helpers over the existing
/// DbContext with raw SQL, so no DbContext / model change is needed. A business action (customer saved in Ledger Master, item master synced) only WRITES an outbox row here - best-effort,
/// it can never fail the action itself - and ZohoPushDispatcher sends the rows to Zoho and retries them.
///
/// What is pushed (the same scope as the GET APIs):
///   * Customers - Party / Insurance ledgers of the Magnemite dealers Zoho may see (name contains MAGNEMITE, not BAPL dealer codes CUS0347 / CUS0213 / CUS0209): customer.created,
///     customer.updated, customer.deleted (a deactivated ledger). Customers written BY Zoho through POST/PUT/DELETE /api/zoho/customers are not pushed back to it.
///   * Items - continuing items only (active, ProductMainGroupId 2, name not starting A2 / B8): item.created / item.updated, enqueued after each "Sync from BAPL".
/// </summary>
public static class ZohoPushStore
{
    /// <summary>Same three exclusions as the Zoho GET APIs (matched on the BAPL dealer code).</summary>
    public static readonly string[] ExcludedBaplDealerCodes = { "CUS0347", "CUS0213", "CUS0209" };

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
    };

    public sealed class OutboxRow
    {
        public long Id { get; set; }
        public Guid EventId { get; set; }
        public string EntityType { get; set; } = "";
        public string EntityKey { get; set; } = "";
        public string EventName { get; set; } = "";
        public string PayloadJson { get; set; } = "";
        public int Attempts { get; set; }
    }

    public sealed class FailedRow
    {
        public long Id { get; set; }
        public string EntityType { get; set; } = "";
        public string EntityKey { get; set; } = "";
        public string EventName { get; set; } = "";
        public int Attempts { get; set; }
        public int? LastHttpStatus { get; set; }
        public string? LastError { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public sealed class CountRow
    {
        public string Status { get; set; } = "";
        public string EntityType { get; set; } = "";
        public int Events { get; set; }
    }

    public sealed class ItemData
    {
        public string ItemCode { get; set; } = "";
        public string? ItemName { get; set; }
        public string? DisplayName { get; set; }
        public string? HsnCode { get; set; }
        public decimal? DealerPrice { get; set; }
        public decimal? Sgst { get; set; }
        public decimal? Cgst { get; set; }
        public decimal? Igst { get; set; }
        public string? ItemType { get; set; }
        public string? Status { get; set; }
        public DateTime? CreatedOn { get; set; }
        public DateTime? ModifiedOn { get; set; }
    }

    // ------------------------------------------------------------------ queue

    /// <summary>Writes one event: the envelope { eventId, event, occurredAt, source, data } is what Zoho receives as the request body.</summary>
    public static async Task EnqueueAsync(JobCardScannerDbContext db, string entityType, string entityKey, string eventName, object data, CancellationToken ct = default)
    {
        var eventId = Guid.NewGuid();
        var json = JsonSerializer.Serialize(new { eventId, @event = eventName, occurredAt = DateTime.UtcNow, source = "BGAUSS-DMS", data }, JsonOpts);
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO [dbo].[ZohoPushOutbox] ([EventId], [EntityType], [EntityKey], [EventName], [PayloadJson]) VALUES (@e, @t, @k, @n, @p)",
            new object[]
            {
                new SqlParameter("@e", eventId), new SqlParameter("@t", entityType), new SqlParameter("@k", entityKey),
                new SqlParameter("@n", eventName), new SqlParameter("@p", SqlDbType.NVarChar, -1) { Value = json },
            }, ct);
        ZohoPushDispatcher.Nudge();   // live: wake the sender now so this event is POSTed to Zoho within seconds
    }

    public static Task<List<OutboxRow>> GetDueAsync(JobCardScannerDbContext db, int max, CancellationToken ct) =>
        db.Database.SqlQueryRaw<OutboxRow>(
            @"SELECT TOP (@n) [Id] AS Id, [EventId] AS EventId, [EntityType] AS EntityType, [EntityKey] AS EntityKey, [EventName] AS EventName, [PayloadJson] AS PayloadJson, [Attempts] AS Attempts
              FROM [dbo].[ZohoPushOutbox] WHERE [Status] = N'Pending' AND [NextAttemptAt] <= SYSUTCDATETIME() ORDER BY [Id]",
            new SqlParameter("@n", max)).ToListAsync(ct);

    public static Task MarkSentAsync(JobCardScannerDbContext db, long id, int httpStatus, CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync(
            "UPDATE [dbo].[ZohoPushOutbox] SET [Status] = N'Sent', [Attempts] = [Attempts] + 1, [LastHttpStatus] = @s, [LastError] = NULL, [SentAt] = SYSUTCDATETIME() WHERE [Id] = @id",
            new object[] { new SqlParameter("@s", httpStatus), new SqlParameter("@id", id) }, ct);

    /// <summary>A failed attempt: retryAt set = stay Pending and try again then; null = give up (Failed) until someone presses "retry failed".</summary>
    public static Task MarkAttemptFailedAsync(JobCardScannerDbContext db, long id, int? httpStatus, string error, DateTime? retryAtUtc, CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync(
            @"UPDATE [dbo].[ZohoPushOutbox]
              SET [Attempts] = [Attempts] + 1, [LastHttpStatus] = @s, [LastError] = @e,
                  [Status] = CASE WHEN @r IS NULL THEN N'Failed' ELSE N'Pending' END,
                  [NextAttemptAt] = ISNULL(@r, [NextAttemptAt])
              WHERE [Id] = @id",
            new object[]
            {
                new SqlParameter("@s", SqlDbType.Int) { Value = httpStatus.HasValue ? httpStatus.Value : DBNull.Value },
                new SqlParameter("@e", SqlDbType.NVarChar, 1000) { Value = error.Length > 1000 ? error[..1000] : error },
                new SqlParameter("@r", SqlDbType.DateTime2) { Value = retryAtUtc.HasValue ? retryAtUtc.Value : DBNull.Value },
                new SqlParameter("@id", id),
            }, ct);

    public static Task<int> RetryFailedAsync(JobCardScannerDbContext db, CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync("UPDATE [dbo].[ZohoPushOutbox] SET [Status] = N'Pending', [Attempts] = 0, [NextAttemptAt] = SYSUTCDATETIME() WHERE [Status] = N'Failed'", ct);

    public static Task<List<CountRow>> CountsAsync(JobCardScannerDbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<CountRow>("SELECT [Status] AS Status, [EntityType] AS EntityType, COUNT(*) AS Events FROM [dbo].[ZohoPushOutbox] GROUP BY [Status], [EntityType]").ToListAsync(ct);

    public static Task<List<FailedRow>> RecentFailuresAsync(JobCardScannerDbContext db, int max, CancellationToken ct) =>
        db.Database.SqlQueryRaw<FailedRow>(
            @"SELECT TOP (@n) [Id] AS Id, [EntityType] AS EntityType, [EntityKey] AS EntityKey, [EventName] AS EventName, [Attempts] AS Attempts, [LastHttpStatus] AS LastHttpStatus, [LastError] AS LastError, [CreatedAt] AS CreatedAt
              FROM [dbo].[ZohoPushOutbox] WHERE [LastError] IS NOT NULL AND [Status] <> N'Sent' ORDER BY [Id] DESC",
            new SqlParameter("@n", max)).ToListAsync(ct);

    // ------------------------------------------------------------------ customers

    /// <summary>The customer exactly as GET /api/zoho/customers returns it - or null when this ledger is outside what Zoho may see (not Party / Insurance, no dealer, not a Magnemite dealer, or an excluded one).</summary>
    public static async Task<object?> BuildCustomerDataAsync(JobCardScannerDbContext db, Guid ledgerId, string changeType, CancellationToken ct)
    {
        var l = await db.LedgerMasters.AsNoTracking().Include(x => x.LedgerTypeMaster).FirstOrDefaultAsync(x => x.Id == ledgerId, ct);
        if (l is null || l.DealerId is null) return null;
        var typeName = l.LedgerTypeMaster?.CustomerType;
        if (!string.Equals(typeName, "Party", StringComparison.OrdinalIgnoreCase) && !string.Equals(typeName, "Insurance", StringComparison.OrdinalIgnoreCase)) return null;

        var dealer = await db.Dealers.AsNoTracking().Where(d => d.Id == l.DealerId).Select(d => new { d.Name, d.BaplDmsDealerCode }).FirstOrDefaultAsync(ct);
        if (dealer is null || dealer.Name is null || !dealer.Name.Contains("MAGNEMITE", StringComparison.OrdinalIgnoreCase)) return null;
        if (dealer.BaplDmsDealerCode is not null && ExcludedBaplDealerCodes.Contains(dealer.BaplDmsDealerCode, StringComparer.OrdinalIgnoreCase)) return null;

        return new
        {
            l.Id,
            l.LedgerCode,
            l.LedgerName,
            LedgerType = typeName,
            MobileNumber = l.MobileNumber,
            AlternateMobileNo = l.AlternateMobileNo,
            Email = l.EMail,
            l.Address,
            l.Address2,
            l.City,
            l.State,
            l.Pin,
            Gstin = l.Gstno,
            l.Pan,
            Status = l.IsActive ? "Active" : "Deleted",
            l.IsActive,
            ChangeType = changeType,
            DealerId = l.DealerId,
            DealerName = dealer.Name,
            DealerCode = dealer.BaplDmsDealerCode,
            l.CreatedAt,
            l.UpdatedAt,
        };
    }

    /// <summary>Queues one customer event. Best-effort: any problem is logged and swallowed, so saving a customer can never fail because of the push. eventName: customer.created | customer.updated | customer.deleted.</summary>
    public static async Task TryEnqueueCustomerAsync(JobCardScannerDbContext db, Guid ledgerId, string eventName, ILogger logger, CancellationToken ct = default)
    {
        try
        {
            var changeType = eventName switch { "customer.created" => "Added", "customer.deleted" => "Deleted", _ => "Edited" };
            var data = await BuildCustomerDataAsync(db, ledgerId, changeType, ct);
            if (data is null) return;
            var code = (string)data.GetType().GetProperty("LedgerCode")!.GetValue(data)!;
            await EnqueueAsync(db, "Customer", code, eventName, data, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Zoho push: could not queue {Event} for ledger {LedgerId} (has sql/2026-10-14_zoho_push_outbox.sql been run?).", eventName, ledgerId);
        }
    }

    /// <summary>Initial load: every active in-scope Party / Insurance customer queued once as customer.created. Returns how many were queued.</summary>
    public static async Task<int> EnqueueAllCustomersAsync(JobCardScannerDbContext db, CancellationToken ct)
    {
        var ids = await db.LedgerMasters.AsNoTracking()
            .Where(l => l.IsActive && l.DealerId != null && l.LedgerTypeMaster != null
                && (l.LedgerTypeMaster.CustomerType.ToUpper() == "PARTY" || l.LedgerTypeMaster.CustomerType.ToUpper() == "INSURANCE"))
            .OrderBy(l => l.CreatedAt).Select(l => l.Id).ToListAsync(ct);
        var queued = 0;
        foreach (var id in ids)
        {
            var data = await BuildCustomerDataAsync(db, id, "Added", ct);
            if (data is null) continue;
            await EnqueueAsync(db, "Customer", (string)data.GetType().GetProperty("LedgerCode")!.GetValue(data)!, "customer.created", data, ct);
            queued++;
        }
        return queued;
    }

    // ------------------------------------------------------------------ items

    private const string ContinuingWhere = @"
            WHERE m.[ProductMainGroupId] = 2
              AND (m.[Status] IS NULL OR LTRIM(RTRIM(m.[Status])) = 'Y')
              AND NOT (LTRIM(ISNULL(m.[ItemName], '')) LIKE 'A2%' OR LTRIM(ISNULL(m.[ItemName], '')) LIKE 'B8%')";

    private const string ItemSelect = @"
            SELECT m.[ItemCode] AS ItemCode, m.[ItemName] AS ItemName, m.[DisplayName] AS DisplayName, m.[HSNCode] AS HsnCode, m.[Dlr_Price] AS DealerPrice,
                   m.[SGST] AS Sgst, m.[CGST] AS Cgst, m.[IGST] AS Igst, m.[Item_Type] AS ItemType, m.[Status] AS Status, m.[CreatedOn] AS CreatedOn, m.[ModifiedOn] AS ModifiedOn
            FROM [dbo].[C_ItemMaster] m";

    private static object ItemPayload(ItemData r) => new
    {
        r.ItemCode, r.ItemName, r.DisplayName, r.HsnCode, r.DealerPrice, r.Sgst, r.Cgst, r.Igst, r.ItemType,
        Status = string.IsNullOrWhiteSpace(r.Status) ? "Y" : r.Status.Trim(), r.CreatedOn, r.ModifiedOn,
    };

    /// <summary>Queues the continuing items created or modified since sinceUtc (item.created when createdOn is on/after it, else item.updated); sinceUtc null = every continuing item as item.created (the initial load).
    /// Returns how many were queued.</summary>
    public static async Task<int> EnqueueItemsAsync(JobCardScannerDbContext db, DateTime? sinceUtc, CancellationToken ct)
    {
        var sql = ItemSelect + ContinuingWhere + (sinceUtc.HasValue ? " AND (m.[CreatedOn] >= @since OR m.[ModifiedOn] >= @since)" : "") + " ORDER BY m.[ItemCode]";
        var rows = sinceUtc.HasValue
            ? await db.Database.SqlQueryRaw<ItemData>(sql, new SqlParameter("@since", SqlDbType.DateTime) { Value = sinceUtc.Value }).ToListAsync(ct)
            : await db.Database.SqlQueryRaw<ItemData>(sql).ToListAsync(ct);
        foreach (var r in rows)
        {
            var isNew = sinceUtc is null || (r.CreatedOn.HasValue && r.CreatedOn.Value >= sinceUtc.Value);
            await EnqueueAsync(db, "Item", r.ItemCode, isNew ? "item.created" : "item.updated", ItemPayload(r), ct);
        }
        return rows.Count;
    }

    /// <summary>Best-effort variant used right after an Item Master sync - never throws.</summary>
    public static async Task TryEnqueueItemChangesAsync(JobCardScannerDbContext db, DateTime? previousSyncUtc, ILogger logger, CancellationToken ct = default)
    {
        try
        {
            // First ever sync: do not flood Zoho - use the explicit initial load instead. The ERP's createdOn / modifiedOn may be in local time, so look back 12 h before the previous sync:
            // a few items may be sent twice (harmless - Zoho matches on itemCode / eventId), none are missed.
            if (previousSyncUtc is null) return;
            var queued = await EnqueueItemsAsync(db, previousSyncUtc.Value.AddHours(-12), ct);
            logger.LogInformation("Zoho push: {Count} item event(s) queued after the Item Master sync.", queued);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Zoho push: could not queue item changes after the Item Master sync.");
        }
    }
}