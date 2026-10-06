using System.Data;
using System.Diagnostics;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services;

/// <summary>
/// One row of JobCardScannerDb's own copy of BAPL's C_ItemMaster, as the Item Master page and the Job Card
/// "Part Suggestion" picker need it. Property names deliberately match the old BaplItemMasterRow's (ItemCode /
/// ItemName / DisplayName / HsnCode / DlrPrice / Sgst / Cgst / Igst / ItemType / Status), so the callers'
/// existing field reads keep compiling. Only a handful of the table's 85 columns are read here - the rest
/// are stored (a faithful mirror) but not needed by any screen yet.
/// </summary>
public class LocalItemMasterRow
{
    public string ItemCode { get; set; } = "";
    public string? ItemName { get; set; }
    public string? DisplayName { get; set; }
    public string? HsnCode { get; set; }
    public decimal DlrPrice { get; set; }
    public decimal Sgst { get; set; }
    public decimal Cgst { get; set; }
    public decimal Igst { get; set; }
    /// <summary>The source's Item_Type column (nvarchar(max)) - CONFIRMED from BaplDealerService.MapItemMasterRow, which
    /// has always read this one (not the separate varchar(1) ItemType column) for the Item Master page's Type column.</summary>
    public string? ItemType { get; set; }
    /// <summary>"Y" or NULL = active, "N" = deactivated (BAPL's own convention, confirmed by you 2026-10-06).</summary>
    public string? Status { get; set; }
}

/// <summary>Pricing/tax columns for one item - the local-table equivalent of BaplItemPricingRow's source query.</summary>
public class LocalItemPricingRow
{
    public string ItemCode { get; set; } = "";
    public string? ItemName { get; set; }
    public decimal DlrPrice { get; set; }
    public decimal? SalesPrice { get; set; }
    public decimal Sgst { get; set; }
    public decimal Cgst { get; set; }
    public decimal Igst { get; set; }
    public decimal Ugst { get; set; }
    public string? HsnCode { get; set; }
}

public record ItemMasterSyncStatus(bool TableExists, int Rows, DateTime? LastSyncedAt);
public record ItemMasterSyncResult(int Rows, double Seconds, DateTime SyncedAt);

public interface ILocalItemMasterService
{
    /// <summary>Substring search over ItemCode / ItemName / DisplayName / HSNCode in JobCardScannerDb's own C_ItemMaster
    /// (blank q = browse), ordered by ItemName then ItemCode, FILTERED BY THE SIGNED-IN USER'S ROLE: CorporateAdmin and
    /// SystemAdmin see every row of the table (all spare parts, active or not, discontinued A2/B8 included); every other
    /// role sees only ACTIVE (Status Y or NULL), CONTINUING (ItemName not starting A2 / B8) parts - see
    /// LocalItemMasterService's doc comment. <paramref name="take"/> &lt;= 0 means NO row limit; a positive value caps the
    /// result (clamped to 100,000). <paramref name="activeOnly"/> = true applies the "active + continuing" filter to EVERY role,
    /// admins included - used by the transaction pickers (Job Card Part Suggestion, Material Transfer), which must only offer parts that
    /// can still be sold; the Item Master page leaves it false so an admin can still see everything. Throws InvalidOperationException
    /// with a plain message if the table has not been created yet.</summary>
    Task<IReadOnlyList<LocalItemMasterRow>> SearchAsync(string? q, int take, CancellationToken ct = default, bool activeOnly = false);

    Task<ItemMasterSyncStatus> GetStatusAsync(CancellationToken ct = default);

    /// <summary>Exact-ItemCode lookup in JobCardScannerDb's own copy - the local equivalent of
    /// IBaplDealerService.GetItemMasterByCodesAsync (Material Transfer / Repair Bill Rate + GST enrichment). NOT filtered by
    /// role - it only prices lines already on a bill. Returns null when the local table is missing or has never been synced, so
    /// the caller can fall back to the live baplfinal read; otherwise a dictionary (case-insensitive) with an entry only for
    /// codes that matched.</summary>
    Task<IReadOnlyDictionary<string, LocalItemMasterRow>?> GetByCodesAsync(IReadOnlyList<string> itemCodes, CancellationToken ct = default);

    /// <summary>Same lookup shaped as BaplItemPricingRow (adds SalesPrice / UGST) - the local equivalent of
    /// IBaplItemPricingService.GetItemsPricingAsync. null = not synced yet (caller falls back to live).</summary>
    Task<IReadOnlyList<BaplItemPricingRow>?> GetPricingByCodesAsync(IReadOnlyList<string> itemCodes, CancellationToken ct = default);

    /// <summary>Replaces JobCardScannerDb's C_ItemMaster with a fresh copy of baplfinal's rows WHERE ProductMainGroupId = 2
    /// (spare parts only). All-or-nothing: one transaction deletes the old rows and bulk-loads the new ones, so a failure
    /// part-way leaves the previous data untouched. Only one sync runs at a time (a second call throws
    /// InvalidOperationException).</summary>
    Task<ItemMasterSyncResult> SyncFromBaplAsync(CancellationToken ct = default);
}

/// <summary>
/// 2026-10-05 ("create this table in our Jobcard Db, fetch data from baplfinal ... and show on our UI from our
/// C_ItemMaster and also in jobcard"): the item catalogue is COPIED from BAPL's C_ItemMaster (baplfinal, connection string
/// "BaplConnection", read-only) into JobCardScannerDb's own dbo.C_ItemMaster (created by
/// sql/2026-10-05_create_c_itemmaster_table.sql), and the Item Master page and Job Card Part Suggestion read THAT copy instead
/// of querying baplfinal live on every keystroke.
///
/// 2026-10-06 ("want to fetch only ... where ProductMainGroupId=2" + role-wise visibility):
///  - WHAT IS COPIED: only `SELECT * FROM C_ItemMaster WHERE ProductMainGroupId = 2` (<see cref="SpareMainGroupId"/> - spare
///    parts). Vehicles and every other group are not brought across at all.
///  - WHO SEES WHAT: CorporateAdmin and SystemAdmin see everything that was copied. Every other role sees only the parts that
///    are still sold:  Status = 'Y' OR Status IS NULL  (Y / NULL = active, N = deactivated - your definition; note a plain
///    SQL `IN ('Y', NULL)` would silently drop the NULLs, so it is written as OR ... IS NULL)  AND  ItemName does NOT start
///    with "A2" or "B8" (those two models' parts are discontinued - INTERPRETATION of your sentence "ItemName starting A2 and
///    B8 are Discontinue, only Continue parts for the other roles", flagged below).
///  This replaces the 2026-10-06 DMS Grpidno/DealerCode visibility rule: the rules above use only C_ItemMaster's own columns,
///  so the second sync step and dbo.C_ItemMasterDmsScope are gone (drop the table if you created it).
///
/// Written with plain ADO.NET / EF raw SQL on purpose, so NO DbContext or migration change is needed: the sync reads baplfinal
/// through SqlConnection and bulk-loads the local table through SqlBulkCopy; searches use Database.SqlQueryRaw (EF Core 7+).
/// Nothing here ever writes to baplfinal. The BAPL password lives only in appsettings.json's BaplConnection - this class never
/// sees or logs it.
///
/// What still reads baplfinal LIVE (unchanged): the dealer import (BaplDealerService) and BaplItemPricingService's single-item
/// lookup. GET /api/item-master/by-codes and the Parts page pricing read the local copy first.
/// </summary>
public class LocalItemMasterService : ILocalItemMasterService
{
    /// <summary>C_ItemMaster.ProductMainGroupId of spare parts - the only group copied and shown. Change here if BAPL's grouping changes.</summary>
    public const int SpareMainGroupId = 2;

    /// <summary>Every column of C_ItemMaster, in the source table's order - used for BOTH the SELECT against
    /// baplfinal and the bulk-copy column mappings, so the two can never drift apart. (Generated from the DDL.)</summary>
    private static readonly string[] Columns =
    {
        "Id",
        "ItemCode",
        "ItemName",
        "ItemType",
        "ManufactureCompany",
        "FinancialItemGroup",
        "ProductMainGroupId",
        "ProductGroupId",
        "ProductTypeId",
        "ProductClassId",
        "ItemSize",
        "NoOfCore",
        "InventoryUnit",
        "ItemWeight",
        "WeightUnit",
        "SalesUnit",
        "SalesPrice",
        "PurchaseUnit",
        "PurchasePrice",
        "CostGroup",
        "CostPrice",
        "WarehouseId",
        "CommodityId",
        "HSNCode",
        "PurchaseLedgerCode",
        "SalesLedgerCode",
        "CapitalLedgerCode",
        "PurchaseReturnLedgerCode",
        "SalesReturnLedgerCode",
        "StockTransferLedgerCode",
        "Excisable",
        "Cenvatable",
        "RG1",
        "RG23",
        "IsBarcoded",
        "CreatedBy",
        "CreatedOn",
        "ModifiedBy",
        "ModifiedOn",
        "InnerCount",
        "CostOfProductionLedgerCode",
        "OuterCount",
        "WIPLedgerCode",
        "MaterialIssforProductionLedgerCode",
        "Length",
        "Width",
        "Height",
        "StockTransferInwardLedgerCode",
        "BrandId",
        "Item_Type",
        "Veh_Type",
        "Dlr_Price",
        "Item_MOQ",
        "Item_BOQ",
        "SGST",
        "CGST",
        "IGST",
        "UGST",
        "Electric_Vehicle",
        "NoOfBatteries",
        "Status",
        "QualityFlag",
        "WarrantyFlag",
        "WarrantyPeriod",
        "SequenceNoRequired",
        "AutoSequence",
        "FameIILedgerCode",
        "FameIIDiscount",
        "AdjustLedgerCode",
        "BatteryMake",
        "BatteryChemistry",
        "BatteryCapacity",
        "DisplayName",
        "DepreciationLedger",
        "DepreciationReserveLedger",
        "DVAPercentage",
        "BINLocation",
        "DeviceType",
        "ExportSalesLedgerCode",
        "ServiceItem",
        "ExpSalesPrice",
        "PartWt",
        "ErpModel",
        "PartDm",
        "MerchantSalesLedgerCode"
    };

    // Only one sync at a time, across requests.
    private static readonly SemaphoreSlim SyncLock = new(1, 1);

    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<LocalItemMasterService> _logger;
    private readonly ICurrentUserService _currentUser;

    public LocalItemMasterService(JobCardScannerDbContext db, IConfiguration config, ILogger<LocalItemMasterService> logger, ICurrentUserService currentUser)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _currentUser = currentUser;
    }

    private const int SqlInvalidObjectName = 208; // "Invalid object name 'dbo.C_ItemMaster'" - the table has not been created yet

    private static bool IsMissingTable(Exception ex) => ex.GetBaseException() is SqlException { Number: SqlInvalidObjectName };

    /// <summary>CorporateAdmin / SystemAdmin see every copied row; everyone else gets the "active + continuing" filter.</summary>
    private bool SeesEverything => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    public async Task<IReadOnlyList<LocalItemMasterRow>> SearchAsync(string? q, int take, CancellationToken ct = default, bool activeOnly = false)
    {
        // take <= 0 = no limit (whole catalogue). Otherwise an int we validate here, so it is safe to inline.
        var top = take <= 0 ? "" : $"TOP ({Math.Min(take, 100_000)})";
        var trimmed = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
        // Escape LIKE wildcards so a typed "%" or "_" is searched literally.
        var like = trimmed is null ? null : "%" + trimmed.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_").Replace("[", "\\[") + "%";

        // Everyone except CorporateAdmin / SystemAdmin: active (Y or NULL) AND not a discontinued A2 / B8 part.
        // INTERPRETATION (flagged): "ItemName starts with A2 / B8" is matched on the trimmed ItemName, case-insensitively
        // (the database collation), e.g. "A2 Fender Frame PP", "B8 Frame Complete". Status is compared trimmed.
        var roleClause = (SeesEverything && !activeOnly) ? "" : @"
              AND (m.[Status] IS NULL OR LTRIM(RTRIM(m.[Status])) = 'Y')
              AND NOT (LTRIM(ISNULL(m.[ItemName], '')) LIKE 'A2%' OR LTRIM(ISNULL(m.[ItemName], '')) LIKE 'B8%')";

        var sql = $@"
            SELECT {top}
                m.[ItemCode]                                       AS ItemCode,
                m.[ItemName]                                       AS ItemName,
                m.[DisplayName]                                    AS DisplayName,
                m.[HSNCode]                                        AS HsnCode,
                m.[Dlr_Price]                                      AS DlrPrice,
                m.[SGST]                                           AS Sgst,
                m.[CGST]                                           AS Cgst,
                m.[IGST]                                           AS Igst,
                m.[Item_Type]                                      AS ItemType,
                m.[Status]                                         AS Status
            FROM [dbo].[C_ItemMaster] m
            WHERE m.[ProductMainGroupId] = @grp
              AND (@like IS NULL
                   OR m.[ItemCode]    LIKE @like ESCAPE '\'
                   OR m.[ItemName]    LIKE @like ESCAPE '\'
                   OR m.[DisplayName] LIKE @like ESCAPE '\'
                   OR m.[HSNCode]     LIKE @like ESCAPE '\'){roleClause}
            ORDER BY m.[ItemName], m.[ItemCode]"; // same order the page always had (BaplDealerService.SearchItemMasterAsync: ORDER BY ItemName)

        var ps = new object[]
        {
            new SqlParameter("@like", SqlDbType.NVarChar, 400) { Value = (object?)like ?? DBNull.Value },
            new SqlParameter("@grp", SqlDbType.Int) { Value = SpareMainGroupId },
        };

        try
        {
            return await _db.Database.SqlQueryRaw<LocalItemMasterRow>(sql, ps).ToListAsync(ct);
        }
        catch (Exception ex) when (IsMissingTable(ex))
        {
            throw new InvalidOperationException("The Item Master table (dbo.C_ItemMaster) has not been created in JobCardScannerDb yet - run sql/2026-10-05_create_c_itemmaster_table.sql, then click 'Sync from BAPL' on the Item Master page.", ex);
        }
    }

    public async Task<ItemMasterSyncStatus> GetStatusAsync(CancellationToken ct = default)
    {
        try
        {
            var row = await _db.Database
                .SqlQueryRaw<StatusRow>("SELECT COUNT(*) AS [Rows], MAX([SyncedAt]) AS [LastSyncedAt] FROM [dbo].[C_ItemMaster]")
                .SingleAsync(ct);
            return new ItemMasterSyncStatus(true, row.Rows, row.LastSyncedAt);
        }
        catch (Exception ex) when (IsMissingTable(ex))
        {
            return new ItemMasterSyncStatus(false, 0, null);
        }
    }

    private static List<string> CleanCodes(IReadOnlyList<string>? itemCodes) =>
        (itemCodes ?? Array.Empty<string>())
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(2000) // same sanity cap BaplDealerService.GetItemMasterByCodesAsync uses
            .ToList();

    /// <summary>True when dbo.C_ItemMaster exists and holds at least one row (i.e. it has been synced).</summary>
    private async Task<bool> HasDataAsync(CancellationToken ct)
    {
        var status = await GetStatusAsync(ct);
        return status.TableExists && status.Rows > 0;
    }

    public async Task<IReadOnlyDictionary<string, LocalItemMasterRow>?> GetByCodesAsync(IReadOnlyList<string> itemCodes, CancellationToken ct = default)
    {
        var codes = CleanCodes(itemCodes);
        var result = new Dictionary<string, LocalItemMasterRow>(StringComparer.OrdinalIgnoreCase);
        if (!await HasDataAsync(ct)) return null;
        if (codes.Count == 0) return result;

        var inClause = string.Join(",", codes.Select((_, i) => $"@c{i}"));
        var sql = $@"
            SELECT [ItemCode] AS ItemCode, [ItemName] AS ItemName, [DisplayName] AS DisplayName, [HSNCode] AS HsnCode,
                   [Dlr_Price] AS DlrPrice, [SGST] AS Sgst, [CGST] AS Cgst, [IGST] AS Igst,
                   [Item_Type] AS ItemType, [Status] AS Status
            FROM [dbo].[C_ItemMaster]
            WHERE [ItemCode] IN ({inClause})";
        var ps = codes.Select((c, i) => (object)new SqlParameter($"@c{i}", c)).ToArray();
        var rows = await _db.Database.SqlQueryRaw<LocalItemMasterRow>(sql, ps).ToListAsync(ct);
        foreach (var r in rows)
            if (r.ItemCode.Length > 0) result[r.ItemCode] = r;
        return result;
    }

    public async Task<IReadOnlyList<BaplItemPricingRow>?> GetPricingByCodesAsync(IReadOnlyList<string> itemCodes, CancellationToken ct = default)
    {
        var codes = CleanCodes(itemCodes);
        if (!await HasDataAsync(ct)) return null;
        if (codes.Count == 0) return Array.Empty<BaplItemPricingRow>();

        var inClause = string.Join(",", codes.Select((_, i) => $"@c{i}"));
        var sql = $@"
            SELECT [ItemCode] AS ItemCode, [ItemName] AS ItemName, [Dlr_Price] AS DlrPrice, [SalesPrice] AS SalesPrice,
                   [SGST] AS Sgst, [CGST] AS Cgst, [IGST] AS Igst, [UGST] AS Ugst, [HSNCode] AS HsnCode
            FROM [dbo].[C_ItemMaster]
            WHERE [ItemCode] IN ({inClause})";
        var ps = codes.Select((c, i) => (object)new SqlParameter($"@c{i}", c)).ToArray();
        var rows = await _db.Database.SqlQueryRaw<LocalItemPricingRow>(sql, ps).ToListAsync(ct);
        return rows.Select(r => new BaplItemPricingRow(r.ItemCode, r.ItemName, r.DlrPrice, r.SalesPrice, r.Sgst, r.Cgst, r.Igst, r.Ugst, r.HsnCode)).ToList();
    }

    // Shape for the status query only.
    private class StatusRow
    {
        public int Rows { get; set; }
        public DateTime? LastSyncedAt { get; set; }
    }

    public async Task<ItemMasterSyncResult> SyncFromBaplAsync(CancellationToken ct = default)
    {
        var baplCs = _config.GetConnectionString("BaplConnection")
            ?? throw new InvalidOperationException("BaplConnection isn't configured in appsettings.json's ConnectionStrings section.");
        var localCs = _db.Database.GetConnectionString()
            ?? throw new InvalidOperationException("Could not resolve JobCardScannerDb's connection string.");

        if (!await SyncLock.WaitAsync(0, ct))
            throw new InvalidOperationException("An Item Master sync is already running - wait for it to finish.");

        var clock = Stopwatch.StartNew();
        try
        {
            await using var src = new SqlConnection(baplCs);
            await src.OpenAsync(ct);
            await using var dst = new SqlConnection(localCs);
            await dst.OpenAsync(ct);
            await using var tx = (SqlTransaction)await dst.BeginTransactionAsync(ct);

            try
            {
                // Fresh copy: drop the old rows, then stream baplfinal's SPARE-PART rows straight in - one transaction, so a
                // failure anywhere rolls back to the previous data.
                await using (var del = new SqlCommand("DELETE FROM [dbo].[C_ItemMaster]", dst, tx) { CommandTimeout = 300 })
                    await del.ExecuteNonQueryAsync(ct);

                // select * from C_ItemMaster where ProductMainGroupId = 2   (explicit column list, same 85 columns as the table)
                var select = "SELECT " + string.Join(", ", Columns.Select(c => $"[{c}]")) + " FROM [dbo].[C_ItemMaster] WHERE [ProductMainGroupId] = @grp";
                await using var cmd = new SqlCommand(select, src) { CommandTimeout = 300 };
                cmd.Parameters.Add(new SqlParameter("@grp", SqlDbType.Int) { Value = SpareMainGroupId });
                await using var reader = await cmd.ExecuteReaderAsync(ct);

                using var bulk = new SqlBulkCopy(dst, SqlBulkCopyOptions.TableLock, tx)
                {
                    DestinationTableName = "[dbo].[C_ItemMaster]",
                    BulkCopyTimeout = 600,
                    BatchSize = 2000,
                };
                foreach (var c in Columns) bulk.ColumnMappings.Add(c, c);
                await bulk.WriteToServerAsync(reader, ct);

                int rows;
                await using (var count = new SqlCommand("SELECT COUNT(*) FROM [dbo].[C_ItemMaster]", dst, tx))
                    rows = Convert.ToInt32(await count.ExecuteScalarAsync(ct));

                await tx.CommitAsync(ct);
                clock.Stop();
                _logger.LogInformation("Item Master sync: copied {Rows} spare-part rows (ProductMainGroupId = {Grp}) from baplfinal's C_ItemMaster in {Seconds:F1}s.", rows, SpareMainGroupId, clock.Elapsed.TotalSeconds);
                return new ItemMasterSyncResult(rows, Math.Round(clock.Elapsed.TotalSeconds, 1), DateTime.UtcNow);
            }
            catch
            {
                await tx.RollbackAsync(CancellationToken.None);
                throw;
            }
        }
        catch (SqlException ex) when (ex.Number == SqlInvalidObjectName && ex.Message.Contains("C_ItemMaster", StringComparison.OrdinalIgnoreCase) && ex.Message.Contains("dbo", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"A C_ItemMaster table is missing: {ex.Message} (if it is JobCardScannerDb's copy, run sql/2026-10-05_create_c_itemmaster_table.sql first).", ex);
        }
        catch (SqlException ex)
        {
            _logger.LogError(ex, "Item Master sync failed.");
            throw new InvalidOperationException($"Item Master sync failed: {ex.Message}", ex);
        }
        finally
        {
            SyncLock.Release();
        }
    }
}