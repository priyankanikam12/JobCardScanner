using Microsoft.Data.SqlClient;

namespace JobCardScanner.Api.Services;

/// <summary>
/// One item's pricing/tax row from BAPL's C_ItemMaster (BaplConnection / baplfinal - the SAME
/// database BaplDealerService.cs already reads, distinct from BAPLDMSvadConnection/DMSBAPLDATAConnection
/// used elsewhere in this project). Dlr_Price is the confirmed "Rate" (base, GST-exclusive) per
/// explicit decision - MRP is NOT a stored column here, it's computed by the app as
/// Rate x (1 + Igst%/100) and held fixed on a line regardless of any discount applied afterwards
/// (see web/src/lib/gstCalc.ts's computeGstLine - a formula independently confirmed against BAPL's
/// own DMS_BAPL_Api CounterBillRepo.GetAllCounterBillForExcel: Amount = (Qty*Rate - discount) x
/// (1 + totalGST%/100), the same discount-then-tax order this app already implements). Sgst/Cgst/
/// Igst are per-item, confirmed to satisfy Sgst + Cgst == Igst in this table.
/// </summary>
public record BaplItemPricingRow(
    string ItemCode,
    string? ItemName,
    decimal? DlrPrice,
    decimal? SalesPrice,
    decimal? Sgst,
    decimal? Cgst,
    decimal? Igst,
    decimal? Ugst,
    string? HsnCode);

public interface IBaplItemPricingService
{
    /// <summary>Single item lookup by exact ItemCode - used by Material Transfer/Repair Bill's
    /// item picker to fetch Rate/GST%/HSN the moment a part is selected. Null if the item code
    /// isn't found in C_ItemMaster. Throws <see cref="InvalidOperationException"/> on a real
    /// connection/query failure.</summary>
    Task<BaplItemPricingRow?> GetItemPricingAsync(string itemCode, CancellationToken ct = default);

    /// <summary>Search/browse across C_ItemMaster by ItemCode/ItemName/HSNCode substring - backs
    /// the "Item Master" sidebar page. q is optional (omit to list everything, capped at
    /// <paramref name="take"/>). Throws <see cref="InvalidOperationException"/> on a real
    /// failure.</summary>
    Task<IReadOnlyList<BaplItemPricingRow>> SearchItemsAsync(string? q, int take, CancellationToken ct = default);

    /// <summary>Batch lookup by exact ItemCode list, one round trip - used by
    /// PartsController.Search to enrich the "DMS Parts Inventory" panel on the Parts &amp;
    /// Inventory page with real Rate/GST%/HSN from C_ItemMaster instead of one query per row.
    /// Returns only the item codes actually found (missing ones are simply absent, not an error);
    /// an empty/whitespace-only input list short-circuits to an empty result with no round trip.
    /// Throws <see cref="InvalidOperationException"/> on a real connection/query failure.</summary>
    Task<IReadOnlyList<BaplItemPricingRow>> GetItemsPricingAsync(IReadOnlyList<string> itemCodes, CancellationToken ct = default);
}

/// <summary>
/// Reads BAPL's own item catalog/pricing master (C_ItemMaster, in the same baplfinal database
/// BaplDealerService.cs already connects to via BaplConnection) - a read-only integration, same
/// plain-ADO.NET convention as every other Bapl*Service in this project (no second EF DbContext for
/// a schema this app doesn't own or migrate).
/// </summary>
public class BaplItemPricingService : IBaplItemPricingService
{
    private readonly IConfiguration _config;

    public BaplItemPricingService(IConfiguration config)
    {
        _config = config;
    }

    private string ConnStr => _config.GetConnectionString("BaplConnection")
        ?? throw new InvalidOperationException("BaplConnection isn't configured in appsettings.json's ConnectionStrings section.");

    public async Task<BaplItemPricingRow?> GetItemPricingAsync(string itemCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(itemCode)) return null;

        const string sql = @"
            SELECT TOP 1 ItemCode, ItemName, Dlr_Price, SalesPrice, SGST, CGST, IGST, UGST, HSNCode
            FROM [dbo].[C_ItemMaster]
            WHERE ItemCode = @itemCode";

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@itemCode", itemCode.Trim());
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (!await rdr.ReadAsync(ct)) return null;

            return MapRow(rdr, itemCode);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read item pricing (C_ItemMaster) for '{itemCode}': {ex.Message}", ex);
        }
    }

    public async Task<IReadOnlyList<BaplItemPricingRow>> SearchItemsAsync(string? q, int take, CancellationToken ct = default)
    {
        take = take is > 0 and <= 1000 ? take : 200;

        const string sql = @"
            SELECT TOP (@take) ItemCode, ItemName, Dlr_Price, SalesPrice, SGST, CGST, IGST, UGST, HSNCode
            FROM [dbo].[C_ItemMaster]
            WHERE (@qLike IS NULL OR ItemCode LIKE @qLike OR ItemName LIKE @qLike OR HSNCode LIKE @qLike)
            ORDER BY ItemName";

        var results = new List<BaplItemPricingRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@take", take);
            cmd.Parameters.AddWithValue("@qLike", string.IsNullOrWhiteSpace(q) ? (object)DBNull.Value : $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(MapRow(rdr, null));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not search BAPL's item master (C_ItemMaster): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplItemPricingRow>> GetItemsPricingAsync(IReadOnlyList<string> itemCodes, CancellationToken ct = default)
    {
        var codes = (itemCodes ?? Array.Empty<string>())
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (codes.Count == 0) return Array.Empty<BaplItemPricingRow>();

        // Dynamic parameterized IN (...) list, same pattern as this project's other batch lookups
        // (e.g. DmsBaplDataService.GetRepairBillsAsync's item-by-header-ids query) - avoids
        // concatenating caller-supplied values straight into SQL text.
        var inClause = string.Join(",", codes.Select((_, i) => $"@code{i}"));
        var sql = $@"
            SELECT ItemCode, ItemName, Dlr_Price, SalesPrice, SGST, CGST, IGST, UGST, HSNCode
            FROM [dbo].[C_ItemMaster]
            WHERE ItemCode IN ({inClause})";

        var results = new List<BaplItemPricingRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            for (var i = 0; i < codes.Count; i++) cmd.Parameters.AddWithValue($"@code{i}", codes[i]);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(MapRow(rdr, null));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not batch-read item pricing (C_ItemMaster) for {codes.Count} item code(s): {ex.Message}", ex);
        }
        return results;
    }

    private static BaplItemPricingRow MapRow(SqlDataReader rdr, string? fallbackItemCode) => new(
        rdr["ItemCode"] as string ?? fallbackItemCode ?? "",
        rdr["ItemName"] as string,
        rdr["Dlr_Price"] as decimal?,
        rdr["SalesPrice"] as decimal?,
        rdr["SGST"] as decimal?,
        rdr["CGST"] as decimal?,
        rdr["IGST"] as decimal?,
        rdr["UGST"] as decimal?,
        rdr["HSNCode"] as string);
}
