using System.Text.Json;
using System.Text.Json.Nodes;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services.Zoho;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>Outcome of one adjustment dry run / push for one location.</summary>
public sealed record ZohoAdjustmentOutcome(string Result, string Detail, string? Reference, int Lines, decimal NetQty, string? ZohoAdjustmentId, JsonObject? Payload, List<string> Skipped);

/// <summary>
/// 2026-11-20: DMS -> Zoho Books inventory adjustment push. SOURCE = dbo.PartUploads (bulk stock uploads, Stock Summary Detail report), one LOCATION per run.
/// FACT: PartUploads keeps ONE row per (dealer, location, part) holding the latest BalQty (no history), so the adjustment is a DELTA: BalQty now minus the BalQty at our last successful push
/// (first push: minus 0, which is only right if Zoho holds NO opening stock for that item at that location - ASSUMPTION to confirm with Zoho before the first live run).
/// Material transfers also reduce BalQty in DMS, so they would appear as negative deltas here; transfers belong to Zoho Transfer Orders (separate item) - review the dry run before any live send.
/// OFF unless ZohoAdjustmentPush:Enabled = true; live also needs dryRun=false and confirm=true. Reason text from ZohoAdjustmentPush:Reason (required for live, nothing is invented). ZohoAdjustmentPush:MaxLines (default 200) per adjustment.
/// Items are matched by SKU (= Part No) and must exist in Zoho with inventory tracking; location must be Confirmed in dbo.ZohoLocationMap. Results in dbo.ZohoAdjustmentPush / dbo.ZohoAdjustmentPushLine (run sql/2026-11-20_zoho_adjustment_push.sql).
/// Dry run reads Zoho (item lookups only) and writes nothing to Zoho or to the database.
/// </summary>
public sealed class ZohoAdjustmentPushService
{
    public sealed class StockRow { public Guid Id { get; set; } public string PartNo { get; set; } = ""; public string? Description { get; set; } public decimal BalQty { get; set; } public decimal? PrevQty { get; set; } public string? DealerCode { get; set; } public string LocationCode { get; set; } = ""; }
    public sealed class CountRow { public int Value { get; set; } }

    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _cfg;
    private readonly ZohoBooksApiClient _client;

    public ZohoAdjustmentPushService(JobCardScannerDbContext db, IConfiguration cfg, ZohoBooksApiClient client) { _db = db; _cfg = cfg; _client = client; }

    public static bool Enabled(IConfiguration c) => c.GetValue("ZohoAdjustmentPush:Enabled", false);

    private static string IstToday() => DateTime.UtcNow.AddHours(5.5).ToString("yyyy-MM-dd");

    public async Task<ZohoAdjustmentOutcome> RunAsync(string locationCode, bool dryRun, CancellationToken ct)
    {
        locationCode = (locationCode ?? "").Trim();
        if (locationCode.Length == 0) return new("Rejected", "locationCode is required (one location per run).", null, 0, 0, null, null, new());
        var reason = _cfg["ZohoAdjustmentPush:Reason"]?.Trim();
        if (!dryRun && string.IsNullOrEmpty(reason)) return new("Rejected", "ZohoAdjustmentPush:Reason is not set (Zoho needs a reason; confirm the wording with Zoho/Finance).", null, 0, 0, null, null, new());
        var maxLines = Math.Clamp(_cfg.GetValue("ZohoAdjustmentPush:MaxLines", 200), 1, 1000);

        var locRows = await _db.Database.SqlQueryRaw<ZohoInvoicePushService.LocRow>("SELECT ZohoLocationId, DealerCode, SubLocation FROM dbo.ZohoLocationMap WHERE Confirmed = 1").ToListAsync(ct);
        var locations = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in locRows)
        {
            var key = !string.IsNullOrWhiteSpace(r.SubLocation) ? r.SubLocation!.Trim() : r.DealerCode?.Trim();
            if (!string.IsNullOrEmpty(key)) locations[key] = r.ZohoLocationId;
        }

        var rows = await _db.Database.SqlQueryRaw<StockRow>(@"SELECT p.Id, p.PartNo, p.Description, CAST(p.BalQty AS DECIMAL(14,2)) AS BalQty,
 (SELECT TOP 1 x.QtyAfter FROM dbo.ZohoAdjustmentPushLine x WHERE x.PartUploadId = p.Id AND x.Status = 'Sent' ORDER BY x.CreatedAt DESC) AS PrevQty,
 d.BaplDmsDealerCode AS DealerCode, p.LocationCode
FROM dbo.PartUploads p JOIN dbo.Dealers d ON d.Id = p.DealerId
WHERE p.LocationCode = @loc AND p.BalQty IS NOT NULL ORDER BY p.PartNo", new SqlParameter("@loc", locationCode)).ToListAsync(ct);
        if (rows.Count == 0) return new("Nothing", $"No uploaded stock rows with a Bal Qty for location {locationCode}.", null, 0, 0, null, null, new());

        var locationId = ZohoInvoiceBuilder.ResolveLocation(locations, rows[0].DealerCode, locationCode);
        if (locationId is null) return new("NotSent", $"location not mapped / not confirmed in dbo.ZohoLocationMap ({locationCode}).", null, 0, 0, null, null, new());

        var skipped = new List<string>();
        var lines = new List<(StockRow Row, string ItemId, decimal Delta)>();
        var itemCache = new Dictionary<string, ZohoItem?>(StringComparer.OrdinalIgnoreCase);
        var unchanged = 0;
        foreach (var r in rows)
        {
            var delta = r.BalQty - (r.PrevQty ?? 0m);
            if (delta == 0m) { unchanged++; continue; }
            var code = r.PartNo.Trim();
            if (!itemCache.TryGetValue(code, out var item))
            {
                var f = await _client.FindItemBySkuAsync(code, ct);
                if (!f.Success) return new("Stopped", f.Message ?? "item lookup failed", null, lines.Count, lines.Sum(x => x.Delta), null, null, skipped);
                item = f.Data; itemCache[code] = item;
            }
            if (item is null) { skipped.Add($"{code}: not in Zoho Books"); continue; }
            if (item.TrackInventory == false) { skipped.Add($"{code}: item in Zoho does not track inventory"); continue; }
            if (!string.Equals(item.Status ?? "active", "active", StringComparison.OrdinalIgnoreCase)) { skipped.Add($"{code}: item is inactive in Zoho"); continue; }
            if (lines.Count >= maxLines) { skipped.Add($"{code}: beyond MaxLines {maxLines} - run again for the next batch"); continue; }
            lines.Add((r, item.ItemId, delta));
        }
        if (lines.Count == 0) return new("Nothing", $"No adjustable line (unchanged {unchanged}, skipped {skipped.Count}).", null, 0, 0, null, null, skipped);

        var date = IstToday();
        var seq = (await _db.Database.SqlQueryRaw<CountRow>("SELECT COUNT(*) + 1 AS Value FROM dbo.ZohoAdjustmentPush WHERE LocationCode = @l AND AdjustmentDate = @d", new SqlParameter("@l", locationCode), new SqlParameter("@d", date)).ToListAsync(ct)).First().Value;
        var reference = $"DMS-ADJ-{locationCode}-{date.Replace("-", "")}-{seq:00}";
        var net = lines.Sum(x => x.Delta);
        var req = new ZohoCreateInventoryAdjustmentRequest
        {
            Date = date, Reason = string.IsNullOrEmpty(reason) ? "(ZohoAdjustmentPush:Reason not set)" : reason!, ReferenceNumber = reference, AdjustmentType = "quantity", LocationId = locationId,
            Description = $"DMS stock upload sync, location {locationCode}",
            LineItems = lines.Select(x => new ZohoInventoryAdjustmentLineItem { ItemId = x.ItemId, QuantityAdjusted = x.Delta, LocationId = locationId }).ToList()
        };
        var payload = JsonSerializer.SerializeToNode(req)!.AsObject();
        if (dryRun) return new("DryRunOK", $"payload built; {lines.Count} line(s), net {net}, unchanged {unchanged}, skipped {skipped.Count}; nothing sent.", reference, lines.Count, net, null, payload, skipped);

        await _db.Database.ExecuteSqlRawAsync("INSERT INTO dbo.ZohoAdjustmentPush (ReferenceNumber, LocationCode, ZohoLocationId, AdjustmentDate, Status, LineCount, NetQty, Detail) VALUES (@r, @l, @z, @d, 'Creating', @n, @q, N'sending')",
            new SqlParameter("@r", reference), new SqlParameter("@l", locationCode), new SqlParameter("@z", locationId), new SqlParameter("@d", date), new SqlParameter("@n", lines.Count), new SqlParameter("@q", net));
        var created = await _client.CreateInventoryAdjustmentAsync(req, ct);
        if (!created.Success)
        {
            var d = $"Zoho code {created.ZohoCode}: {created.Message}";
            await _db.Database.ExecuteSqlRawAsync("UPDATE dbo.ZohoAdjustmentPush SET Status = 'Failed', Detail = @d, UpdatedAt = SYSUTCDATETIME() WHERE ReferenceNumber = @r", new SqlParameter("@d", d.Length > 2000 ? d[..2000] : d), new SqlParameter("@r", reference));
            return new(created.Retryable ? "Stopped" : "Failed", d, reference, lines.Count, net, null, null, skipped);
        }
        var zid = created.Data!.InventoryAdjustmentId;
        await _db.Database.ExecuteSqlRawAsync("UPDATE dbo.ZohoAdjustmentPush SET Status = 'Sent', ZohoAdjustmentId = @z, Detail = N'created', UpdatedAt = SYSUTCDATETIME() WHERE ReferenceNumber = @r", new SqlParameter("@z", zid), new SqlParameter("@r", reference));
        foreach (var x in lines)
            await _db.Database.ExecuteSqlRawAsync("INSERT INTO dbo.ZohoAdjustmentPushLine (ReferenceNumber, PartUploadId, PartNo, QtyBefore, QtyAfter, Delta, Status) VALUES (@r, @p, @n, @b, @a, @d, 'Sent')",
                new SqlParameter("@r", reference), new SqlParameter("@p", x.Row.Id), new SqlParameter("@n", x.Row.PartNo), new SqlParameter("@b", x.Row.PrevQty ?? 0m), new SqlParameter("@a", x.Row.BalQty), new SqlParameter("@d", x.Delta));
        return new("Sent", "adjustment created in Zoho Books.", reference, lines.Count, net, zid, null, skipped);
    }
}
