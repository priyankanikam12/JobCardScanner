using System.Data;
using System.Text.RegularExpressions;
using JobCardScanner.Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>
/// 2026-10-13 ("remove the location dependency on BAPLDMSvadConnection ... fetch from our master table"): reads and writes dbo.WorkshopLocations in JobCardScannerDb - the app's OWN list of
/// workshop locations (W1..Wn) per dealer (sql/2026-10-13_create_workshop_locations.sql). Static helpers over the existing DbContext using raw SQL, so no DbContext / Program.cs change is needed.
/// Used by BaplDmsController.Workshops (read first, fall back to live DMS only when this table has nothing for the dealer, and cache what DMS returns) and by
/// WorkshopLocationsController (the one-off / on-demand sync from DMS).
/// </summary>
public static class WorkshopLocationStore
{
    public sealed class Row
    {
        public string LocCode { get; set; } = "";
        public string LocName { get; set; } = "";
        public Guid DealerId { get; set; }
        public string? DealerCode { get; set; }
        public string? DealerName { get; set; }
    }

    private sealed class ExistingRow
    {
        public string LocName { get; set; } = "";
        public Guid DealerId { get; set; }
        public bool IsActive { get; set; }
    }

    private static int WorkshopNumber(string code)
    {
        var m = Regex.Match(code ?? "", @"W(\d+)$", RegexOptions.IgnoreCase);
        return m.Success && int.TryParse(m.Groups[1].Value, out var n) ? n : int.MaxValue;
    }

    /// <summary>Active locations, one dealer's (dealerId) or every dealer's, optionally narrowed by q (matches code, location name or dealer name). Ordered by dealer, then W1, W2, ... W10.</summary>
    public static async Task<List<Row>> GetAsync(JobCardScannerDbContext db, Guid? dealerId, string? q, CancellationToken ct)
    {
        const string sql = @"
            SELECT w.[LocCode] AS LocCode, w.[LocName] AS LocName, w.[DealerId] AS DealerId, d.[BaplDmsDealerCode] AS DealerCode, d.[Name] AS DealerName
            FROM [dbo].[WorkshopLocations] w
            JOIN [dbo].[Dealers] d ON d.[Id] = w.[DealerId]
            WHERE w.[IsActive] = 1
              AND (@dealerId IS NULL OR w.[DealerId] = @dealerId)
              AND (@q IS NULL OR w.[LocCode] LIKE @q OR w.[LocName] LIKE @q OR d.[Name] LIKE @q)";
        var pDealer = new SqlParameter("@dealerId", SqlDbType.UniqueIdentifier) { Value = dealerId.HasValue ? dealerId.Value : DBNull.Value };
        var pQ = new SqlParameter("@q", SqlDbType.NVarChar, 300) { Value = string.IsNullOrWhiteSpace(q) ? DBNull.Value : $"%{q.Trim()}%" };
        var rows = await db.Database.SqlQueryRaw<Row>(sql, pDealer, pQ).ToListAsync(ct);
        return rows
            .OrderBy(r => r.DealerName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(r => WorkshopNumber(r.LocCode))
            .ThenBy(r => r.LocCode, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Adds a location that is not in the table yet, and corrects the name / dealer (and re-activates) one that is. Never deletes. Returns how many were added / changed.</summary>
    public static async Task<(int Added, int Updated)> UpsertAsync(JobCardScannerDbContext db, Guid dealerId, IEnumerable<(string Code, string Name)> rows, string source, CancellationToken ct)
    {
        int added = 0, updated = 0;
        foreach (var (codeRaw, nameRaw) in rows)
        {
            var code = (codeRaw ?? "").Trim();
            if (code.Length == 0) continue;
            var name = (nameRaw ?? "").Trim();
            if (name.Length == 0) name = code;

            var existing = await db.Database
                .SqlQueryRaw<ExistingRow>("SELECT [LocName] AS LocName, [DealerId] AS DealerId, [IsActive] AS IsActive FROM [dbo].[WorkshopLocations] WHERE [LocCode] = @c", new SqlParameter("@c", code))
                .ToListAsync(ct);

            if (existing.Count == 0)
            {
                await db.Database.ExecuteSqlRawAsync(
                    "INSERT INTO [dbo].[WorkshopLocations] ([DealerId], [LocCode], [LocName], [IsActive], [Source]) VALUES (@d, @c, @n, 1, @s)",
                    new object[] { new SqlParameter("@d", dealerId), new SqlParameter("@c", code), new SqlParameter("@n", name), new SqlParameter("@s", source) }, ct);
                added++;
            }
            else if (existing[0].LocName != name || existing[0].DealerId != dealerId || !existing[0].IsActive)
            {
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE [dbo].[WorkshopLocations] SET [LocName] = @n, [DealerId] = @d, [IsActive] = 1, [UpdatedAt] = SYSUTCDATETIME() WHERE [LocCode] = @c",
                    new object[] { new SqlParameter("@n", name), new SqlParameter("@d", dealerId), new SqlParameter("@c", code) }, ct);
                updated++;
            }
        }
        return (added, updated);
    }
}