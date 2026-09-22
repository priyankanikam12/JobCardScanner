using Microsoft.Data.SqlClient;

namespace JobCardScanner.Api.Services;

/// <summary>One active dealer row read from BAPL's C_CustomerMaster (read-only, separate
/// database from JobCardScannerDb).</summary>
public record BaplDealerRow(
    string CustomerCode,
    string CustomerName,
    string City,
    string State,
    string Mobile,
    string ContactPerson,
    string ContactEmail,
    string? AssignedRepCode);

/// <summary>
/// One row from BAPL's C_ItemMaster (baplfinal, via BaplConnection - the SAME connection/database
/// BaplDealerService's own FetchActiveDealersAsync already reads C_CustomerMaster from) - CONFIRMED
/// 2026-09-21 via a live `select * from C_ItemMaster` you pasted directly, with three real sample
/// rows. This is a DIFFERENT table from BAPLDMSvad's own ItemMaster (see
/// BaplDmsService.GetPartsInventoryAsync/BaplDmsPartStockRow) - a different database on a different
/// server entirely (baplfinal on sapdatawarehoue.database.windows.net vs BAPLDMSvad) - and critically
/// it carries what BAPLDMSvad's ItemMaster does NOT: Dlr_Price (dealer price) and per-item
/// SGST/CGST/IGST/UGST percentages, all four populated directly on every sample row you shared
/// (e.g. ItemCode 20B8021001AS: Dlr_Price 6985.00, SGST 9.00, CGST 9.00, IGST 18.00, UGST 9.00).
/// This closes the gap every earlier round of Material Transfer/Repair Bill GST work flagged as
/// unconfirmed (the flat 18% default, the "no per-part tax-rate source exists" disclaimers in
/// MaterialTransferCreatePage.tsx/RepairBillCreatePage.tsx) - see GetItemMasterByCodesAsync/
/// SearchItemMasterAsync's own doc comments for how this is now used.
/// DisplayName/Item_Type/Status are carried for the "Item Master" sidebar page's own browse table,
/// not used by the GST-enrichment path.
/// </summary>
public record BaplItemMasterRow(
    string ItemCode,
    string? ItemName,
    string? DisplayName,
    string? HsnCode,
    decimal? DlrPrice,
    decimal? Sgst,
    decimal? Cgst,
    decimal? Igst,
    string? ItemType,
    string? Status);

public interface IBaplDealerService
{
    /// <summary>
    /// Every active (Active = 'Y') row in BAPL's C_CustomerMaster. Throws
    /// <see cref="InvalidOperationException"/> with a human-readable message if BaplConnection
    /// isn't configured, or the query fails (network/credentials/schema).
    /// </summary>
    Task<IReadOnlyList<BaplDealerRow>> FetchActiveDealersAsync(CancellationToken ct = default);

    /// <summary>
    /// Browse/search across BAPL's C_ItemMaster (baplfinal) - backs the "Item Master" sidebar page.
    /// q (optional) substring-matches ItemCode/ItemName/DisplayName; omit for an unfiltered browse.
    /// Capped at 1000 rows per call (C_ItemMaster is a large shared catalog - narrow with q for a
    /// specific item). Throws <see cref="InvalidOperationException"/> on a real failure (confirmed
    /// schema - see <see cref="BaplItemMasterRow"/>'s doc comment).
    /// </summary>
    Task<IReadOnlyList<BaplItemMasterRow>> SearchItemMasterAsync(string? q, CancellationToken ct = default);

    /// <summary>
    /// 2026-09-21 ("Rate = Dlr_Price - GST% ... that all we want to fetch from baplfinal databse"):
    /// bulk-looks-up C_ItemMaster by an exact set of ItemCodes (e.g. everything a Material
    /// Transfer/Repair Bill line's part picker currently has loaded for one workshop location) -
    /// the GST-rate enrichment source for those two pages' Rate/MRP/CGST/SGST/IGST calculation
    /// (see MaterialTransferCreatePage.tsx/RepairBillCreatePage.tsx's own doc comments for the
    /// formula). Returns a dictionary keyed by ItemCode (case-insensitive) with an entry ONLY for a
    /// code C_ItemMaster actually has a row for - a code with no match is simply absent, not an
    /// error, since not every DMS/Part-Upload item code is necessarily also in this catalog.
    /// UNLIKE SearchItemMasterAsync, this is deliberately best-effort/non-throwing: it's an
    /// ENRICHMENT of an already-working part picker, not that picker's primary data source, so a
    /// connection/schema problem here is logged and degrades to an empty dictionary (every line
    /// simply falls back to its pre-existing default-18%-split behavior) rather than breaking the
    /// picker outright. An empty <paramref name="itemCodes"/> short-circuits to an empty dictionary
    /// without a round trip.
    /// </summary>
    Task<IReadOnlyDictionary<string, BaplItemMasterRow>> GetItemMasterByCodesAsync(IReadOnlyList<string> itemCodes, CancellationToken ct = default);
}

/// <summary>
/// Reads BGauss's real dealer network from the BAPL ERP data warehouse so Admin -> Users'
/// "Bulk Import Dealers from ERP" panel can create a JobCardScanner <see cref="Models.Dealer"/>
/// (+ a Dealer Admin login) for each one, instead of the two seeded demo dealers being the only
/// ones that ever exist. Plain ADO.NET (Microsoft.Data.SqlClient, already a transitive
/// dependency of the SQL Server EF provider this project already uses) rather than a second EF
/// DbContext, since this is a single read-only query against a schema this app doesn't own or
/// migrate. Query and column names are copied from a working query against this exact BaplFinal
/// database in another BGauss internal app - do not change the table/column names without
/// verifying against that schema first.
/// </summary>
public class BaplDealerService : IBaplDealerService
{
    private readonly IConfiguration _config;
    private readonly ILogger<BaplDealerService> _logger;

    public BaplDealerService(IConfiguration config, ILogger<BaplDealerService> logger)
    {
        _config = config;
        _logger = logger;
    }

    public async Task<IReadOnlyList<BaplDealerRow>> FetchActiveDealersAsync(CancellationToken ct = default)
    {
        var connStr = _config.GetConnectionString("BaplConnection");
        if (string.IsNullOrWhiteSpace(connStr))
        {
            throw new InvalidOperationException(
                "BaplConnection isn't configured in appsettings.json's ConnectionStrings section.");
        }

        const string sql = @"
            SELECT
                c.CustomerCode,
                c.CustomerName,
                ISNULL(ci.CityName, '')     AS City,
                ISNULL(st.StateName, '')    AS State,
                ISNULL(c.Mobile, '')        AS Mobile,
                ISNULL(c.ContactPerson, '') AS ContactPerson,
                ISNULL(c.Email, '')         AS ContactEmail,
                rep.InternalRepresentative  AS AssignedRepCode
            FROM [dbo].[C_CustomerMaster] c
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
            LEFT JOIN [dbo].[C_CityMaster]  ci ON ci.Id = c.CityId
            OUTER APPLY (
                -- A customer can in principle have more than one C_CustomerIntRepDetail row
                -- (e.g. reassigned reps over time) - take the most recently modified one.
                SELECT TOP 1 r.InternalRepresentative
                FROM [dbo].[C_CustomerIntRepDetail] r
                WHERE r.CustomerCode = c.CustomerCode
                ORDER BY r.ModifiedOn DESC
            ) rep
            WHERE c.Active = 'Y'
            ORDER BY c.CustomerName";

        var results = new List<BaplDealerRow>();
        try
        {
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDealerRow(
                    rdr["CustomerCode"] as string ?? "",
                    rdr["CustomerName"] as string ?? "",
                    rdr["City"] as string ?? "",
                    rdr["State"] as string ?? "",
                    rdr["Mobile"] as string ?? "",
                    rdr["ContactPerson"] as string ?? "",
                    rdr["ContactEmail"] as string ?? "",
                    rdr["AssignedRepCode"] as string));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"Could not read BAPL's dealer master (C_CustomerMaster): {ex.Message}", ex);
        }

        return results;
    }

    // Column list is the subset of C_ItemMaster's full ~85-column schema (see BaplItemMasterRow's
    // doc comment) this app actually needs - the "Item Master" browse page's columns plus the
    // Dlr_Price/SGST/CGST/IGST GST-enrichment fields. Every column here is CONFIRMED from your
    // pasted `select * from C_ItemMaster` (real column names, real sample values) - not guessed.
    private const string ItemMasterSelectSql = @"
        SELECT ItemCode, ItemName, DisplayName, HSNCode, Dlr_Price, SGST, CGST, IGST, Item_Type, Status
        FROM [dbo].[C_ItemMaster]";

    private static BaplItemMasterRow MapItemMasterRow(SqlDataReader rdr) => new(
        rdr["ItemCode"] as string ?? "",
        rdr["ItemName"] as string,
        rdr["DisplayName"] as string,
        // HSNCode came through in your sample as a plain digit string ("87116020") but its
        // underlying SQL type wasn't independently confirmed the way ItemCode/ItemName's were -
        // ToString() (not `as string`) so this still reads correctly even if it turns out to be
        // stored as a numeric type on this table, matching the defensive pattern
        // BaplDmsService.MapItemMasterRow-adjacent code (e.g. RepairBillDetailRow.ItemType) already
        // uses elsewhere in this codebase for the same reason.
        rdr["HSNCode"] is DBNull ? null : rdr["HSNCode"].ToString(),
        ToNullableDecimal(rdr["Dlr_Price"]),
        ToNullableDecimal(rdr["SGST"]),
        ToNullableDecimal(rdr["CGST"]),
        ToNullableDecimal(rdr["IGST"]),
        rdr["Item_Type"] is DBNull ? null : rdr["Item_Type"].ToString(),
        rdr["Status"] is DBNull ? null : rdr["Status"].ToString());

    /// <summary>Same defensive numeric read as BaplDmsService.ToNullableDecimal - C_ItemMaster's
    /// SGST/CGST/IGST/Dlr_Price columns' exact underlying SQL type (decimal vs float/real/money)
    /// wasn't independently pinned down beyond "these look like decimals in the sample data", so
    /// Convert.ToDecimal is used instead of the `as decimal?` cast operator, which silently returns
    /// null for a boxed value that isn't EXACTLY System.Decimal.</summary>
    private static decimal? ToNullableDecimal(object val) => val is DBNull ? null : Convert.ToDecimal(val);

    public async Task<IReadOnlyList<BaplItemMasterRow>> SearchItemMasterAsync(string? q, CancellationToken ct = default)
    {
        var connStr = _config.GetConnectionString("BaplConnection");
        if (string.IsNullOrWhiteSpace(connStr))
            throw new InvalidOperationException("BaplConnection isn't configured in appsettings.json's ConnectionStrings section.");

        var sql = $@"
            SELECT TOP 1000 ItemCode, ItemName, DisplayName, HSNCode, Dlr_Price, SGST, CGST, IGST, Item_Type, Status
            FROM [dbo].[C_ItemMaster]
            WHERE (@q IS NULL OR ItemCode LIKE @q OR ItemName LIKE @q OR DisplayName LIKE @q)
            ORDER BY ItemName";

        var results = new List<BaplItemMasterRow>();
        try
        {
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            cmd.Parameters.AddWithValue("@q", string.IsNullOrWhiteSpace(q) ? (object)DBNull.Value : $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct)) results.Add(MapItemMasterRow(rdr));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL's item master (C_ItemMaster): {ex.Message}", ex);
        }

        return results;
    }

    public async Task<IReadOnlyDictionary<string, BaplItemMasterRow>> GetItemMasterByCodesAsync(IReadOnlyList<string> itemCodes, CancellationToken ct = default)
    {
        var result = new Dictionary<string, BaplItemMasterRow>(StringComparer.OrdinalIgnoreCase);
        var codes = (itemCodes ?? Array.Empty<string>())
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(2000) // a single workshop location's picker list is nowhere near this - just a sanity cap
            .ToList();
        if (codes.Count == 0) return result;

        var connStr = _config.GetConnectionString("BaplConnection");
        if (string.IsNullOrWhiteSpace(connStr))
        {
            // Best-effort enrichment (see this method's interface doc comment) - not configured is
            // not an error here, just "no enrichment available", same as this file's config check
            // elsewhere throws for the PRIMARY dealer-import path but this one degrades instead.
            _logger.LogInformation("BaplConnection isn't configured - skipping C_ItemMaster GST/Dealer Price enrichment for {Count} item code(s)", codes.Count);
            return result;
        }

        try
        {
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync(ct);
            var inClause = string.Join(",", codes.Select((_, i) => $"@c{i}"));
            var sql = $"{ItemMasterSelectSql} WHERE ItemCode IN ({inClause})";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            for (var i = 0; i < codes.Count; i++) cmd.Parameters.AddWithValue($"@c{i}", codes[i]);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var row = MapItemMasterRow(rdr);
                if (row.ItemCode.Length > 0) result[row.ItemCode] = row;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read BAPL's item master (C_ItemMaster) for {Count} item code(s) - GST/Dealer Price enrichment skipped, falling back to defaults", codes.Count);
        }

        return result;
    }
}
