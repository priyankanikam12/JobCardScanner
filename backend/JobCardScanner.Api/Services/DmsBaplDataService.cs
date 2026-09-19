using Microsoft.Data.SqlClient;

namespace JobCardScanner.Api.Services;

/// <summary>
/// One line item (Part/Labour) belonging to a <see cref="DmsBaplDataRepairBillRow"/> - read
/// straight from DMSBAPLDATA's own dbo.DMS_RepairBillItem (confirmed table/column names via the
/// `select * from DMS_RepairBillItem` you ran directly against DMSBAPLDATA - this mirrors
/// AutoGeniusSync.Models.DmsRepairBillItem's shape 1:1, since that's the process that actually
/// writes these rows). All fields nullable except the id/FK - the sync payload (AutoGeniusSync's
/// RepairBillDetailDto) leaves most of these blank for many rows.
/// </summary>
public record DmsBaplDataRepairBillItemRow(
    int Id,
    int RepairBillId,
    long? ItemIdno,
    string? ItemCode,
    string? ItemDesc,
    string? ItemType,
    int? Qty,
    decimal? Rate,
    string? IssueType,
    decimal? SgstPer,
    decimal? SgstAmount,
    decimal? CgstPer,
    decimal? CgstAmount,
    decimal? IgstPer,
    decimal? IgstAmount,
    decimal? WavRate,
    decimal? TotAmnt,
    string? MtrlIssue);

/// <summary>
/// One repair bill header row from DMSBAPLDATA's own dbo.DMS_RepairBill (confirmed table/column
/// names via the `select * from DMS_RepairBill` you ran directly against DMSBAPLDATA) - the
/// Zomato-fleet repair bill data AutoGeniusSync syncs in from BAPL DMS's live RepairBill documents.
/// This is a DIFFERENT database from both JobCardScannerDb and BAPL DMS's own live BAPLDMSvad (see
/// DMSBAPLDATAConnection's comment in appsettings.json) - a synced/replicated read model, not the
/// system of record, so this service is read-only, same convention as BaplDmsService.
/// </summary>
public record DmsBaplDataRepairBillRow(
    int Id,
    string? DealerName,
    string? DealerCode,
    long? UniqueKey,
    long? UniqueId,
    long? InvoiceNo,
    DateTime? InvoiceDate,
    string? Location,
    string? PartyName,
    int? BillType,
    string? CashType,
    string? CashAccount,
    string? RegNo,
    string? ChassisNo,
    DateTime? CreatedAt,
    DateTime? UpdatedAt,
    IReadOnlyList<DmsBaplDataRepairBillItemRow> Items);

/// <summary>
/// One labour line belonging to a <see cref="DmsBaplDataMaterialTransferItemRow"/> - read straight
/// from DMSBAPLDATA's own dbo.DMS_MaterialTransferLabor (confirmed table/column names via the
/// `select * from DMS_MaterialTransferLabor` you ran directly against DMSBAPLDATA - mirrors
/// AutoGeniusSync.Models.DmsMaterialTransferLabor's shape 1:1). LbrIdno/LbrName/LbrDescription are
/// nullable per that model; the rate/tax columns are non-nullable decimals there (defaulted to 0
/// by the sync mapper when the source payload leaves them blank), so kept non-nullable here too.
/// </summary>
public record DmsBaplDataMaterialTransferLaborRow(
    int Id,
    int MaterialTransferItemId,
    long? LbrIdno,
    string? LbrName,
    string? LbrDescription,
    decimal LbrRate,
    decimal SgstPer,
    decimal SgstAmount,
    decimal CgstPer,
    decimal CgstAmount,
    decimal IgstPer,
    decimal IgstAmount);

/// <summary>
/// One Part/Labour-carrying line item belonging to a <see cref="DmsBaplDataMaterialTransferRow"/> -
/// read straight from DMSBAPLDATA's own dbo.DMS_MaterialTransferItem (confirmed table/column names
/// via the `select * from DMS_MaterialTransferItem` you ran directly against DMSBAPLDATA - mirrors
/// AutoGeniusSync.Models.DmsMaterialTransferItem's shape 1:1), with its own Labour child rows
/// attached (one item can carry zero or more DMS_MaterialTransferLabor rows, e.g. a part fitted as
/// part of a labour operation).
/// </summary>
public record DmsBaplDataMaterialTransferItemRow(
    int Id,
    int MaterialTransferId,
    long? SourceLineId,
    long? ItemIdno,
    string? ItemName,
    string? ItemDescription,
    string? ItemType,
    decimal Qty,
    decimal Rate,
    decimal SgstPer,
    decimal SgstAmount,
    decimal CgstPer,
    decimal CgstAmount,
    decimal IgstPer,
    decimal IgstAmount,
    decimal Discount,
    decimal Mrp,
    IReadOnlyList<DmsBaplDataMaterialTransferLaborRow> Labour);

/// <summary>
/// One material transfer document header from DMSBAPLDATA's own dbo.DMS_MaterialTransfer
/// (confirmed table/column names via the `select * from DMS_MaterialTransfer` you ran directly
/// against DMSBAPLDATA) - the "Material Transfer" sidebar page's data source, scoped by LocCode
/// (2026-09-17: "material transfer using location wise which dealer login that location wise which
/// already we done w1..wn series for" - the SAME per-dealer W1..Wn workshop-location resolution
/// already built for the "DMS Parts Inventory" panel on the Parts & Inventory page - see
/// BaplDmsController.Workshops/GetWorkshopsAsync). Same DMSBAPLDATA database as
/// <see cref="DmsBaplDataRepairBillRow"/> above - a synced/replicated read model (AutoGeniusSync),
/// not the live BAPL DMS database - this app never writes to it, same as everything else here.
/// The Action column (a JSON audit-trail array AutoGeniusSync appends to on every insert/update) is
/// intentionally left out of this shape - it's sync-process bookkeeping, not something the sidebar
/// page needs to show.
/// </summary>
public record DmsBaplDataMaterialTransferRow(
    int Id,
    string? DealerName,
    string? DealerCode,
    long? SourceUniqueId,
    long? SourceJobId,
    int? DocNo,
    DateTime? DocDate,
    string? DocType,
    string? Location,
    string? LocCode,
    string? TechnicianName,
    string? UniqueKey,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<DmsBaplDataMaterialTransferItemRow> Items);

/// <summary>
/// One vehicle sale row from DMSBAPLDATA's own dbo.DMS_VehicleSales - the "Vehicle Sale" sidebar
/// page's data source (2026-09-18: "i want 1 option in sidebar that was Vehicle sale from
/// DMSBAPLDATA select * from DMS_VehicleSales where SoldTo like '%Zomato%'").
///
/// CORRECTED 2026-09-18: the first version of this DTO used a column list built from what your
/// pasted `select *` grid happened to show (Id, LedgerId, ChassisNo, ItemCode, ItemName, ItemColor,
/// DealerId, LocationCode, SaleDate, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, RegNo) and
/// deliberately avoided the much larger AutoGeniusSync.Models.DmsVehicleSale shape you'd also
/// pasted, on the theory the two didn't match. That was wrong - running it threw "Invalid column
/// name" for every one of those columns except Id/ChassisNo/SoldTo, which proves the OPPOSITE: this
/// table's real shape IS the AutoGeniusSync model (it's what actually generated the column list you
/// originally saw truncated in a wide grid - your `select *` grid must have been scrolled/cut off
/// before the columns that matter here). This DTO now carries that model's full field set. Field
/// names below match the model's C# property spelling exactly (including the scaffolded-looking
/// lowercase-after-acronym forms like Sgstper/Hsnsaccode/Oemmodel/Vcu/FameIi) - SQL Server's default
/// collation matches column names case-insensitively, so the SELECT list uses that same spelling
/// and should resolve to the real columns regardless of their original casing.
/// Only Id, ChassisNo and SoldTo are independently confirmed live (they didn't error). Every other
/// field here is inferred from your AutoGeniusSync model, not yet independently confirmed - if any
/// of them still come back "Invalid column name", paste the exact error again and only those need
/// fixing/dropping, not a redo of the whole page.
/// </summary>
public record DmsBaplDataVehicleSaleRow(
    int Id,
    string? DealerName,
    string? DealerCode,
    string? InvoiceNo,
    DateTime? InvoiceDate,
    string? Location,
    string? LocCode,
    string? LocationCity,
    DateTime? CustDob,
    string? Gender,
    string? SoldTo,
    string? AccountType,
    string? PartyEmail,
    string? CusMob,
    string? Address1,
    string? Address2,
    string? City,
    string? State,
    string? ExecutiveName,
    string? Pin,
    string? ChassisNo,
    string? MotorNo,
    string? Remarks,
    string? ItemModel,
    string? Oemmodel,
    string? ColorCode,
    string? VehicleType,
    string? VehicleGroup,
    string? Hsnsaccode,
    string? SaleType,
    string? FinancedBy,
    decimal? FinAmount,
    decimal? ItemRate,
    decimal? InsuAmount,
    decimal? RegnAmount,
    decimal? AcsryAmount,
    decimal? PreGstdiscAmount,
    string? DiscTypeName,
    decimal? PostGstdisc,
    decimal? FameIi,
    decimal? StateFameIi,
    decimal? Sgstper,
    decimal? Sgstamount,
    decimal? Cgstper,
    decimal? Cgstamount,
    decimal? Igstper,
    decimal? Igstamount,
    decimal? NetAmount,
    string? ReferenceNo,
    DateTime? BookingDate,
    string? TotalCount,
    string? Battery,
    string? BatteryChemical,
    string? BatteryCapacity,
    string? BatteryMake,
    string? ChargerNo,
    string? ChargerNo2,
    string? Converter,
    string? Vcu,
    string? ControllerNo,
    string? FameIirequired,
    string? SegmentName,
    string? InstitutionalName,
    string? SchemeName,
    DateTime? CreatedAt,
    DateTime? UpdatedAt);

/// <summary>
/// One job row from DMSBAPLDATA's own dbo.DMS_ServiceHistory - the "Service History" sidebar page's
/// data source (2026-09-18: "here i want after Jobcards this table Servive History From DMSBAPLDATA
/// databse and like screen shot when search chasis or reg in 1 input box dont add filter by").
/// Column list/types match your pasted AutoGeniusSync.Models.DmsServiceHistory EF model exactly,
/// cross-checked field-by-field against a live `select top 1 *` header+row pair you ran directly
/// against DMSBAPLDATA (both lines up to 62 confirmed columns).
///
/// One live column, "Status" (sitting between UpdatedAt and RepairType in the real table), is
/// deliberately left out below - your own DmsServiceHistory.cs model doesn't map it either, since
/// JobStatus (a DB-computed, PERSISTED column) is documented there as the field actually meant to be
/// read. This resolves the "63 live columns vs 62 model properties" discrepancy flagged earlier -
/// it was never a missing/guessed column, just this one the model itself skips on purpose.
///
/// FACT: this table carries only job-level TOTALS (Parts/Accessory/Oil/Labour/OutsideWork/
/// TotalWOTax/GSTAmount/IGSTAmount/NetTotal) - there is no part/labour code/description/HSN/SAC
/// line-item table behind it the way DMS_RepairBill has DMS_RepairBillItem. The legacy
/// mydmsconnect.com "Vehicle History Card Report" PDF's Item Detail/Labour Detail/Battery Detail
/// breakdown can't be reproduced from this table alone - confirmed by your own pasted
/// ServiceHistoryController.cs and DmsServiceHistory.cs, neither of which expose or reference any
/// such child table. Per your instruction, this page shows the flat per-job grid only (same
/// grid+pagination shape as Vehicle Sale/Repair Bill/Material Transfer), not that breakdown.
/// </summary>
public record DmsBaplDataServiceHistoryRow(
    int Id,
    string? DealerCode,
    string? JobNo,
    DateOnly? JobDate,
    string? CompName,
    string? Location,
    string? InTime,
    string? CloseTime,
    string? JobCategory,
    string? Ffrpercentage,
    string? DocNo,
    string? DocType,
    DateOnly? DocDate,
    string? Model,
    string? BrandName,
    string? RegNo,
    string? VehicleType,
    string? EngineNo,
    string? ChassisNo,
    string? Kms,
    string? BatterySerialNo1,
    string? BatterySerialNo2,
    string? BatterySerialNo3,
    string? BatterySerialNo4,
    string? BatterySerialNo5,
    string? BatterySerialNo6,
    string? IndividualAhbattery1,
    string? IndividualAhbattery2,
    string? IndividualAhbattery3,
    string? IndividualAhbattery4,
    string? IndividualAhbattery5,
    string? IndividualAhbattery6,
    string? PartyName,
    string? MobileNumber,
    string? Supervisor,
    string? Technician,
    string? ServiceHead,
    string? JobType,
    DateOnly? SaleDate,
    string? CouponNo,
    DateOnly? ExpectedDeliveryDate,
    DateOnly? ProformaDate,
    DateOnly? InvoiceDate,
    decimal? EstimatedJobExpenses,
    decimal? LabourHours,
    decimal? Parts,
    decimal? Accessory,
    decimal? Oil,
    decimal? Labour,
    decimal? OutsideWork,
    decimal? TotalWotax,
    decimal? Gstamount,
    decimal? Igstamount,
    decimal? NetTotal,
    DateTime? CreatedAt,
    DateTime? UpdatedAt,
    string? RepairType,
    DateOnly? CompletionDate,
    string? JobStatus,
    string? RowHash,
    string? UniqueKey);

/// <summary>
/// One vehicle suggestion for the "Service History" page's typeahead - DISTINCT vehicles (grouped by
/// ChassisNo) from DMSBAPLDATA's own dbo.DMS_ServiceHistory, not BAPL DMS's ChassisDetails (the
/// table the Job Card wizard's /api/bapl-dms/vehicle-suggestions searches).
///
/// 2026-09-18 "its taken from jobcard i want fetch data in service history from [DMS_ServiceHistory
/// query]": the first version of this page's typeahead reused the wizard's own vehicle-suggestions
/// endpoint outright, for speed - but that searches ChassisDetails in the LIVE BAPL DMS database
/// (BAPLDMSvad), which is a sale/stock record, not a service one. A vehicle could be sold (so it
/// shows up there) with zero service visits yet (so picking it here would show "no service history
/// found"), or - the more likely real-world gap - a DMS_ServiceHistory row could exist for a chassis
/// that ChassisDetails doesn't have a clean matching row for. Suggesting from DMS_ServiceHistory
/// itself guarantees every suggestion actually has at least one history row to show.
/// </summary>
public record DmsBaplDataServiceHistorySuggestion(string ChassisNo, string? RegNo, string? Model, DateOnly? LastJobDate);

public interface IDmsBaplDataService
{
    /// <summary>
    /// Repair bills from DMSBAPLDATA's dbo.DMS_RepairBill (+ their dbo.DMS_RepairBillItem line
    /// items), filtered to PartyName LIKE '%{partyNameFilter}%' - the "Repair Bill" sidebar page's
    /// data source. partyNameFilter defaults to "Zomato" per the fleet-scoping this page exists
    /// for; pass null/empty for every party (not currently exposed in the UI, kept for flexibility).
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataRepairBillRow>> GetRepairBillsAsync(string? partyNameFilter, CancellationToken ct = default);

    /// <summary>
    /// Material transfer documents from DMSBAPLDATA's dbo.DMS_MaterialTransfer (+ their
    /// dbo.DMS_MaterialTransferItem/dbo.DMS_MaterialTransferLabor child rows), filtered to an exact
    /// LocCode match - the "Material Transfer" sidebar page's data source, scoped to one dealer's
    /// resolved DMS workshop location (same W1..Wn LocCode the Parts & Inventory page's DMS stock
    /// panel already scopes by). Empty/whitespace locCode returns an empty list rather than every
    /// dealer's data, same "nothing selected yet" convention as GetPartsInventoryAsync.
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataMaterialTransferRow>> GetMaterialTransfersAsync(string? locCode, CancellationToken ct = default);

    /// <summary>
    /// Vehicle sales from DMSBAPLDATA's dbo.DMS_VehicleSales, filtered to SoldTo LIKE '%{soldToFilter}%' -
    /// the "Vehicle Sale" sidebar page's data source. soldToFilter defaults to "Zomato" (set by the
    /// controller, same convention as GetRepairBillsAsync's partyNameFilter); pass null/empty for
    /// every SoldTo. See DmsBaplDataVehicleSaleRow's doc comment for the column-confirmation history.
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataVehicleSaleRow>> GetVehicleSalesAsync(string? soldToFilter, CancellationToken ct = default);

    /// <summary>
    /// Service history job rows from DMSBAPLDATA's dbo.DMS_ServiceHistory, matched against BOTH
    /// ChassisNo and RegNo - the "Service History" sidebar page's single search box (2026-09-18:
    /// "dont add filter by in 1 input box we can search chassis no. or reg no and search"), not a
    /// Chasis/RegNo dropdown the way the legacy report page has. A blank/whitespace search returns
    /// an empty list rather than scanning the whole table - same "nothing selected yet" convention as
    /// GetMaterialTransfersAsync's locCode. Rows marked IsRowTotal (AutoGeniusSync's own
    /// subtotal/summary pseudo-row convention - see your pasted ServiceHistoryController.cs, which
    /// excludes them the same way on every one of its endpoints) are always excluded.
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataServiceHistoryRow>> GetServiceHistoryAsync(string? searchTerm, CancellationToken ct = default);

    /// <summary>
    /// Typeahead suggestions for the "Service History" search box, sourced from DMS_ServiceHistory
    /// itself (one row per distinct ChassisNo, most-recently-serviced first) - see
    /// DmsBaplDataServiceHistorySuggestion's doc comment for why this is deliberately NOT the Job
    /// Card wizard's /api/bapl-dms/vehicle-suggestions (a different table, BAPL DMS's ChassisDetails).
    /// Fewer than 2 characters returns an empty list without querying DMSBAPLDATA.
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataServiceHistorySuggestion>> SearchServiceHistoryVehiclesAsync(string? q, int take, CancellationToken ct = default);
}

public class DmsBaplDataService : IDmsBaplDataService
{
    private readonly IConfiguration _config;
    private readonly ILogger<DmsBaplDataService> _logger;

    public DmsBaplDataService(IConfiguration config, ILogger<DmsBaplDataService> logger)
    {
        _config = config;
        _logger = logger;
    }

    private string ConnStr => _config.GetConnectionString("DMSBAPLDATAConnection")
        ?? throw new InvalidOperationException("DMSBAPLDATAConnection isn't configured in appsettings.json's ConnectionStrings section.");

    public async Task<IReadOnlyList<DmsBaplDataRepairBillRow>> GetRepairBillsAsync(string? partyNameFilter, CancellationToken ct = default)
    {
        var headers = new List<DmsBaplDataRepairBillRow>();
        var itemsByBillId = new Dictionary<int, List<DmsBaplDataRepairBillItemRow>>();

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            const string headerSql = @"
                SELECT
                    Id, DealerName, DealerCode, UniqueKey, UniqueId, InvoiceNo, InvoiceDate,
                    Location, PartyName, BillType, CashType, CashAccount, RegNo, ChassisNo,
                    CreatedAt, UpdatedAt
                FROM [dbo].[DMS_RepairBill]
                WHERE (@party IS NULL OR PartyName LIKE @party)
                ORDER BY InvoiceDate DESC, Id DESC";

            var billIds = new List<int>();
            await using (var cmd = new SqlCommand(headerSql, conn) { CommandTimeout = 30 })
            {
                cmd.Parameters.AddWithValue("@party", string.IsNullOrWhiteSpace(partyNameFilter) ? DBNull.Value : $"%{partyNameFilter.Trim()}%");
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                while (await rdr.ReadAsync(ct))
                {
                    var id = (int)rdr["Id"];
                    billIds.Add(id);
                    headers.Add(new DmsBaplDataRepairBillRow(
                        id,
                        rdr["DealerName"] as string,
                        rdr["DealerCode"] as string,
                        rdr["UniqueKey"] as long?,
                        rdr["UniqueId"] as long?,
                        rdr["InvoiceNo"] as long?,
                        rdr["InvoiceDate"] as DateTime?,
                        rdr["Location"] as string,
                        rdr["PartyName"] as string,
                        rdr["BillType"] as int?,
                        rdr["CashType"] as string,
                        rdr["CashAccount"] as string,
                        rdr["RegNo"] as string,
                        rdr["ChassisNo"] as string,
                        rdr["CreatedAt"] as DateTime?,
                        rdr["UpdatedAt"] as DateTime?,
                        Array.Empty<DmsBaplDataRepairBillItemRow>())); // filled in below once items are read
                }
            }

            if (billIds.Count > 0)
            {
                // Items pulled in one follow-up query for every header just read, rather than
                // per-row, to keep this to two round trips regardless of how many bills matched -
                // same "batch the child rows" shape as BaplDmsService's own multi-row lookups.
                var inClause = string.Join(",", billIds.Select((_, i) => $"@id{i}"));
                var itemSql = $@"
                    SELECT
                        Id, RepairBillId, ItemIdno, ItemCode, ItemDesc, ItemType, Qty, Rate,
                        IssueType, SgstPer, SgstAmount, CgstPer, CgstAmount, IgstPer, IgstAmount,
                        WavRate, TotAmnt, MtrlIssue
                    FROM [dbo].[DMS_RepairBillItem]
                    WHERE RepairBillId IN ({inClause})
                    ORDER BY RepairBillId, Id";

                await using var cmd = new SqlCommand(itemSql, conn) { CommandTimeout = 30 };
                for (var i = 0; i < billIds.Count; i++) cmd.Parameters.AddWithValue($"@id{i}", billIds[i]);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                while (await rdr.ReadAsync(ct))
                {
                    var repairBillId = (int)rdr["RepairBillId"];
                    var item = new DmsBaplDataRepairBillItemRow(
                        (int)rdr["Id"],
                        repairBillId,
                        rdr["ItemIdno"] as long?,
                        rdr["ItemCode"] as string,
                        rdr["ItemDesc"] as string,
                        rdr["ItemType"] as string,
                        rdr["Qty"] as int?,
                        rdr["Rate"] as decimal?,
                        rdr["IssueType"] as string,
                        rdr["SgstPer"] as decimal?,
                        rdr["SgstAmount"] as decimal?,
                        rdr["CgstPer"] as decimal?,
                        rdr["CgstAmount"] as decimal?,
                        rdr["IgstPer"] as decimal?,
                        rdr["IgstAmount"] as decimal?,
                        rdr["WavRate"] as decimal?,
                        rdr["TotAmnt"] as decimal?,
                        rdr["MtrlIssue"] as string);
                    if (!itemsByBillId.TryGetValue(repairBillId, out var list))
                        itemsByBillId[repairBillId] = list = new List<DmsBaplDataRepairBillItemRow>();
                    list.Add(item);
                }
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's repair bills (DMS_RepairBill/DMS_RepairBillItem): {ex.Message}", ex);
        }

        // Re-attach each header's items (headers were built before the items query ran, above).
        return headers.Select(h => h with { Items = itemsByBillId.TryGetValue(h.Id, out var items) ? items : Array.Empty<DmsBaplDataRepairBillItemRow>() }).ToList();
    }

    public async Task<IReadOnlyList<DmsBaplDataMaterialTransferRow>> GetMaterialTransfersAsync(string? locCode, CancellationToken ct = default)
    {
        // Same "nothing selected yet -> nothing shown" convention as BaplDmsService.GetPartsInventoryAsync -
        // an unscoped scan across every dealer's material transfers isn't what the page ever wants.
        if (string.IsNullOrWhiteSpace(locCode)) return Array.Empty<DmsBaplDataMaterialTransferRow>();

        var headers = new List<DmsBaplDataMaterialTransferRow>();
        var itemsByTransferId = new Dictionary<int, List<DmsBaplDataMaterialTransferItemRow>>();
        var labourByItemId = new Dictionary<int, List<DmsBaplDataMaterialTransferLaborRow>>();

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            const string headerSql = @"
                SELECT
                    Id, DealerName, DealerCode, SourceUniqueId, SourceJobId, DocNo, DocDate,
                    DocType, Location, LocCode, TechnicianName, UniqueKey, CreatedAt, UpdatedAt
                FROM [dbo].[DMS_MaterialTransfer]
                WHERE LocCode = @locCode
                ORDER BY DocDate DESC, Id DESC";

            var transferIds = new List<int>();
            await using (var cmd = new SqlCommand(headerSql, conn) { CommandTimeout = 30 })
            {
                cmd.Parameters.AddWithValue("@locCode", locCode.Trim());
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                while (await rdr.ReadAsync(ct))
                {
                    var id = (int)rdr["Id"];
                    transferIds.Add(id);
                    headers.Add(new DmsBaplDataMaterialTransferRow(
                        id,
                        rdr["DealerName"] as string,
                        rdr["DealerCode"] as string,
                        rdr["SourceUniqueId"] as long?,
                        rdr["SourceJobId"] as long?,
                        rdr["DocNo"] as int?,
                        rdr["DocDate"] as DateTime?,
                        rdr["DocType"] as string,
                        rdr["Location"] as string,
                        rdr["LocCode"] as string,
                        rdr["TechnicianName"] as string,
                        rdr["UniqueKey"] as string,
                        (DateTime)rdr["CreatedAt"],
                        (DateTime)rdr["UpdatedAt"],
                        Array.Empty<DmsBaplDataMaterialTransferItemRow>())); // filled in below
                }
            }

            var itemIds = new List<int>();
            if (transferIds.Count > 0)
            {
                // Same "batch the child rows in one follow-up query" shape as GetRepairBillsAsync
                // above - one query for every header's items, instead of one query per header.
                var inClause = string.Join(",", transferIds.Select((_, i) => $"@id{i}"));
                var itemSql = $@"
                    SELECT
                        Id, MaterialTransferId, SourceLineId, ItemIdno, ItemName, ItemDescription,
                        ItemType, Qty, Rate, SgstPer, SgstAmount, CgstPer, CgstAmount, IgstPer,
                        IgstAmount, Discount, Mrp
                    FROM [dbo].[DMS_MaterialTransferItem]
                    WHERE MaterialTransferId IN ({inClause})
                    ORDER BY MaterialTransferId, Id";

                await using var cmd = new SqlCommand(itemSql, conn) { CommandTimeout = 30 };
                for (var i = 0; i < transferIds.Count; i++) cmd.Parameters.AddWithValue($"@id{i}", transferIds[i]);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                while (await rdr.ReadAsync(ct))
                {
                    var itemId = (int)rdr["Id"];
                    var transferId = (int)rdr["MaterialTransferId"];
                    itemIds.Add(itemId);
                    var item = new DmsBaplDataMaterialTransferItemRow(
                        itemId,
                        transferId,
                        rdr["SourceLineId"] as long?,
                        rdr["ItemIdno"] as long?,
                        rdr["ItemName"] as string,
                        rdr["ItemDescription"] as string,
                        rdr["ItemType"] as string,
                        (decimal)rdr["Qty"],
                        (decimal)rdr["Rate"],
                        (decimal)rdr["SgstPer"],
                        (decimal)rdr["SgstAmount"],
                        (decimal)rdr["CgstPer"],
                        (decimal)rdr["CgstAmount"],
                        (decimal)rdr["IgstPer"],
                        (decimal)rdr["IgstAmount"],
                        (decimal)rdr["Discount"],
                        (decimal)rdr["Mrp"],
                        Array.Empty<DmsBaplDataMaterialTransferLaborRow>()); // filled in below
                    if (!itemsByTransferId.TryGetValue(transferId, out var list))
                        itemsByTransferId[transferId] = list = new List<DmsBaplDataMaterialTransferItemRow>();
                    list.Add(item);
                }
            }

            if (itemIds.Count > 0)
            {
                var inClause = string.Join(",", itemIds.Select((_, i) => $"@iid{i}"));
                var labourSql = $@"
                    SELECT
                        Id, MaterialTransferItemId, LbrIdno, LbrName, LbrDescription, LbrRate,
                        SgstPer, SgstAmount, CgstPer, CgstAmount, IgstPer, IgstAmount
                    FROM [dbo].[DMS_MaterialTransferLabor]
                    WHERE MaterialTransferItemId IN ({inClause})
                    ORDER BY MaterialTransferItemId, Id";

                await using var cmd = new SqlCommand(labourSql, conn) { CommandTimeout = 30 };
                for (var i = 0; i < itemIds.Count; i++) cmd.Parameters.AddWithValue($"@iid{i}", itemIds[i]);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                while (await rdr.ReadAsync(ct))
                {
                    var itemId = (int)rdr["MaterialTransferItemId"];
                    var labour = new DmsBaplDataMaterialTransferLaborRow(
                        (int)rdr["Id"],
                        itemId,
                        rdr["LbrIdno"] as long?,
                        rdr["LbrName"] as string,
                        rdr["LbrDescription"] as string,
                        (decimal)rdr["LbrRate"],
                        (decimal)rdr["SgstPer"],
                        (decimal)rdr["SgstAmount"],
                        (decimal)rdr["CgstPer"],
                        (decimal)rdr["CgstAmount"],
                        (decimal)rdr["IgstPer"],
                        (decimal)rdr["IgstAmount"]);
                    if (!labourByItemId.TryGetValue(itemId, out var list))
                        labourByItemId[itemId] = list = new List<DmsBaplDataMaterialTransferLaborRow>();
                    list.Add(labour);
                }
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's material transfers (DMS_MaterialTransfer/DMS_MaterialTransferItem/DMS_MaterialTransferLabor): {ex.Message}", ex);
        }

        // Re-attach labour lines to their items, then items to their headers (built in that order
        // above since each level's query depends on the previous level's ids).
        return headers.Select(h => h with
        {
            Items = (itemsByTransferId.TryGetValue(h.Id, out var items) ? items : new List<DmsBaplDataMaterialTransferItemRow>())
                .Select(it => it with { Labour = labourByItemId.TryGetValue(it.Id, out var lbr) ? lbr : Array.Empty<DmsBaplDataMaterialTransferLaborRow>() })
                .ToList()
        }).ToList();
    }

    public async Task<IReadOnlyList<DmsBaplDataVehicleSaleRow>> GetVehicleSalesAsync(string? soldToFilter, CancellationToken ct = default)
    {
        var rows = new List<DmsBaplDataVehicleSaleRow>();

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            // Column list matches the AutoGeniusSync.Models.DmsVehicleSale shape you pasted - see
            // DmsBaplDataVehicleSaleRow's own doc comment for why (the first attempt's smaller,
            // "confirmed from a select * grid" column list turned out to be wrong - every one of
            // those columns errored as invalid except Id/ChassisNo/SoldTo). Only those three are
            // independently confirmed; the rest is inferred from the model. If any of these still
            // 400/502 with "Invalid column name", tell me which ones and I'll fix just those.
            const string sql = @"
                SELECT
                    Id, DealerName, DealerCode, InvoiceNo, InvoiceDate, Location, LocCode,
                    LocationCity, CustDob, Gender, SoldTo, AccountType, PartyEmail, CusMob,
                    Address1, Address2, City, State, ExecutiveName, Pin, ChassisNo, MotorNo,
                    Remarks, ItemModel, Oemmodel, ColorCode, VehicleType, VehicleGroup,
                    Hsnsaccode, SaleType, FinancedBy, FinAmount, ItemRate, InsuAmount, RegnAmount,
                    AcsryAmount, PreGstdiscAmount, DiscTypeName, PostGstdisc, FameIi, StateFameIi,
                    Sgstper, Sgstamount, Cgstper, Cgstamount, Igstper, Igstamount, NetAmount,
                    ReferenceNo, BookingDate, TotalCount, Battery, BatteryChemical,
                    BatteryCapacity, BatteryMake, ChargerNo, ChargerNo2, Converter, Vcu,
                    ControllerNo, FameIirequired, SegmentName, InstitutionalName, SchemeName,
                    CreatedAt, UpdatedAt
                FROM [dbo].[DMS_VehicleSales]
                WHERE (@soldTo IS NULL OR SoldTo LIKE @soldTo)
                ORDER BY InvoiceDate DESC, Id DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@soldTo", string.IsNullOrWhiteSpace(soldToFilter) ? DBNull.Value : $"%{soldToFilter.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                rows.Add(new DmsBaplDataVehicleSaleRow(
                    (int)rdr["Id"],
                    rdr["DealerName"] as string,
                    rdr["DealerCode"] as string,
                    rdr["InvoiceNo"] as string,
                    rdr["InvoiceDate"] as DateTime?,
                    rdr["Location"] as string,
                    rdr["LocCode"] as string,
                    rdr["LocationCity"] as string,
                    rdr["CustDob"] as DateTime?,
                    rdr["Gender"] as string,
                    rdr["SoldTo"] as string,
                    rdr["AccountType"] as string,
                    rdr["PartyEmail"] as string,
                    rdr["CusMob"] as string,
                    rdr["Address1"] as string,
                    rdr["Address2"] as string,
                    rdr["City"] as string,
                    rdr["State"] as string,
                    rdr["ExecutiveName"] as string,
                    rdr["Pin"] as string,
                    rdr["ChassisNo"] as string,
                    rdr["MotorNo"] as string,
                    rdr["Remarks"] as string,
                    rdr["ItemModel"] as string,
                    rdr["Oemmodel"] as string,
                    rdr["ColorCode"] as string,
                    rdr["VehicleType"] as string,
                    rdr["VehicleGroup"] as string,
                    rdr["Hsnsaccode"] as string,
                    rdr["SaleType"] as string,
                    rdr["FinancedBy"] as string,
                    rdr["FinAmount"] as decimal?,
                    rdr["ItemRate"] as decimal?,
                    rdr["InsuAmount"] as decimal?,
                    rdr["RegnAmount"] as decimal?,
                    rdr["AcsryAmount"] as decimal?,
                    rdr["PreGstdiscAmount"] as decimal?,
                    rdr["DiscTypeName"] as string,
                    rdr["PostGstdisc"] as decimal?,
                    rdr["FameIi"] as decimal?,
                    rdr["StateFameIi"] as decimal?,
                    rdr["Sgstper"] as decimal?,
                    rdr["Sgstamount"] as decimal?,
                    rdr["Cgstper"] as decimal?,
                    rdr["Cgstamount"] as decimal?,
                    rdr["Igstper"] as decimal?,
                    rdr["Igstamount"] as decimal?,
                    rdr["NetAmount"] as decimal?,
                    rdr["ReferenceNo"] as string,
                    rdr["BookingDate"] as DateTime?,
                    rdr["TotalCount"] as string,
                    rdr["Battery"] as string,
                    rdr["BatteryChemical"] as string,
                    rdr["BatteryCapacity"] as string,
                    rdr["BatteryMake"] as string,
                    rdr["ChargerNo"] as string,
                    rdr["ChargerNo2"] as string,
                    rdr["Converter"] as string,
                    rdr["Vcu"] as string,
                    rdr["ControllerNo"] as string,
                    rdr["FameIirequired"] as string,
                    rdr["SegmentName"] as string,
                    rdr["InstitutionalName"] as string,
                    rdr["SchemeName"] as string,
                    rdr["CreatedAt"] as DateTime?,
                    rdr["UpdatedAt"] as DateTime?));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's vehicle sales (DMS_VehicleSales): {ex.Message}", ex);
        }

        return rows;
    }

    // SQL Server's 'date' columns come back through the SqlDataReader indexer as a boxed DateTime
    // (Microsoft.Data.SqlClient keeps that for backward compatibility - it only hands back a real
    // DateOnly via the typed GetFieldValue<DateOnly> overload), so every DateOnly? column here is
    // read via the indexer as DateTime? first and converted with this helper.
    private static DateOnly? AsDateOnly(object value) => value is DateTime dt ? DateOnly.FromDateTime(dt) : null;

    public async Task<IReadOnlyList<DmsBaplDataServiceHistoryRow>> GetServiceHistoryAsync(string? searchTerm, CancellationToken ct = default)
    {
        // Same "nothing searched yet -> nothing shown" convention as GetMaterialTransfersAsync's
        // locCode - DMS_ServiceHistory has no natural default filter (unlike Repair Bill/Vehicle
        // Sale's "Zomato" party default), so an unscoped scan isn't what this page ever wants.
        if (string.IsNullOrWhiteSpace(searchTerm)) return Array.Empty<DmsBaplDataServiceHistoryRow>();

        var rows = new List<DmsBaplDataServiceHistoryRow>();

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            // Column list confirmed against your pasted AutoGeniusSync.Models.DmsServiceHistory EF
            // model, cross-checked field-by-field against a live `select top 1 *` header+row pair -
            // see DmsBaplDataServiceHistoryRow's doc comment for the one live column ("Status") this
            // deliberately leaves out, matching the model's own choice. IsRowTotal is filtered here,
            // not selected out to the caller - AutoGeniusSync's own subtotal/summary-row convention.
            const string sql = @"
                SELECT
                    Id, DealerCode, JobNo, JobDate, CompName, Location, InTime, CloseTime,
                    JobCategory, FFRPercentage, DocNo, DocType, DocDate, Model, BrandName, RegNo,
                    VehicleType, EngineNo, ChassisNo, KMS, BatterySerialNo1, BatterySerialNo2,
                    BatterySerialNo3, BatterySerialNo4, BatterySerialNo5, BatterySerialNo6,
                    IndividualAHBattery1, IndividualAHBattery2, IndividualAHBattery3,
                    IndividualAHBattery4, IndividualAHBattery5, IndividualAHBattery6, PartyName,
                    MobileNumber, Supervisor, Technician, ServiceHead, JobType, SaleDate, CouponNo,
                    ExpectedDeliveryDate, ProformaDate, InvoiceDate, EstimatedJobExpenses,
                    LabourHours, Parts, Accessory, Oil, Labour, OutsideWork, TotalWOTax, GSTAmount,
                    IGSTAmount, NetTotal, CreatedAt, UpdatedAt, RepairType, CompletionDate,
                    JobStatus, RowHash, UniqueKey
                FROM [dbo].[DMS_ServiceHistory]
                WHERE IsRowTotal = 0
                  AND (ChassisNo LIKE @search OR RegNo LIKE @search)
                ORDER BY JobDate DESC, Id DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@search", $"%{searchTerm.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                rows.Add(new DmsBaplDataServiceHistoryRow(
                    (int)rdr["Id"],
                    rdr["DealerCode"] as string,
                    rdr["JobNo"] as string,
                    AsDateOnly(rdr["JobDate"]),
                    rdr["CompName"] as string,
                    rdr["Location"] as string,
                    rdr["InTime"] as string,
                    rdr["CloseTime"] as string,
                    rdr["JobCategory"] as string,
                    rdr["FFRPercentage"] as string,
                    rdr["DocNo"] as string,
                    rdr["DocType"] as string,
                    AsDateOnly(rdr["DocDate"]),
                    rdr["Model"] as string,
                    rdr["BrandName"] as string,
                    rdr["RegNo"] as string,
                    rdr["VehicleType"] as string,
                    rdr["EngineNo"] as string,
                    rdr["ChassisNo"] as string,
                    rdr["KMS"] as string,
                    rdr["BatterySerialNo1"] as string,
                    rdr["BatterySerialNo2"] as string,
                    rdr["BatterySerialNo3"] as string,
                    rdr["BatterySerialNo4"] as string,
                    rdr["BatterySerialNo5"] as string,
                    rdr["BatterySerialNo6"] as string,
                    rdr["IndividualAHBattery1"] as string,
                    rdr["IndividualAHBattery2"] as string,
                    rdr["IndividualAHBattery3"] as string,
                    rdr["IndividualAHBattery4"] as string,
                    rdr["IndividualAHBattery5"] as string,
                    rdr["IndividualAHBattery6"] as string,
                    rdr["PartyName"] as string,
                    rdr["MobileNumber"] as string,
                    rdr["Supervisor"] as string,
                    rdr["Technician"] as string,
                    rdr["ServiceHead"] as string,
                    rdr["JobType"] as string,
                    AsDateOnly(rdr["SaleDate"]),
                    rdr["CouponNo"] as string,
                    AsDateOnly(rdr["ExpectedDeliveryDate"]),
                    AsDateOnly(rdr["ProformaDate"]),
                    AsDateOnly(rdr["InvoiceDate"]),
                    rdr["EstimatedJobExpenses"] as decimal?,
                    rdr["LabourHours"] as decimal?,
                    rdr["Parts"] as decimal?,
                    rdr["Accessory"] as decimal?,
                    rdr["Oil"] as decimal?,
                    rdr["Labour"] as decimal?,
                    rdr["OutsideWork"] as decimal?,
                    rdr["TotalWOTax"] as decimal?,
                    rdr["GSTAmount"] as decimal?,
                    rdr["IGSTAmount"] as decimal?,
                    rdr["NetTotal"] as decimal?,
                    rdr["CreatedAt"] as DateTime?,
                    rdr["UpdatedAt"] as DateTime?,
                    rdr["RepairType"] as string,
                    AsDateOnly(rdr["CompletionDate"]),
                    rdr["JobStatus"] as string,
                    rdr["RowHash"] as string,
                    rdr["UniqueKey"] as string));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's service history (DMS_ServiceHistory): {ex.Message}", ex);
        }

        return rows;
    }

    public async Task<IReadOnlyList<DmsBaplDataServiceHistorySuggestion>> SearchServiceHistoryVehiclesAsync(string? q, int take, CancellationToken ct = default)
    {
        // Same 2-character minimum as the Job Card wizard's own chassis/reg typeahead
        // (BaplDmsService.SearchVehiclesAsync) - avoids a 1-character query matching a huge share of
        // rows before the user's even finished typing.
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2) return Array.Empty<DmsBaplDataServiceHistorySuggestion>();
        take = take is > 0 and <= 50 ? take : 20;

        var results = new List<DmsBaplDataServiceHistorySuggestion>();

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            // GROUP BY ChassisNo collapses a vehicle's many past visits down to one suggestion row -
            // MAX(RegNo)/MAX(Model) as a representative value (these don't change visit-to-visit in
            // practice), MAX(JobDate) both for "last serviced" display and to rank the most recently
            // active vehicles first, matching the wizard's own "most relevant first" ordering.
            const string sql = @"
                SELECT TOP (@take) ChassisNo, MAX(RegNo) AS RegNo, MAX(Model) AS Model, MAX(JobDate) AS LastJobDate
                FROM [dbo].[DMS_ServiceHistory]
                WHERE IsRowTotal = 0
                  AND ChassisNo IS NOT NULL
                  AND (ChassisNo LIKE @q OR RegNo LIKE @q)
                GROUP BY ChassisNo
                ORDER BY MAX(JobDate) DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@take", take);
            cmd.Parameters.AddWithValue("@q", $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new DmsBaplDataServiceHistorySuggestion(
                    (string)rdr["ChassisNo"],
                    rdr["RegNo"] as string,
                    rdr["Model"] as string,
                    AsDateOnly(rdr["LastJobDate"])));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's service history vehicle suggestions (DMS_ServiceHistory): {ex.Message}", ex);
        }

        return results;
    }
}
