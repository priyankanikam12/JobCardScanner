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
/// One vehicle sale row for the "Vehicle Sale" sidebar page.
///
/// MIGRATED 2026-09-25 ("this data for vehiclesale fetch from BaplConnection db"): this no longer
/// reads DMSBAPLDATA/DMS_IOT_DATA's DMS_VehicleSales at all. It's now sourced from BaplConnection -
/// the "baplfinal" ERP warehouse BaplDealerService.cs already reads for Dealer/Item Master data -
/// joining dbo.DMS_SaleBill (the sale/bill header, one row per vehicle sold) to
/// dbo.DMS_SaleBillCustomer (the buyer, via DMS_SaleBill.CustId -> DMS_SaleBillCustomer.Id) for the
/// customer-facing fields. FACT: both tables' column names/types below are read directly off the
/// CREATE TABLE scripts you pasted (not inferred), cross-checked against a live `select *` you ran
/// on each - the strongest confirmation this file has had for any of its data sources.
///
/// This DTO keeps the SAME field names/shape as the old DMSBAPLDATA-sourced version (so the API
/// response contract - and every existing frontend field reference - doesn't change), but roughly a
/// third of these fields have no equivalent column in DMS_SaleBill/DMS_SaleBillCustomer and are
/// always null now - see each field's own comment below in GetVehicleSalesAsync for exactly which,
/// and why (no guessed mappings - a field with no clear source is left null, not approximated).
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
    // MIGRATED 2026-09-25: unlike the old DMSBAPLDATA/DMS_VehicleSales source (which had no RegNo
    // column at all, forcing a second batched lookup against DMS_ServiceHistory), DMS_SaleBill has
    // its OWN reg_number column directly on the sale row - FACT, confirmed via your CREATE TABLE
    // script and live `select *`. Read straight off DMS_SaleBill.reg_number in GetVehicleSalesAsync
    // below; no second query needed any more.
    string? RegNo,
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
/// One chassis/reg-no typeahead suggestion for the Job Card Wizard's vehicle search, sourced from
/// BaplConnection's dbo.DMS_SaleBill - see IDmsBaplDataService.SearchVehiclesForWizardAsync's doc
/// comment. Deliberately its own small shape rather than the full DmsBaplDataVehicleSaleRow - a
/// typeahead dropdown only ever needs enough to tell rows apart while picking one.
/// </summary>
public record DmsBaplDataVehicleSuggestion(string ChassisNo, string? RegNo, string? ModelName, DateTime? SaleDate);

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
    /// Vehicle sales from BaplConnection's dbo.DMS_SaleBill (+ dbo.DMS_SaleBillCustomer for the
    /// buyer), filtered to the customer's first_name LIKE '%{soldToFilter}%' - the "Vehicle Sale"
    /// sidebar page's data source. MIGRATED 2026-09-25 off DMSBAPLDATA/DMS_VehicleSales onto
    /// BaplConnection/baplfinal - see DmsBaplDataVehicleSaleRow's doc comment. soldToFilter defaults
    /// to "Zomato" (set by the controller, same convention as GetRepairBillsAsync's partyNameFilter);
    /// pass null/empty for every buyer.
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataVehicleSaleRow>> GetVehicleSalesAsync(string? soldToFilter, CancellationToken ct = default);

    /// <summary>
    /// Looks up ONE vehicle by chassis no. or registration no. from BaplConnection's
    /// dbo.DMS_SaleBill (+ dbo.DMS_SaleBillCustomer for the buyer) - the Job Card Wizard's
    /// chassis/reg-no search (2026-09-25: "worklocation chassis no and reg no use from vehicle sale
    /// which we data fetch that will bind in JobCardWizardPage for both web and android"),
    /// replacing the old BAPLDMSvad-backed vehicle-lookup for this one purpose. Matches chassis_no
    /// exactly (trimmed) OR reg_number with spaces/hyphens stripped from both sides (a reg no. is
    /// commonly typed with different spacing/punctuation - same normalization
    /// JobCardsController.List already applies to its own RegNo search). dealerCode optional - null
    /// searches every dealer, same "no scope = everything" convention as GetVehicleSalesAsync's
    /// soldToFilter. Returns the most recently created matching sale when more than one row
    /// matches, or null (not an exception) when nothing matches - an everyday result, not an error.
    /// </summary>
    Task<DmsBaplDataVehicleSaleRow?> LookupVehicleForWizardAsync(string value, string? dealerCode, CancellationToken ct = default);

    /// <summary>
    /// Typeahead suggestions for the Job Card Wizard's chassis/reg-no search box, sourced from the
    /// same BaplConnection dbo.DMS_SaleBill table as LookupVehicleForWizardAsync above - one row per
    /// distinct chassis, most recently sold first. Fewer than 2 characters returns an empty list
    /// without querying BaplConnection, same convention as SearchServiceHistoryVehiclesAsync below.
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataVehicleSuggestion>> SearchVehiclesForWizardAsync(string? q, string? dealerCode, int take, CancellationToken ct = default);

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

    // 2026-09-25 ("vehiclesale use from BaplConnection db"): Vehicle Sale's data source moved off
    // DMSBAPLDATA/DMS_IOT_DATA entirely, onto BaplConnection - the "baplfinal" ERP warehouse
    // BaplDealerService.cs already reads for Dealer/Item Master data. See GetVehicleSalesAsync below.
    private string BaplConnStr => _config.GetConnectionString("BaplConnection")
        ?? throw new InvalidOperationException("BaplConnection isn't configured in appsettings.json's ConnectionStrings section.");

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

    // Shared between GetVehicleSalesAsync, LookupVehicleForWizardAsync and
    // SearchVehiclesForWizardAsync below - all three read the same dbo.DMS_SaleBill (+
    // dbo.DMS_SaleBillCustomer) shape, just with different WHERE/ORDER/TOP clauses, so the column
    // list and join live in one place rather than three copies that could drift apart. c.IsDelete
    // is filtered in the JOIN's ON clause (not WHERE) so a sale bill whose customer row was
    // soft-deleted still comes back (with blank customer fields) rather than disappearing outright -
    // a LEFT JOIN filtered in WHERE would behave like an INNER JOIN for exactly that case.
    private const string VehicleSaleSelectColumns = @"
        sb.Id, sb.dealer_code, sb.salebill_no, sb.InvoiceDate, sb.salebill_date,
        sb.locationname, sb.LocCode, sb.LocationCity, sb.AccountType, sb.Pin,
        sb.chassis_no, sb.reg_number, sb.motor_id, sb.Item_Modl, sb.OEMModel,
        sb.HSNSACCode, sb.SaleType, sb.FinancedBy, sb.Item_Rate, sb.Insu_Amnt,
        sb.Regn_Amnt, sb.DiscountType, sb.FameII, sb.StateFameII, sb.SGSTPer,
        sb.SGSTAmnt, sb.CGSTPer, sb.CGSTAmnt, sb.IGSTPer, sb.IGSTAmnt, sb.Net_Amnt,
        sb.battery_serial_no, sb.BatteryChemical, sb.BatteryCapacity, sb.BatteryMake,
        sb.ChargerNo, sb.Converter, sb.VCU, sb.motor_controller_no, sb.FameIIRequired,
        sb.SegmentName, sb.InstitutionalName, sb.SchemeName, sb.CreatedOn, sb.ModifiedOn,
        sb.Group1,
        c.first_name AS CustFirstName, c.email_id, c.mobile, c.Address1, c.Address2,
        c.City, c.State";

    private const string VehicleSaleFromJoin = @"
        FROM [dbo].[DMS_SaleBill] sb
        LEFT JOIN [dbo].[DMS_SaleBillCustomer] c
            ON c.Id = sb.CustId AND (c.IsDelete IS NULL OR c.IsDelete = 0)";

    // Maps one row of VehicleSaleSelectColumns/VehicleSaleFromJoin's result set - see
    // DmsBaplDataVehicleSaleRow's own doc comment for which fields have no source column on
    // DMS_SaleBill/DMS_SaleBillCustomer and are always null here (not guessed).
    private static DmsBaplDataVehicleSaleRow MapVehicleSaleRow(SqlDataReader rdr) => new(
        (int)rdr["Id"],
        null, // DealerName - DMS_SaleBill only carries dealer_code, no dealer-name text column
        rdr["dealer_code"] as string,
        rdr["salebill_no"] as string, // InvoiceNo - the bill number is this ERP's equivalent
        // InvoiceDate: prefer the real datetime column; DMS_SaleBill.InvoiceDate is NULL on a lot
        // of older rows (per your own sample data), where salebill_date (a free-text "dd-MM-yyyy"
        // string, e.g. "10-08-2022") holds the actual date instead.
        (rdr["InvoiceDate"] as DateTime?) ?? ParseSalebillDate(rdr["salebill_date"] as string),
        rdr["locationname"] as string,
        rdr["LocCode"] as string,
        rdr["LocationCity"] as string,
        null, // CustDob - DMS_SaleBillCustomer.DateofBirth is free-text, unconfirmed format - not parsed/guessed
        null, // Gender - no column on either table
        rdr["CustFirstName"] as string, // SoldTo - the buyer's name, via the CustId join
        rdr["AccountType"] as string,
        rdr["email_id"] as string,
        rdr["mobile"] as string,
        rdr["Address1"] as string,
        rdr["Address2"] as string,
        rdr["City"] as string,
        rdr["State"] as string,
        null, // ExecutiveName - no column on either table
        rdr["Pin"] as string,
        rdr["chassis_no"] as string,
        rdr["reg_number"] as string, // RegNo - direct column now, see the record's doc comment
        rdr["motor_id"] as string,
        null, // Remarks - no column
        rdr["Item_Modl"] as string,
        rdr["OEMModel"] as string,
        null, // ColorCode - no separate column (Item_Modl's free text sometimes embeds a color
              // name, e.g. "BGauss D15 Pro  Racing Red", but that's not reliably parseable into a
              // clean code, so left null rather than guessed)
        null, // VehicleType - no column
        rdr["Group1"] as string, // VehicleGroup - ASSUMPTION: Group1's exact business meaning on
                                  // DMS_SaleBill isn't confirmed; mapped here as the closest-named
                                  // column, flag if this looks wrong
        rdr["HSNSACCode"] as string,
        rdr["SaleType"] as string,
        rdr["FinancedBy"] as string,
        null, // FinAmount - no distinct "financed amount" column
        rdr["Item_Rate"] as decimal?,
        rdr["Insu_Amnt"] as decimal?,
        rdr["Regn_Amnt"] as decimal?,
        null, // AcsryAmount - no column
        null, // PreGstdiscAmount - DMS_SaleBill.RegDiscAmnt is a registration discount, not the
              // same figure as a pre-GST discount, so deliberately not mapped here rather than
              // conflating two different amounts
        rdr["DiscountType"] as string,
        null, // PostGstdisc - no column
        rdr["FameII"] as decimal?,
        rdr["StateFameII"] as decimal?,
        rdr["SGSTPer"] as decimal?,
        rdr["SGSTAmnt"] as decimal?,
        rdr["CGSTPer"] as decimal?,
        rdr["CGSTAmnt"] as decimal?,
        rdr["IGSTPer"] as decimal?,
        rdr["IGSTAmnt"] as decimal?,
        rdr["Net_Amnt"] as decimal?,
        null, // ReferenceNo - no column (ReceiptGUID exists but is a receipt URL, not a reference number)
        null, // BookingDate - no column
        null, // TotalCount - no column
        rdr["battery_serial_no"] as string,
        rdr["BatteryChemical"] as string,
        rdr["BatteryCapacity"] as string,
        rdr["BatteryMake"] as string,
        rdr["ChargerNo"] as string,
        null, // ChargerNo2 - only one charger-number column exists on DMS_SaleBill
        rdr["Converter"] as string,
        rdr["VCU"] as string,
        rdr["motor_controller_no"] as string,
        rdr["FameIIRequired"] as string,
        rdr["SegmentName"] as string,
        rdr["InstitutionalName"] as string,
        rdr["SchemeName"] as string,
        rdr["CreatedOn"] as DateTime?,
        rdr["ModifiedOn"] as DateTime?);

    public async Task<IReadOnlyList<DmsBaplDataVehicleSaleRow>> GetVehicleSalesAsync(string? soldToFilter, CancellationToken ct = default)
    {
        var rows = new List<DmsBaplDataVehicleSaleRow>();

        try
        {
            await using var conn = new SqlConnection(BaplConnStr);
            await conn.OpenAsync(ct);

            var sql = $@"
                SELECT {VehicleSaleSelectColumns}
                {VehicleSaleFromJoin}
                WHERE (sb.IsDelete IS NULL OR sb.IsDelete = 0)
                  AND (@soldTo IS NULL OR c.first_name LIKE @soldTo)
                ORDER BY sb.CreatedOn DESC, sb.Id DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@soldTo", string.IsNullOrWhiteSpace(soldToFilter) ? DBNull.Value : $"%{soldToFilter.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                rows.Add(MapVehicleSaleRow(rdr));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BaplConnection's vehicle sales (DMS_SaleBill/DMS_SaleBillCustomer): {ex.Message}", ex);
        }

        return rows;
    }

    public async Task<DmsBaplDataVehicleSaleRow?> LookupVehicleForWizardAsync(string value, string? dealerCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        try
        {
            await using var conn = new SqlConnection(BaplConnStr);
            await conn.OpenAsync(ct);

            // Reg no. is commonly typed with different spacing/hyphenation ("MH12AB1234" vs
            // "MH12 AB 1234") - strip spaces/hyphens from both sides before comparing, same fix
            // already applied to JobCardsController.List's own RegNo search and
            // BaplDmsService's vehicle lookup. Chassis no. is compared as an exact trimmed match
            // (chassis numbers don't have this formatting-inconsistency problem in practice).
            var sql = $@"
                SELECT TOP 1 {VehicleSaleSelectColumns}
                {VehicleSaleFromJoin}
                WHERE (sb.IsDelete IS NULL OR sb.IsDelete = 0)
                  AND (@dealerCode IS NULL OR sb.dealer_code = @dealerCode)
                  AND (LTRIM(RTRIM(sb.chassis_no)) = @value
                       OR REPLACE(REPLACE(LTRIM(RTRIM(sb.reg_number)), ' ', ''), '-', '') = @valueNoSpaces)
                ORDER BY sb.CreatedOn DESC, sb.Id DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            var trimmed = value.Trim();
            cmd.Parameters.AddWithValue("@dealerCode", string.IsNullOrWhiteSpace(dealerCode) ? DBNull.Value : dealerCode.Trim());
            cmd.Parameters.AddWithValue("@value", trimmed);
            cmd.Parameters.AddWithValue("@valueNoSpaces", trimmed.Replace(" ", "").Replace("-", ""));
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            return await rdr.ReadAsync(ct) ? MapVehicleSaleRow(rdr) : null;
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not look up the vehicle in BaplConnection (DMS_SaleBill/DMS_SaleBillCustomer): {ex.Message}", ex);
        }
    }

    public async Task<IReadOnlyList<DmsBaplDataVehicleSuggestion>> SearchVehiclesForWizardAsync(string? q, string? dealerCode, int take, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2) return Array.Empty<DmsBaplDataVehicleSuggestion>();
        take = take is > 0 and <= 50 ? take : 20;

        var results = new List<DmsBaplDataVehicleSuggestion>();
        try
        {
            await using var conn = new SqlConnection(BaplConnStr);
            await conn.OpenAsync(ct);

            const string sql = @"
                SELECT TOP (@take) sb.chassis_no, sb.reg_number, sb.Item_Modl, sb.InvoiceDate, sb.salebill_date, sb.CreatedOn
                FROM [dbo].[DMS_SaleBill] sb
                WHERE (sb.IsDelete IS NULL OR sb.IsDelete = 0)
                  AND (@dealerCode IS NULL OR sb.dealer_code = @dealerCode)
                  AND sb.chassis_no IS NOT NULL
                  AND (sb.chassis_no LIKE @q OR sb.reg_number LIKE @q)
                ORDER BY sb.CreatedOn DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@take", take);
            cmd.Parameters.AddWithValue("@dealerCode", string.IsNullOrWhiteSpace(dealerCode) ? DBNull.Value : dealerCode.Trim());
            cmd.Parameters.AddWithValue("@q", $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            // DISTINCT by chassis in code, not SQL - the same chassis can have more than one
            // DMS_SaleBill row (e.g. a corrected/re-issued bill), and a typeahead only needs to
            // show each vehicle once.
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            while (await rdr.ReadAsync(ct) && results.Count < take)
            {
                var chassis = rdr["chassis_no"] as string;
                if (string.IsNullOrWhiteSpace(chassis) || !seen.Add(chassis)) continue;
                var saleDate = (rdr["InvoiceDate"] as DateTime?) ?? ParseSalebillDate(rdr["salebill_date"] as string);
                results.Add(new DmsBaplDataVehicleSuggestion(chassis, rdr["reg_number"] as string, rdr["Item_Modl"] as string, saleDate));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not search BaplConnection's vehicles for suggestions (DMS_SaleBill): {ex.Message}", ex);
        }

        return results;
    }

    // DMS_SaleBill.salebill_date is a free-text nvarchar, not a real date column - your own sample
    // data showed values like "10-08-2022" (dd-MM-yyyy) sitting there even when the real InvoiceDate
    // datetime column was NULL, so GetVehicleSalesAsync falls back to this when InvoiceDate itself is
    // blank. Returns null (rather than guessing) for anything that doesn't match that exact format -
    // if you spot dates in a different format coming through blank, tell me the format and I'll add it.
    private static DateTime? ParseSalebillDate(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return DateTime.TryParseExact(raw.Trim(), "dd-MM-yyyy", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt)
            ? dt
            : null;
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
