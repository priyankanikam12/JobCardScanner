using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

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
    ///
    /// 2026-09-28 ADDED: DMS_SaleBill.reg_number (the primary RegNo source since the 2026-09-25
    /// migration) is blank on a real share of rows in production - and, per your 2026-09-28
    /// screenshot, ALSO carries literal "TEMP####" dealer placeholders on many others (before a
    /// real RTO registration is on record). Any row whose RegNo is blank OR a "TEMP" placeholder
    /// (see IsPlaceholderRegNo) now gets ONE follow-up batched lookup against DMSBAPLDATA's OWN
    /// dbo.DMS_ServiceHistory table (a different database - DMS_IOT_DATA, via
    /// DMSBAPLDATAConnection, not BaplConnection), keyed by ChassisNo, and OVERWRITES the placeholder
    /// with the real RegNo found there. A row whose RegNo is neither blank nor a TEMP placeholder is
    /// left exactly as-is - this only ever replaces a value already known not to be real. See
    /// GetRegNoByChassisFromServiceHistoryAsync's/IsPlaceholderRegNo's doc comments for the exact
    /// matching rule and its open assumptions.
    ///
    /// 2026-09-28 ADDED (a THIRD, final layer): a manually-saved Reg No override
    /// (VehicleSaleOverridesController, JobCardScannerDb's own VehicleSaleOverride table - see that
    /// model's doc comment) is applied last and always wins, over both DMS_SaleBill's own
    /// reg_number and the DMS_ServiceHistory fallback above, for any chassis that has one.
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataVehicleSaleRow>> GetVehicleSalesAsync(string? soldToFilter, CancellationToken ct = default);

    /// <summary>
    /// 2026-10-01 ADDED ("with location this data not match" - a Dombivli dealer's logged-in user
    /// was shown a Delhi dealer's Zomato sale row): same query as the method above, PLUS dealer
    /// scoping - FACT, confirmed by reading this file's own GetVehicleSalesAsync SQL above: it has
    /// NO dealer_code filter at all, unlike LookupVehicleForWizardAsync/SearchVehiclesForWizardAsync
    /// just below in this same file, which both already scope by `(@dealerCode IS NULL OR
    /// sb.dealer_code = @dealerCode)`. This overload applies that exact same, already-proven
    /// pattern to the Vehicle Sale LIST endpoint too - dealerCode null still means "every dealer"
    /// (same convention as the other two methods), so this is purely additive: the original 2-arg
    /// overload above is UNCHANGED and still delegates here with dealerCode: null, so nothing that
    /// already calls it breaks.
    ///
    /// NOT WIRED IN YET: I don't have DmsBaplDataController.cs (the file behind GET
    /// /api/dms-bapl-data/vehicle-sales), so I can't safely edit the one place that would actually
    /// call this new overload with the logged-in user's dealer code instead of the old unscoped one
    /// - see the chat message delivering this file for exactly what to search your solution for.
    /// </summary>
    Task<IReadOnlyList<DmsBaplDataVehicleSaleRow>> GetVehicleSalesAsync(string? soldToFilter, string? dealerCode, CancellationToken ct = default);

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
    ///
    /// 2026-09-28 ADDED ("in jobcard reg no. not serach according which report came in vehicle sale
    /// that also fix"): DMS_SaleBill.reg_number is frequently a "TEMP####" placeholder, not the
    /// vehicle's real registration number (SECTION 113's finding, on the Vehicle Sale page) - so
    /// searching the wizard by a vehicle's ACTUAL reg no. (only on record in DMSBAPLDATA's
    /// DMS_ServiceHistory once it's had a service visit) used to find nothing here. If the query
    /// above finds no match, this now falls through to resolving a ChassisNo from
    /// DMS_ServiceHistory by that same value (exact ChassisNo match, or normalized RegNo match),
    /// then re-runs this same DMS_SaleBill lookup by that ChassisNo. Still returns null if neither
    /// source has it - this only widens what counts as a match, it never removes the original path.
    /// </summary>
    Task<DmsBaplDataVehicleSaleRow?> LookupVehicleForWizardAsync(string value, string? dealerCode, CancellationToken ct = default);

    /// <summary>
    /// Typeahead suggestions for the Job Card Wizard's chassis/reg-no search box, sourced from the
    /// same BaplConnection dbo.DMS_SaleBill table as LookupVehicleForWizardAsync above - one row per
    /// distinct chassis, most recently sold first. Fewer than 2 characters returns an empty list
    /// without querying BaplConnection, same convention as SearchServiceHistoryVehiclesAsync below.
    ///
    /// 2026-09-28 ADDED: same DMS_ServiceHistory widening as LookupVehicleForWizardAsync above -
    /// any ChassisNo DMS_ServiceHistory turns up for this query (by ChassisNo or RegNo) is ALSO
    /// matched against DMS_SaleBill directly (in addition to DMS_SaleBill's own chassis_no/
    /// reg_number LIKE match), so typing a vehicle's real reg no. surfaces it here too.
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
    // 2026-09-28 ADDED - JobCardScannerDb (this app's OWN database), needed only to read back
    // manually-saved Reg No overrides (see GetVehicleSalesAsync's 2026-09-28 update and
    // VehicleSaleOverride.cs's doc comment). Everything else in this class still only ever talks
    // to ConnStr/BaplConnStr (DMSBAPLDATA/BaplConnection) - this is the one exception, and it's
    // read-only here too (the actual write happens in VehicleSaleOverridesController, not here).
    private readonly JobCardScannerDbContext _db;

    public DmsBaplDataService(IConfiguration config, ILogger<DmsBaplDataService> logger, JobCardScannerDbContext db)
    {
        _config = config;
        _logger = logger;
        _db = db;
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

    // 2026-10-01: unchanged signature, kept for any existing caller - delegates to the dealer-aware
    // overload below with dealerCode: null (same "null = every dealer" behavior this method always
    // had, so this is not a behavior change for whatever already calls this exact overload).
    public Task<IReadOnlyList<DmsBaplDataVehicleSaleRow>> GetVehicleSalesAsync(string? soldToFilter, CancellationToken ct = default) =>
        GetVehicleSalesAsync(soldToFilter, dealerCode: null, ct);

    public async Task<IReadOnlyList<DmsBaplDataVehicleSaleRow>> GetVehicleSalesAsync(string? soldToFilter, string? dealerCode, CancellationToken ct = default)
    {
        var rows = new List<DmsBaplDataVehicleSaleRow>();

        try
        {
            await using var conn = new SqlConnection(BaplConnStr);
            await conn.OpenAsync(ct);

            // 2026-10-01 ADDED: dealer scoping, mirroring LookupVehicleForWizardAsync/
            // SearchVehiclesForWizardAsync's existing `(@dealerCode IS NULL OR sb.dealer_code =
            // @dealerCode)` pattern below in this same file - see this method's interface doc
            // comment for why (cross-dealer data was visible without this).
            var sql = $@"
                SELECT {VehicleSaleSelectColumns}
                {VehicleSaleFromJoin}
                WHERE (sb.IsDelete IS NULL OR sb.IsDelete = 0)
                  AND (@soldTo IS NULL OR c.first_name LIKE @soldTo)
                  AND (@dealerCode IS NULL OR sb.dealer_code = @dealerCode)
                ORDER BY sb.CreatedOn DESC, sb.Id DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@soldTo", string.IsNullOrWhiteSpace(soldToFilter) ? DBNull.Value : $"%{soldToFilter.Trim()}%");
            cmd.Parameters.AddWithValue("@dealerCode", string.IsNullOrWhiteSpace(dealerCode) ? DBNull.Value : dealerCode.Trim());
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                rows.Add(MapVehicleSaleRow(rdr));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BaplConnection's vehicle sales (DMS_SaleBill/DMS_SaleBillCustomer): {ex.Message}", ex);
        }

        // 2026-09-28 fallback - see this method's own doc comment on IDmsBaplDataService. Best-effort:
        // if DMSBAPLDATA can't be reached, GetRegNoByChassisFromServiceHistoryAsync logs and returns
        // empty rather than throwing, so a DMSBAPLDATA hiccup never breaks the page's BaplConnection
        // data, which is already fetched successfully by this point.
        //
        // UPDATE 2026-09-28 (your screenshot of the real page): DMS_SaleBill.reg_number isn't simply
        // blank on the affected rows - it holds a literal "TEMP####" placeholder (e.g. "TEMP4852" for
        // chassis "...J014852" - the last 4 digits of the chassis no, a dealer-side placeholder
        // entered before the vehicle's real RTO registration is on record). A blank-only check
        // silently skipped every one of these. IsPlaceholderRegNo below now treats blank AND
        // "TEMP"-prefixed values as needing the DMS_ServiceHistory lookup.
        var missingRegNoChassis = rows
            .Where(r => IsPlaceholderRegNo(r.RegNo) && !string.IsNullOrWhiteSpace(r.ChassisNo))
            .Select(r => r.ChassisNo!)
            .ToList();

        if (missingRegNoChassis.Count > 0)
        {
            var regNoByChassis = await GetRegNoByChassisFromServiceHistoryAsync(missingRegNoChassis, ct);
            if (regNoByChassis.Count > 0)
            {
                rows = rows.Select(r =>
                    !IsPlaceholderRegNo(r.RegNo) || r.ChassisNo == null
                        || !regNoByChassis.TryGetValue(r.ChassisNo, out var regNo) || string.IsNullOrWhiteSpace(regNo)
                        ? r
                        : r with { RegNo = regNo }
                ).ToList();
            }
        }

        // 2026-09-28 ("edit button ... reg no we can edit and that save in our jobcard db that
        // will data reflect on ui"): manual Reg No corrections saved via
        // POST /api/vehicle-sale-overrides (VehicleSaleOverridesController) into JobCardScannerDb -
        // THIS APP'S OWN DATABASE, not DMSBAPLDATA/BaplConnection. This is the FINAL, highest-
        // priority layer: a saved override always wins over both DMS_SaleBill's own reg_number and
        // anything the DMS_ServiceHistory fallback above found, since a human explicitly corrected
        // it.
        //
        // 2026-09-28 UPDATE (real-world fallout, same day: the whole Vehicle Sale page started
        // failing with a misleading "Could not reach DMSBAPLDATA" error): this was originally NOT
        // wrapped in try/catch, on the reasoning that a failure reading our OWN database is a real
        // problem, not an external-system hiccup to quietly shrug off. In practice that meant the
        // page broke ENTIRELY - and blamed the wrong system in the error message - the moment this
        // brand-new table (dbo.VehicleSaleOverride, in JobCardScannerDb - see
        // sql/2026-09-28_create_vehicle_sale_overrides_table.sql) or its DbSet line in
        // JobCardScannerDbContext.cs wasn't in place yet. Now best-effort like the DMSBAPLDATA
        // fallback above: logs a warning and simply skips the override layer (falls back to
        // whatever DMS_SaleBill/DMS_ServiceHistory already resolved) if this table can't be read,
        // instead of failing the whole request. Once the table exists and the DbSet is registered,
        // this goes back to applying real overrides exactly as before - nothing else changes.
        var chassisNumbers = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.ChassisNo))
            .Select(r => r.ChassisNo!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (chassisNumbers.Count > 0)
        {
            try
            {
                var overrideRows = await _db.VehicleSaleOverrides
                    .AsNoTracking()
                    .Where(o => chassisNumbers.Contains(o.ChassisNo))
                    .ToListAsync(ct);

                if (overrideRows.Count > 0)
                {
                    var overrideRegNoByChassis = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var o in overrideRows) overrideRegNoByChassis[o.ChassisNo] = o.RegNo;

                    rows = rows.Select(r =>
                        r.ChassisNo != null && overrideRegNoByChassis.TryGetValue(r.ChassisNo, out var overrideRegNo) && !string.IsNullOrWhiteSpace(overrideRegNo)
                            ? r with { RegNo = overrideRegNo }
                            : r
                    ).ToList();
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not read JobCardScannerDb's dbo.VehicleSaleOverride table - has sql/2026-09-28_create_vehicle_sale_overrides_table.sql been run yet, and is the VehicleSaleOverrides DbSet added to JobCardScannerDbContext.cs? Skipping manual Reg No overrides for this request; DMS_SaleBill/DMS_ServiceHistory results are unaffected.");
            }
        }

        return rows;
    }

    /// <summary>
    /// True for a RegNo that isn't a real registration number yet - blank, or a "TEMP####" dealer
    /// placeholder (2026-09-28, confirmed from your screenshot: "TEMP4852"/"TEMP4848"/etc., matching
    /// each row's chassis no.'s last 4 digits). A row like this is eligible for the
    /// DMS_ServiceHistory RegNo lookup/override in GetVehicleSalesAsync; anything else is treated as
    /// a real, already-correct registration and left untouched.
    ///
    /// ASSUMPTION, not yet confirmed by you: "TEMP" (case-insensitive) is the only placeholder
    /// convention in use. If dealers also enter other placeholder patterns (e.g. all-zero numbers,
    /// "PENDING", "NA"), tell me the pattern and I'll extend this check - guessing further patterns
    /// from 3 sample rows isn't safe.
    /// </summary>
    private static bool IsPlaceholderRegNo(string? regNo) =>
        string.IsNullOrWhiteSpace(regNo) || regNo.Trim().StartsWith("TEMP", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Best-effort RegNo-by-ChassisNo lookup against DMSBAPLDATA's dbo.DMS_ServiceHistory (DMS_IOT_DATA,
    /// via DMSBAPLDATAConnection/ConnStr - NOT BaplConnection), used to fill/override Vehicle Sale
    /// rows whose DMS_SaleBill.reg_number is a placeholder (see IsPlaceholderRegNo above). See
    /// GetVehicleSalesAsync's doc comment for why.
    ///
    /// One chassis can have several DMS_ServiceHistory rows (repeat service visits); MAX(RegNo) is
    /// taken as the representative value per chassis - same convention already used a few methods
    /// below in SearchServiceHistoryVehiclesAsync ("these don't change visit-to-visit in practice").
    /// ASSUMPTION, not yet confirmed by you: a chassis's RegNo doesn't change across its service
    /// history. If a vehicle can genuinely be re-registered (new RegNo issued), MAX(RegNo) may pick
    /// either value rather than the most recent one - tell me if you'd rather rank by MAX(JobDate)
    /// per chassis instead (a small change) and I'll switch it.
    ///
    /// Batched by distinct ChassisNo in chunks of 500 (SQL Server's ~2100 parameter cap makes one
    /// single IN-list unsafe once a Zomato-scoped result set runs into the thousands of rows) - same
    /// "one follow-up query instead of one per row" shape as GetRepairBillsAsync's item lookup above,
    /// just chunked since this list can be far larger than a typical bill/transfer id list.
    /// </summary>
    private async Task<Dictionary<string, string?>> GetRegNoByChassisFromServiceHistoryAsync(IReadOnlyCollection<string> chassisNumbers, CancellationToken ct)
    {
        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        if (chassisNumbers.Count == 0) return result;

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            const int chunkSize = 500;
            var distinct = chassisNumbers.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            for (var offset = 0; offset < distinct.Count; offset += chunkSize)
            {
                var chunk = distinct.Skip(offset).Take(chunkSize).ToList();
                var inClause = string.Join(",", chunk.Select((_, i) => $"@c{i}"));
                var sql = $@"
                    SELECT ChassisNo, MAX(RegNo) AS RegNo
                    FROM [dbo].[DMS_ServiceHistory]
                    WHERE IsRowTotal = 0
                      AND ChassisNo IN ({inClause})
                      AND RegNo IS NOT NULL AND LTRIM(RTRIM(RegNo)) <> ''
                    GROUP BY ChassisNo";

                await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
                for (var i = 0; i < chunk.Count; i++) cmd.Parameters.AddWithValue($"@c{i}", chunk[i]);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                while (await rdr.ReadAsync(ct))
                {
                    var chassis = rdr["ChassisNo"] as string;
                    if (!string.IsNullOrWhiteSpace(chassis))
                        result[chassis] = rdr["RegNo"] as string;
                }
            }
        }
        catch (Exception ex)
        {
            // Best-effort enrichment only, never the primary source - see this method's doc comment.
            _logger.LogWarning(ex, "Could not look up RegNo by ChassisNo from DMSBAPLDATA's DMS_ServiceHistory - affected Vehicle Sale rows will keep a blank RegNo for this request.");
        }

        return result;
    }

    public async Task<DmsBaplDataVehicleSaleRow?> LookupVehicleForWizardAsync(string value, string? dealerCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        var valueNoSpaces = trimmed.Replace(" ", "").Replace("-", "");
        DmsBaplDataVehicleSaleRow? hit = null;

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
            cmd.Parameters.AddWithValue("@dealerCode", string.IsNullOrWhiteSpace(dealerCode) ? DBNull.Value : dealerCode.Trim());
            cmd.Parameters.AddWithValue("@value", trimmed);
            cmd.Parameters.AddWithValue("@valueNoSpaces", valueNoSpaces);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct)) hit = MapVehicleSaleRow(rdr);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not look up the vehicle in BaplConnection (DMS_SaleBill/DMS_SaleBillCustomer): {ex.Message}", ex);
        }

        if (hit is null)
        {
            // 2026-09-28 fallback ("in jobcard reg no. not serach according which report came in
            // vehicle sale that also fix") - see this method's doc comment / SECTION 113/115.
            // DMS_SaleBill.reg_number is frequently a "TEMP####" placeholder, so a vehicle's REAL
            // reg no. (only on record in DMSBAPLDATA's DMS_ServiceHistory once it's had a service
            // visit) found nothing above. Resolve a ChassisNo from DMS_ServiceHistory by the same
            // value, then re-run this same DMS_SaleBill lookup by that chassis no.
            var chassisFromHistory = await FindChassisByServiceHistoryMatchAsync(trimmed, valueNoSpaces, ct);
            if (chassisFromHistory is not null)
            {
                try
                {
                    await using var conn = new SqlConnection(BaplConnStr);
                    await conn.OpenAsync(ct);

                    var sql = $@"
                        SELECT TOP 1 {VehicleSaleSelectColumns}
                        {VehicleSaleFromJoin}
                        WHERE (sb.IsDelete IS NULL OR sb.IsDelete = 0)
                          AND (@dealerCode IS NULL OR sb.dealer_code = @dealerCode)
                          AND LTRIM(RTRIM(sb.chassis_no)) = @chassis
                        ORDER BY sb.CreatedOn DESC, sb.Id DESC";

                    await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
                    cmd.Parameters.AddWithValue("@dealerCode", string.IsNullOrWhiteSpace(dealerCode) ? DBNull.Value : dealerCode.Trim());
                    cmd.Parameters.AddWithValue("@chassis", chassisFromHistory);
                    await using var rdr = await cmd.ExecuteReaderAsync(ct);
                    if (await rdr.ReadAsync(ct)) hit = MapVehicleSaleRow(rdr);
                }
                catch (Exception ex)
                {
                    throw new InvalidOperationException($"Could not look up the vehicle in BaplConnection (DMS_SaleBill/DMS_SaleBillCustomer) by the chassis no. resolved from DMS_ServiceHistory: {ex.Message}", ex);
                }
            }
        }

        // 2026-09-28 ("Reg no. are shown different from now which we bind in Vehicle sale") - see
        // ResolveDisplayRegNosAsync's doc comment: this makes the Wizard show the exact same Reg No
        // the Vehicle Sale page would show for this same chassis (DMS_ServiceHistory fallback +
        // any manually-saved override), instead of the raw, possibly-placeholder DMS_SaleBill value.
        if (hit is not null && !string.IsNullOrWhiteSpace(hit.ChassisNo))
        {
            var displayRegNos = await ResolveDisplayRegNosAsync(new[] { (hit.ChassisNo!, hit.RegNo) }, ct);
            if (displayRegNos.TryGetValue(hit.ChassisNo!, out var displayRegNo) && !string.IsNullOrWhiteSpace(displayRegNo))
                hit = hit with { RegNo = displayRegNo };
        }

        return hit;
    }

    /// <summary>
    /// Applies the SAME 3-layer Reg No resolution GetVehicleSalesAsync uses (placeholder detection
    /// -> DMS_ServiceHistory fallback -> manually-saved JobCardScannerDb override, see that
    /// method's 2026-09-28 doc comments) to an arbitrary set of (ChassisNo, RegNo) pairs.
    ///
    /// ADDED 2026-09-28 ("that page when i search chassis no. with that Reg no. are shown different
    /// from now which we bind in Vehicle sale that chassis no. and that Reg no. shown"): SECTION 115
    /// widened what the Wizard's chassis/reg-no search could MATCH (via DMS_ServiceHistory), but the
    /// RegNo VALUE it then showed still came straight off DMS_SaleBill's own reg_number - never
    /// enriched the way Vehicle Sale's own display is. That's exactly why the two pages could show
    /// two different Reg Nos for the one chassis. LookupVehicleForWizardAsync/
    /// SearchVehiclesForWizardAsync both call this now so the Wizard shows the identical Reg No the
    /// Vehicle Sale page would, for the same chassis.
    /// </summary>
    private async Task<Dictionary<string, string?>> ResolveDisplayRegNosAsync(IReadOnlyCollection<(string ChassisNo, string? RegNo)> rows, CancellationToken ct)
    {
        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        if (rows.Count == 0) return result;

        var placeholderChassis = rows
            .Where(r => IsPlaceholderRegNo(r.RegNo))
            .Select(r => r.ChassisNo)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var serviceHistoryRegNos = placeholderChassis.Count > 0
            ? await GetRegNoByChassisFromServiceHistoryAsync(placeholderChassis, ct)
            : new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

        var allChassis = rows.Select(r => r.ChassisNo).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var overridesByChassis = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        // 2026-09-28 UPDATE: same reasoning/fix as GetVehicleSalesAsync's own override read above -
        // best-effort, not a page-breaking failure, if JobCardScannerDb's VehicleSaleOverride table
        // isn't provisioned yet.
        try
        {
            var overrideRows = await _db.VehicleSaleOverrides.AsNoTracking().Where(o => allChassis.Contains(o.ChassisNo)).ToListAsync(ct);
            foreach (var o in overrideRows) overridesByChassis[o.ChassisNo] = o.RegNo;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read JobCardScannerDb's dbo.VehicleSaleOverride table for the Wizard's Reg No enrichment - has it been created yet (sql/2026-09-28_create_vehicle_sale_overrides_table.sql)? Continuing without manual overrides for this request.");
        }

        foreach (var r in rows)
        {
            var regNo = r.RegNo;
            if (IsPlaceholderRegNo(regNo) && serviceHistoryRegNos.TryGetValue(r.ChassisNo, out var fromHistory) && !string.IsNullOrWhiteSpace(fromHistory))
                regNo = fromHistory;
            if (overridesByChassis.TryGetValue(r.ChassisNo, out var overrideRegNo) && !string.IsNullOrWhiteSpace(overrideRegNo))
                regNo = overrideRegNo;
            result[r.ChassisNo] = regNo;
        }
        return result;
    }

    /// <summary>
    /// Resolves a ChassisNo from DMSBAPLDATA's dbo.DMS_ServiceHistory (DMS_IOT_DATA, via
    /// DMSBAPLDATAConnection/ConnStr) by an exact ChassisNo match OR a normalized RegNo match - the
    /// fallback LookupVehicleForWizardAsync/SearchVehiclesForWizardAsync use when a search value
    /// matches nothing in BaplConnection's DMS_SaleBill directly (see SECTION 113: reg_number there
    /// is frequently just a "TEMP####" placeholder, so a REAL reg no. the user types often only
    /// exists in DMS_ServiceHistory). Most-recently-serviced match wins when more than one history
    /// row matches. Best-effort: returns null (not an exception) if DMSBAPLDATA can't be reached -
    /// the caller already knows how to report "not found" either way.
    /// </summary>
    private async Task<string?> FindChassisByServiceHistoryMatchAsync(string trimmedValue, string valueNoSpaces, CancellationToken ct)
    {
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            const string sql = @"
                SELECT TOP 1 ChassisNo
                FROM [dbo].[DMS_ServiceHistory]
                WHERE IsRowTotal = 0
                  AND ChassisNo IS NOT NULL
                  AND (LTRIM(RTRIM(ChassisNo)) = @value
                       OR REPLACE(REPLACE(LTRIM(RTRIM(RegNo)), ' ', ''), '-', '') = @valueNoSpaces)
                ORDER BY JobDate DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@value", trimmedValue);
            cmd.Parameters.AddWithValue("@valueNoSpaces", valueNoSpaces);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            return await rdr.ReadAsync(ct) ? rdr["ChassisNo"] as string : null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not resolve a ChassisNo from DMSBAPLDATA's DMS_ServiceHistory for wizard search value - falling through to 'not found'.");
            return null;
        }
    }

    public async Task<IReadOnlyList<DmsBaplDataVehicleSuggestion>> SearchVehiclesForWizardAsync(string? q, string? dealerCode, int take, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2) return Array.Empty<DmsBaplDataVehicleSuggestion>();
        // 2026-09-28 ("too less shown shown all chassisno. for this location"): raised from
        // <= 50 ? take : 20 - that silently reset ANY caller-supplied take above 50 back down to
        // 20, which is what was actually capping this dealer's typeahead. The frontend's own
        // pre-existing "Showing the first N matches" hint at vehicleSuggestions.length >= 100
        // (JobCardWizardPage.tsx) implies 100 was always the intended cap - this now matches that,
        // and JobCardsController.VehicleSuggestionsForWizard's own hardcoded call-site argument is
        // raised to 100 in the same change so the two agree. FACT: the old 20 was confirmed via the
        // real controller/service code, not guessed. ASSUMPTION/UNCONFIRMED: if
        // bgauss.chhatarpur@gmail.com's login still shows fewer chassis than expected after this,
        // that could be a separate dealer-code-scoping issue (DealerId -> BaplDmsDealerCode mapping)
        // rather than this take-cap - flagged to the user, needs real data to confirm either way.
        take = take is > 0 and <= 200 ? take : 100;
        var trimmedQ = q.Trim();

        // 2026-09-28 ("in jobcard reg no. not serach according which report came in vehicle sale
        // that also fix") - see LookupVehicleForWizardAsync's doc comment / SECTION 115.
        // DMS_SaleBill.reg_number is frequently a "TEMP####" placeholder, so typing a vehicle's
        // REAL reg no. wouldn't match anything below on its own. Resolve any ChassisNo(s)
        // DMS_ServiceHistory knows for this query FIRST, then let the DMS_SaleBill search below
        // also match directly on those chassis numbers, in addition to its own chassis_no/
        // reg_number LIKE match. Best-effort - an empty list here just means no extra matches, the
        // original LIKE-based search still runs as before.
        var chassisFromHistory = await FindChassisNumbersByServiceHistoryMatchAsync(trimmedQ, take, ct);

        var results = new List<DmsBaplDataVehicleSuggestion>();
        try
        {
            await using var conn = new SqlConnection(BaplConnStr);
            await conn.OpenAsync(ct);

            var chassisInClause = chassisFromHistory.Count > 0
                ? " OR sb.chassis_no IN (" + string.Join(",", chassisFromHistory.Select((_, i) => $"@ch{i}")) + ")"
                : "";

            var sql = $@"
                SELECT TOP (@take) sb.chassis_no, sb.reg_number, sb.Item_Modl, sb.InvoiceDate, sb.salebill_date, sb.CreatedOn
                FROM [dbo].[DMS_SaleBill] sb
                WHERE (sb.IsDelete IS NULL OR sb.IsDelete = 0)
                  AND (@dealerCode IS NULL OR sb.dealer_code = @dealerCode)
                  AND sb.chassis_no IS NOT NULL
                  AND (sb.chassis_no LIKE @q OR sb.reg_number LIKE @q{chassisInClause})
                ORDER BY sb.CreatedOn DESC";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@take", take);
            cmd.Parameters.AddWithValue("@dealerCode", string.IsNullOrWhiteSpace(dealerCode) ? DBNull.Value : dealerCode.Trim());
            cmd.Parameters.AddWithValue("@q", $"%{trimmedQ}%");
            for (var i = 0; i < chassisFromHistory.Count; i++) cmd.Parameters.AddWithValue($"@ch{i}", chassisFromHistory[i]);
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

        // 2026-09-28 ("Reg no. are shown different from now which we bind in Vehicle sale"): the
        // typeahead's own DMS_SaleBill query above only ever returns that table's raw reg_number
        // (often a "TEMP####" placeholder - SECTION 113), and SECTION 115's chassis-matching
        // widening never touched the VALUE shown for each suggestion, only which rows matched. Run
        // every suggestion through the same 3-layer resolution (placeholder -> DMS_ServiceHistory ->
        // this app's own VehicleSaleOverride) that GetVehicleSalesAsync/LookupVehicleForWizardAsync
        // already use, so the Wizard's dropdown shows the identical Reg No the Vehicle Sale page
        // shows for the same chassis - closing the gap this fix's earlier round left open.
        if (results.Count > 0)
        {
            var displayRegNos = await ResolveDisplayRegNosAsync(
                results.Select(r => (r.ChassisNo, r.RegNo)).ToList(), ct);
            for (var i = 0; i < results.Count; i++)
            {
                if (displayRegNos.TryGetValue(results[i].ChassisNo, out var displayRegNo) && !string.IsNullOrWhiteSpace(displayRegNo))
                    results[i] = results[i] with { RegNo = displayRegNo };
            }
        }

        return results;
    }

    /// <summary>
    /// Best-effort ChassisNo search against DMSBAPLDATA's dbo.DMS_ServiceHistory (DMS_IOT_DATA, via
    /// DMSBAPLDATAConnection/ConnStr) by partial ChassisNo OR RegNo match - the typeahead-widening
    /// half of SearchVehiclesForWizardAsync's 2026-09-28 fix (see that method's doc comment).
    /// Capped at `take` distinct chassis numbers (no point resolving more than the typeahead itself
    /// will ever show). Returns an empty list (not an exception) if DMSBAPLDATA can't be reached -
    /// the caller's own DMS_SaleBill LIKE-match still runs regardless.
    /// </summary>
    private async Task<List<string>> FindChassisNumbersByServiceHistoryMatchAsync(string q, int take, CancellationToken ct)
    {
        var results = new List<string>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            const string sql = @"
                SELECT DISTINCT TOP (@take) ChassisNo
                FROM [dbo].[DMS_ServiceHistory]
                WHERE IsRowTotal = 0
                  AND ChassisNo IS NOT NULL
                  AND (ChassisNo LIKE @q OR RegNo LIKE @q)";

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@take", take);
            cmd.Parameters.AddWithValue("@q", $"%{q}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var chassis = rdr["ChassisNo"] as string;
                if (!string.IsNullOrWhiteSpace(chassis)) results.Add(chassis);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not search DMSBAPLDATA's DMS_ServiceHistory for wizard typeahead query '{Query}' - suggestions will only reflect BaplConnection's own chassis_no/reg_number match.", q);
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
