using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace JobCardScanner.Api.Services;

/// <summary>One active dealer/workshop row read from BAPL DMS's own DealerMaster (separate
/// database - BAPLDMSvadConnection - and a separate table from BaplDealerService's
/// C_CustomerMaster, which lives in the BAPL ERP data warehouse instead).</summary>
public record BaplDmsDealerRow(
    string DealerCode,
    string DealerName,
    string City,
    string State,
    string Mobile,
    string Email,
    string ContactPerson);

/// <summary>Everything BAPL DMS knows about one vehicle by chassis/registration number - the
/// "auto fetch everything" payload for the Job Card Wizard, modeled directly on BAPL DMS's own
/// JobCardRepo.GetAllInspectedLotChassisAsync/LotInspectionChassisVM (ported to a single-vehicle
/// lookup - see BaplDmsService.LookupVehicleAsync for the port notes).</summary>
public record BaplDmsVehicleRow(
    string ChassisNo,
    string? RegisterNo,
    string? ModelName,
    string? CustomerName,
    string? CustomerMobile,
    string? BatteryNumber,
    string? MotorNo,
    string? ControllerNo,
    string? ConverterNo,
    string? ChargerNumber,
    DateOnly? SaleDate,
    DateOnly? InsuranceExpDate,
    DateOnly? NextServiceDueDate,
    int? VehiclePrevKms,
    decimal? OdoReading,
    decimal? Duration,
    string? DurationType,
    DateOnly? ExpireWarrantyDate,
    bool IsSold,
    // ---- Added when the lookup was rewritten to source from ChassisDetails/LedgerMaster (BAPL
    // DMS's own vehicle master) instead of only from past job card history - see LookupVehicleAsync.
    // Appended at the end with defaults so existing positional callers don't break. ----
    string? CustomerCity = null,
    int? CustomerLedgerId = null,
    /// <summary>BAPL DMS's LocationMaster.Loccode this vehicle/chassis is registered against
    /// (ChassisDetails.LocationCode) - used to pre-select the Service Location dropdown.</summary>
    string? LocationCode = null,
    string? DealerCode = null);

/// <summary>One workshop/service location row from BAPL DMS's own LocationMaster - filtered to the
/// "W" series (Loccode ending in W&lt;digits&gt;, e.g. "CUS0435W1") per your own workshops, as
/// opposed to the "S" (showroom) and "G" (godown/stock point) series LocationMaster also holds for
/// the same dealer. Confirmed via `SELECT * FROM LocationMaster` you ran directly.</summary>
public record BaplDmsWorkshopRow(string LocCode, string LocName, string City, string State, string DealerCode);

/// <summary>One row from BAPL DMS's JobType master (confirmed via `SELECT * FROM JobType`) - the
/// Job Type dropdown's source, first level of the JobType -&gt; ServiceHead -&gt; ServiceType cascade.</summary>
public record BaplDmsJobTypeRow(int Id, string Name);

/// <summary>One row from BAPL DMS's ServiceHead master (confirmed via `SELECT * FROM ServiceHead`),
/// scoped to one JobTypeId - the Service Head dropdown's source, dependent on the Job Type picked.</summary>
public record BaplDmsServiceHeadRow(int Id, int JobTypeId, string Name);

/// <summary>One row from BAPL DMS's ServiceType master (confirmed via `SELECT * FROM ServiceType`),
/// scoped to one ServiceHeadId - the Service Type dropdown's source, dependent on the Service Head
/// picked.</summary>
public record BaplDmsServiceTypeRow(int Id, int ServiceHeadId, string Name);

/// <summary>One row from BAPL DMS's ComplaintMaster (confirmed via `SELECT * FROM ComplaintMaster`)
/// - the "Customer complaints / concerns" dropdown's source. Status is filtered to active (1) rows
/// only.</summary>
public record BaplDmsComplaintRow(int Id, string Name, int? GroupName);

/// <summary>One row from BAPL DMS's JobSource master (confirmed via `SELECT * FROM JobSource`:
/// Walk In, RSA, Mega Camp, Others, ...) - replaces the wizard's old hardcoded WalkIn/PickupAndDrop/
/// Breakdown/Scheduled/Online "Source" dropdown, which was JobCardScanner's own invented list, not
/// anything BAPL DMS actually tracks.</summary>
public record BaplDmsJobSourceRow(int Id, string Name);

/// <summary>Everything needed to write one new job card into BAPL DMS's own database - modeled
/// directly on BAPL DMS's own JobCardRepo.InsertJobCardinfoDetails (pasted into this project's chat
/// history for reference), covering the JobCardHeader/JobCardCustomer/JobCardBatteryDetail/
/// JobCardComplaint columns that repo actually populates on insert. See
/// BaplDmsService.CreateJobCardAsync for what's intentionally left out (columns that repo's
/// ViewModel carries but the Job Card Wizard has no equivalent input for, e.g. AirpressureRearTyre)
/// and the doc comment there on why this is a best-effort sync, not a guaranteed one.</summary>
public record BaplDmsCreateJobCardRequest(
    string DealerCode,
    int JobTypeId,
    int ServiceHeadId,
    string ServiceHeadName,
    int ServiceTypeId,
    string ServiceTypeName,
    string? ServiceLocationCode,
    string ChassisNo,
    string? RegisterNo,
    string? ModelName,
    int VehicleKms,
    string? Supervisor,
    string? Technician,
    string? ManualJobNo,
    string? CustomerName,
    string? CustomerMobile,
    int? CustomerLedgerId,
    string? MotorNo,
    string? BatteryNo,
    string? ControllerNo,
    string? ConverterNo,
    string? ChargerNo,
    DateOnly? SaleDate,
    DateOnly? InsuranceExpDate,
    DateOnly? NextServiceDueDate,
    DateTime? ExpectedDeliveryAt,
    IReadOnlyList<string> Complaints,
    string CreatedBy,
    /// <summary>BAPL DMS's own JobSource.Id (Walk In/RSA/Mega Camp/...), replacing the previously
    /// hardcoded 1 ("Walk In") written to JobCardHeader.JobSource. Still defaults to 1 when not
    /// supplied, so existing callers keep working unchanged.</summary>
    int? JobSourceId = null);

/// <summary>Result of a successful BAPL DMS job card insert - JobCardHeaderId lets JobCardScanner's
/// own JobCard row remember which BAPL DMS record it created (JobCard.BaplJobCardHeaderId), so the
/// Job Card Detail page can link straight to it the same way a BaplDms-sourced /jobcards row does.</summary>
public record BaplDmsCreateJobCardResult(int JobCardHeaderId, int JobNo);

/// <summary>One past visit for a chassis, straight from BAPL DMS's own job card history - the
/// "Service History" section on JobCardScanner's own Job Card Detail page (see
/// BaplDmsService.GetServiceHistoryAsync).</summary>
/// <summary>One row for the /jobcards list page's merged view (JobCardScanner's own job cards +
/// BAPL DMS's) - deliberately narrower than BaplDmsJobCardHistoryRow (no Complaints aggregate,
/// since a list of many rows doing a STRING_AGG subquery per row is unnecessary work for a browse
/// view) but includes customer/vehicle columns that history doesn't need since it's already scoped
/// to one chassis. See BaplDmsService.SearchJobCardsAsync.</summary>
public record BaplDmsJobCardListRow(
    int JobCardHeaderId,
    int? JobNo,
    string? JobPrefix,
    DateOnly? JobInDate,
    string? JobStatus,
    string? DealerCode,
    string? CustomerName,
    string? CustomerMobile,
    string? ModelName,
    string? ChassisNo,
    string? RegisterNo,
    string? Supervisor,
    string? Technician);

/// <summary>Full read-only detail for one BAPL DMS job card, by its JobCardHeaderId - powers the
/// read-only "BAPL DMS Job Card" view a merged /jobcards list row links to (see
/// BaplDmsService.GetJobCardByIdAsync and the /jobcards/bapl/:id page). A superset of
/// BaplDmsJobCardListRow/BaplDmsJobCardHistoryRow's columns - all still the confirmed
/// JobCardHeader/JobCardCustomer/JobCardBatteryDetail/JobCardComplaint schema, just more of it.</summary>
public record BaplDmsJobCardDetailRow(
    int JobCardHeaderId,
    int? JobNo,
    string? JobPrefix,
    DateOnly? JobInDate,
    string? JobStatus,
    string? InwardType,
    int? VehicleKms,
    string? Supervisor,
    string? Technician,
    string? InvoiceNo,
    string? DealerCode,
    string? CustomerName,
    string? CustomerMobile,
    string? CustomerAltMobile,
    string? ModelName,
    string? ChassisNo,
    string? RegisterNo,
    string? MotorNo,
    string? BatteryNo,
    DateOnly? SaleDate,
    DateOnly? InsuranceExpDate,
    DateOnly? NextServiceDueDate,
    DateOnly? RsaRenewalDate,
    string? Remarks,
    string? ControllerNo,
    string? ConverterNo,
    string? ChargerNo,
    string? Complaints);

public record BaplDmsJobCardHistoryRow(
    int JobCardHeaderId,
    int? JobNo,
    string? JobPrefix,
    DateOnly? JobInDate,
    string? JobStatus,
    string? InwardType,
    int? VehicleKms,
    string? Supervisor,
    string? Technician,
    string? InvoiceNo,
    string? Complaints);

public interface IBaplDmsService
{
    /// <summary>Live search of BAPL DMS's active dealers by name/code (min 2 chars), for the Job
    /// Card Wizard's "search Dealer / Workshop" picker. Throws <see cref="InvalidOperationException"/>
    /// if BAPLDMSvadConnection isn't configured or the query fails.</summary>
    Task<IReadOnlyList<BaplDmsDealerRow>> SearchDealersAsync(string q, CancellationToken ct = default);

    /// <summary>
    /// Looks up one vehicle by chassis number, registration number, or customer mobile number.
    /// Primary source is BAPL DMS's own job card history (JobCardHeader/JobCardCustomer/
    /// JobCardBatteryDetail - table and column names confirmed directly against your database, not
    /// guessed) - the most recent job card for a matching chassis/reg-no/mobile. If nothing has ever
    /// been serviced there, this falls back to BAPL's "inspected lot" tables (LotinspectionHeader/
    /// ChassisDetail/...) for a brand-new, not-yet-sold vehicle - those table/column names are NOT
    /// independently confirmed, so a failure there is logged and swallowed rather than surfaced,
    /// since the primary query already succeeded (there's just nothing more to add).
    /// When <paramref name="dealerCode"/> is given, results are scoped to that dealer; when it's
    /// null, every dealer is searched, which is safe here because the caller is always searching by
    /// an already-specific chassis/reg no/mobile, not browsing a whole inventory.
    /// Returns null ONLY for a genuine "ran fine, zero rows anywhere" - a failure in the PRIMARY
    /// query (wrong table/column name, network, credentials, ...) throws
    /// <see cref="InvalidOperationException"/> instead of silently reporting "not found", so a real
    /// problem surfaces as a 502 with the actual SQL error instead of looking like missing data.
    /// </summary>
    Task<BaplDmsVehicleRow?> LookupVehicleAsync(string value, string? dealerCode, CancellationToken ct = default);

    /// <summary>
    /// This chassis's past job cards in BAPL DMS (JobCardHeader/JobCardCustomer/JobCardComplaint),
    /// most recent first - for the "Service History" section on the Job Card Detail page. Throws
    /// <see cref="InvalidOperationException"/> on a real failure (same reasoning as
    /// LookupVehicleAsync's primary query - this schema is confirmed, so an error here is real).
    /// </summary>
    Task<IReadOnlyList<BaplDmsJobCardHistoryRow>> GetServiceHistoryAsync(string chassisNo, string? dealerCode, CancellationToken ct = default);

    /// <summary>
    /// Browse/search across BAPL DMS's own job cards (JobCardHeader/JobCardCustomer - same
    /// confirmed schema as LookupVehicleAsync's primary query and GetServiceHistoryAsync), for
    /// blending into the /jobcards list page alongside JobCardScanner's own records (see
    /// JobCardsController.List). <paramref name="q"/> matches chassis no., registration no.,
    /// customer name/mobile, or job number - optional, pass null/empty for an unfiltered browse.
    /// <paramref name="dealerCode"/> scopes to one dealer; null searches every dealer, which
    /// JobCardsController.List only ever does for CorporateAdmin/SystemAdmin (same cross-dealer
    /// visibility they already have over JobCardScanner's own data) - a dealer-scoped caller whose
    /// local Dealer row has no BaplDmsDealerCode should skip calling this entirely rather than pass
    /// null, since that would show every dealer's BAPL DMS job cards to a single-dealer user.
    /// Throws <see cref="InvalidOperationException"/> on a real failure (confirmed schema, same
    /// reasoning as the other two methods above) - the list page treats that as "BAPL DMS is
    /// unavailable right now" and still shows JobCardScanner's own rows.
    /// </summary>
    Task<IReadOnlyList<BaplDmsJobCardListRow>> SearchJobCardsAsync(string? q, string? dealerCode, int take, CancellationToken ct = default);

    /// <summary>
    /// Full read-only detail for one BAPL DMS job card by its JobCardHeaderId - what a BAPL DMS row
    /// on the /jobcards list links to, since there's no JobCardScanner record to open for one.
    /// Returns null for a genuine "no such id"; throws <see cref="InvalidOperationException"/> on a
    /// real failure (confirmed schema, same reasoning as the other methods above).
    /// </summary>
    Task<BaplDmsJobCardDetailRow?> GetJobCardByIdAsync(int jobCardHeaderId, CancellationToken ct = default);

    /// <summary>Active workshop locations from BAPL DMS's own LocationMaster, filtered to the "W"
    /// series (Loccode ending in W&lt;digits&gt;) - i.e. actual workshops, not showrooms ("S") or
    /// godowns ("G") that the same table also holds. <paramref name="dealerCode"/> scopes to one
    /// dealer; null browses every dealer's workshops (only used for a free-text search, never for
    /// the per-dealer Service Location dropdown). Throws <see cref="InvalidOperationException"/> on
    /// a real failure.</summary>
    Task<IReadOnlyList<BaplDmsWorkshopRow>> GetWorkshopsAsync(string? dealerCode, string? q, CancellationToken ct = default);

    /// <summary>BAPL DMS's JobType master, for the wizard's Job Type dropdown (first level of the
    /// JobType -&gt; ServiceHead -&gt; ServiceType cascade).</summary>
    Task<IReadOnlyList<BaplDmsJobTypeRow>> GetJobTypesAsync(CancellationToken ct = default);

    /// <summary>BAPL DMS's ServiceHead master scoped to one JobTypeId, for the wizard's Service Head
    /// dropdown (second level of the cascade - populated only after a Job Type is picked).</summary>
    Task<IReadOnlyList<BaplDmsServiceHeadRow>> GetServiceHeadsAsync(int jobTypeId, CancellationToken ct = default);

    /// <summary>BAPL DMS's ServiceType master scoped to one ServiceHeadId, for the wizard's Service
    /// Type dropdown (third level of the cascade - populated only after a Service Head is picked).</summary>
    Task<IReadOnlyList<BaplDmsServiceTypeRow>> GetServiceTypesAsync(int serviceHeadId, CancellationToken ct = default);

    /// <summary>BAPL DMS's active ComplaintMaster rows, for the "Customer complaints / concerns"
    /// dropdown.</summary>
    Task<IReadOnlyList<BaplDmsComplaintRow>> GetComplaintsAsync(CancellationToken ct = default);

    /// <summary>BAPL DMS's JobSource master (Walk In/RSA/Mega Camp/...), for the wizard's "Source"
    /// dropdown - replaces the WalkIn/PickupAndDrop/Breakdown/Scheduled/Online list that used to be
    /// hardcoded there (JobCardScanner's own invented values, not anything BAPL DMS tracks).</summary>
    Task<IReadOnlyList<BaplDmsJobSourceRow>> GetJobSourcesAsync(CancellationToken ct = default);

    /// <summary>
    /// Writes one new job card into BAPL DMS's own database (JobCardHeader/JobCardCustomer/
    /// JobCardBatteryDetail/JobCardComplaint), mirroring BAPL DMS's own JobCardRepo.
    /// InsertJobCardinfoDetails in a single transaction. This is a BEST-EFFORT sync called only
    /// AFTER JobCardScanner's own local job card is already saved - a failure here throws
    /// <see cref="InvalidOperationException"/>, which the caller (JobCardsController.Create) catches
    /// and surfaces as a warning on an otherwise-successful response, never as a reason to fail or
    /// roll back the local job card. See the doc comment on CreateJobCardAsync's implementation for
    /// exactly which columns/defaults this fills in and which ones are still guesses (JobNo
    /// generation, CreatedBy's format, Jobprefix) since they could only be inferred from your pasted
    /// repository code, not independently confirmed against a live insert.
    /// </summary>
    Task<BaplDmsCreateJobCardResult> CreateJobCardAsync(BaplDmsCreateJobCardRequest req, CancellationToken ct = default);
}

/// <summary>
/// Reads BAPL's own Dealer Management System (DMS) database - a separate SQL Server/database from
/// both JobCardScannerDb and the BAPL ERP warehouse BaplDealerService reads from - to power the Job
/// Card Wizard's dealer search and chassis/registration-number vehicle auto-fill. Plain ADO.NET
/// (Microsoft.Data.SqlClient), same as BaplDealerService, rather than a second EF DbContext: this
/// is a read-only integration against a schema this app doesn't own or migrate, and BAPL DMS's own
/// backend (JobCardRepo.GetAllInspectedLotChassisAsync, pasted into this project's chat history for
/// reference) already defines the exact joins/columns to copy - see the inline comments below for
/// where each piece came from and the one bug intentionally NOT carried over.
/// </summary>
public class BaplDmsService : IBaplDmsService
{
    private readonly IConfiguration _config;
    private readonly ILogger<BaplDmsService> _logger;

    public BaplDmsService(IConfiguration config, ILogger<BaplDmsService> logger)
    {
        _config = config;
        _logger = logger;
    }

    private string ConnStr => _config.GetConnectionString("BAPLDMSvadConnection")
        ?? throw new InvalidOperationException("BAPLDMSvadConnection isn't configured in appsettings.json's ConnectionStrings section.");

    public async Task<IReadOnlyList<BaplDmsDealerRow>> SearchDealersAsync(string q, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2) return Array.Empty<BaplDmsDealerRow>();

        const string sql = @"
            SELECT TOP 20
                d.Dealercode  AS DealerCode,
                d.Compname    AS DealerName,
                ISNULL(d.City, '')            AS City,
                ISNULL(d.State, '')           AS State,
                ISNULL(d.Mobile, '')          AS Mobile,
                ISNULL(d.Email, '')           AS Email,
                ISNULL(d.Contactperson, '')   AS ContactPerson
            FROM [dbo].[DealerMaster] d
            WHERE d.IsActive = 1
              AND (d.Compname LIKE @q OR d.Dealercode LIKE @q)
            ORDER BY d.Compname";

        var results = new List<BaplDmsDealerRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@q", $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsDealerRow(
                    rdr["DealerCode"] as string ?? "",
                    rdr["DealerName"] as string ?? "",
                    rdr["City"] as string ?? "",
                    rdr["State"] as string ?? "",
                    rdr["Mobile"] as string ?? "",
                    rdr["Email"] as string ?? "",
                    rdr["ContactPerson"] as string ?? ""));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not search BAPL DMS's dealer master (DealerMaster): {ex.Message}", ex);
        }

        return results;
    }

    public async Task<BaplDmsVehicleRow?> LookupVehicleAsync(string value, string? dealerCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim();

        await using var conn = new SqlConnection(ConnStr);

        // ----- PRIMARY: BAPL DMS's own vehicle master - ChassisDetails (confirmed directly via a
        // `SELECT TOP 5 * FROM ChassisDetails` you ran) joined to LedgerMaster for the owning
        // customer's identity. This covers BOTH a brand-new, not-yet-sold vehicle (SaleDate IS NULL,
        // LedgerId IS NULL - rows 3/4 in your sample) and an already-sold one (SaleDate populated,
        // LedgerId set - row 2) in one query, which is why this replaced the old two-step "job card
        // history, then a separate not-yet-sold fallback" approach below. ModelName comes straight
        // from ItemName - BAPL DMS doesn't split Model/Variant into two fields, it's one combined
        // name (e.g. "BGauss C12i MAX 2.0 Monolith Grey"), so the wizard now only fills a single
        // Model field from this instead of trying to match it against a separate Model/Variant
        // catalog.
        //
        // NOTE: this LEFT JOINs a "Cities" table for CustomerCity - the first attempt guessed its
        // columns as CityId/CityName (from your pasted repo's `_context.Cities`/`ct.CityId`/
        // `ct.CityName` EF property names) and that was wrong: this database's real Cities columns
        // are snake_case (city_id, city_name - confirmed via `SELECT TOP 3 * FROM Cities` you ran),
        // not PascalCase like the EF entity's property names suggested. Lesson carried forward: this
        // schema mixes naming conventions table-to-table (ChassisDetails/JobCardHeader are
        // PascalCase, LocationMaster's business columns are lowercase, Cities' are snake_case), so
        // pasted EF code's C# property spelling is a guide to which JOINs exist, never proof of the
        // real column names - only a `SELECT *` you actually ran confirms that. lg.City/lg.Id/
        // lg.LedgerName/lg.MobileNumber were NOT in the error this raised the first time (only
        // CityId/CityName were), which is why they're trusted here unchanged. -----
        const string chassisSql = @"
            SELECT TOP 1
                ch.ChassisNo, ch.RegNo, ch.ItemName, ch.DealerId, ch.LocationCode, ch.SaleDate, ch.LedgerId,
                lg.LedgerName, lg.MobileNumber,
                cty.city_name
            FROM [dbo].[ChassisDetails] ch
            LEFT JOIN [dbo].[LedgerMaster] lg ON ch.LedgerId = lg.Id
            LEFT JOIN [dbo].[Cities] cty ON lg.City = cty.city_id
            WHERE (ch.ChassisNo = @val OR ch.RegNo = @val)
              AND (@dealerCode IS NULL OR ch.DealerId = @dealerCode)
            ORDER BY ch.SaleDate DESC";

        string? chassisNo = null, regNo = null, modelName = null, customerName = null, customerMobile = null,
            customerCity = null, locationCode = null, foundDealerCode = null;
        int? customerLedgerId = null;
        DateOnly? saleDate = null;
        bool found = false;

        try
        {
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(chassisSql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@val", value);
            cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct))
            {
                found = true;
                chassisNo = rdr["ChassisNo"] as string ?? value;
                regNo = rdr["RegNo"] as string;
                modelName = rdr["ItemName"] as string;
                foundDealerCode = rdr["DealerId"] as string;
                locationCode = rdr["LocationCode"] as string;
                saleDate = ToDateOnly(rdr["SaleDate"]);
                customerLedgerId = rdr["LedgerId"] as int?;
                customerName = rdr["LedgerName"] as string;
                customerMobile = rdr["MobileNumber"] as string;
                customerCity = rdr["city_name"] as string;
            }
        }
        catch (Exception ex)
        {
            // Confirmed-schema query - a real failure here (network, credentials, or the schema
            // drifted since you ran that SELECT *) is surfaced as a thrown exception (the controller
            // maps this to a 502 with the message) instead of silently reporting "not found".
            _logger.LogWarning(ex, "BAPL DMS vehicle lookup (ChassisDetails) failed for {Value} (dealerCode={DealerCode})", value, dealerCode);
            throw new InvalidOperationException($"BAPL DMS vehicle lookup failed for '{value}': {ex.Message}", ex);
        }

        if (!found) return null;

        // ----- ENRICHMENT: this chassis's most recent past job card (if any), for Previous Km,
        // insurance/next-service dates, and battery/motor/controller/charger numbers - same
        // confirmed JobCardHeader/JobCardCustomer/JobCardBatteryDetail schema already used elsewhere
        // in this file. A brand-new vehicle with no service history yet simply won't have one of
        // these rows - that's normal, not an error, so this is best-effort and never throws. -----
        int? vehicleKms = null;
        string? motorNo = null, batteryNo = null, controllerNo = null, converterNo = null, chargerNo = null;
        DateOnly? insuranceExpDate = null, nextServiceDueDate = null;
        try
        {
            const string historySql = @"
                SELECT TOP 1
                    h.Vehiclekms, c.MotorNo, c.BatteryNo, c.InsuranceExpDate, c.NextserviceDueDate,
                    b.ControllerNo, b.ConverterNo, b.ChargerNo
                FROM [dbo].[JobCardHeader] h
                JOIN [dbo].[JobCardCustomer] c ON c.JobCardHeaderId = h.Id
                LEFT JOIN [dbo].[JobCardBatteryDetail] b ON b.JobCardHeaderId = h.Id
                WHERE ISNULL(h.IsDelete, 0) = 0
                  AND (h.Chassisno = @chassisNo OR c.ChassisNo = @chassisNo)
                ORDER BY h.JobinDate DESC, h.CreatedDate DESC";
            await using var cmd = new SqlCommand(historySql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@chassisNo", chassisNo!);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct))
            {
                vehicleKms = rdr["Vehiclekms"] as int?;
                motorNo = rdr["MotorNo"] as string;
                batteryNo = rdr["BatteryNo"] as string;
                insuranceExpDate = ToDateOnly(rdr["InsuranceExpDate"]);
                nextServiceDueDate = ToDateOnly(rdr["NextserviceDueDate"]);
                controllerNo = rdr["ControllerNo"] as string;
                converterNo = rdr["ConverterNo"] as string;
                chargerNo = rdr["ChargerNo"] as string;
            }
        }
        catch (Exception ex)
        {
            _logger.LogInformation(ex, "BAPL DMS job-card-history enrichment skipped for chassis {ChassisNo}", chassisNo);
        }

        return new BaplDmsVehicleRow(
            chassisNo!,
            regNo,
            modelName,
            customerName,
            customerMobile,
            batteryNo,
            motorNo,
            controllerNo,
            converterNo,
            chargerNo,
            saleDate,
            insuranceExpDate,
            nextServiceDueDate,
            vehicleKms,
            OdoReading: null, Duration: null, DurationType: null, ExpireWarrantyDate: null, // not wired up
            IsSold: saleDate.HasValue,
            CustomerCity: customerCity,
            CustomerLedgerId: customerLedgerId,
            LocationCode: locationCode,
            DealerCode: foundDealerCode);
    }

    public async Task<IReadOnlyList<BaplDmsJobCardHistoryRow>> GetServiceHistoryAsync(string chassisNo, string? dealerCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(chassisNo)) return Array.Empty<BaplDmsJobCardHistoryRow>();
        chassisNo = chassisNo.Trim();

        // STRING_AGG needs SQL Server 2017+/Azure SQL - BAPLDMSvad is an Azure SQL Database
        // (*.database.windows.net), which always supports it.
        const string sql = @"
            SELECT TOP 20
                h.Id AS JobCardHeaderId, h.JobNo, h.Jobprefix, h.JobinDate, h.JobStatus, h.InwardType,
                h.Vehiclekms, h.Supervisor, h.Technician, h.InvoiceNo,
                (SELECT STRING_AGG(cp.Complaint, '; ') FROM [dbo].[JobCardComplaint] cp WHERE cp.JobCardHeaderId = h.Id) AS Complaints
            FROM [dbo].[JobCardHeader] h
            JOIN [dbo].[JobCardCustomer] c ON c.JobCardHeaderId = h.Id
            WHERE ISNULL(h.IsDelete, 0) = 0
              AND (h.Chassisno = @chassisNo OR c.ChassisNo = @chassisNo)
              AND (@dealerCode IS NULL OR h.DealerCode = @dealerCode)
            ORDER BY h.JobinDate DESC, h.CreatedDate DESC";

        var results = new List<BaplDmsJobCardHistoryRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@chassisNo", chassisNo);
            cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsJobCardHistoryRow(
                    (int)rdr["JobCardHeaderId"],
                    rdr["JobNo"] as int?,
                    rdr["Jobprefix"] as string,
                    ToDateOnly(rdr["JobinDate"]),
                    rdr["JobStatus"] as string,
                    rdr["InwardType"] as string,
                    rdr["Vehiclekms"] as int?,
                    rdr["Supervisor"] as string,
                    rdr["Technician"] as string,
                    rdr["InvoiceNo"] as string,
                    rdr["Complaints"] as string));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's service history for chassis '{chassisNo}': {ex.Message}", ex);
        }

        return results;
    }

    public async Task<IReadOnlyList<BaplDmsJobCardListRow>> SearchJobCardsAsync(string? q, string? dealerCode, int take, CancellationToken ct = default)
    {
        if (take <= 0) take = 50;

        // JobStatus is NOT read off a stored column here - h.JobStatus turned out to be
        // unpopulated/unreliable in practice (every BAPL DMS row was coming through as "Unknown" on
        // the merged /jobcards list). BAPL DMS's own Job Card List screen instead computes status
        // live from RepairBillHeader/Ffirheader/IsMaterialTransfer - ported directly from your own
        // JobCardRepo.GetJobCardListViewAsync's JobStatus CASE expression (RepairBillHeader/
        // Ffirheader table names inferred from that same pasted code: their EF entity class names -
        // JobCardHeader, JobCardCustomer, etc. - have always matched the real table names exactly
        // everywhere else in this file, so RepairBillHeader/Ffirheader singular are used the same
        // way). Uses the same-priority order as that CASE: Billed > has a net amount > material
        // transfer > FFIR closed > FFIR created > Open.
        const string sql = @"
            SELECT TOP (@take)
                h.Id AS JobCardHeaderId, h.JobNo, h.Jobprefix, h.JobinDate, h.DealerCode,
                c.CustomerName, c.CustomerMobile, c.ModelName, c.ChassisNo, c.RegisterNo,
                h.Supervisor, h.Technician,
                CASE
                    WHEN rb.RepairbillStatus = 'Billed' THEN 'Closed'
                    WHEN rb.TotalNetAmount > 0 THEN 'Complete'
                    WHEN h.IsMaterialTransfer = 1 THEN 'Material Transfer'
                    WHEN fr.Ffirstatus = 'Closed' THEN 'FFIR Closed'
                    WHEN fr.Id IS NOT NULL THEN 'FFIR Created'
                    ELSE 'Open'
                END AS JobStatus
            FROM [dbo].[JobCardHeader] h
            JOIN [dbo].[JobCardCustomer] c ON c.JobCardHeaderId = h.Id
            OUTER APPLY (
                SELECT TOP 1 rb2.RepairbillStatus, rb2.TotalNetAmount
                FROM [dbo].[RepairBillHeader] rb2 WHERE rb2.JobId = h.Id ORDER BY rb2.Id DESC
            ) rb
            OUTER APPLY (
                SELECT TOP 1 fr2.Id, fr2.Ffirstatus
                FROM [dbo].[Ffirheader] fr2 WHERE fr2.JobCardHeaderId = h.Id ORDER BY fr2.Id DESC
            ) fr
            WHERE ISNULL(h.IsDelete, 0) = 0
              AND (@dealerCode IS NULL OR h.DealerCode = @dealerCode)
              AND (@qLike IS NULL
                   OR c.ChassisNo LIKE @qLike OR c.RegisterNo LIKE @qLike
                   OR c.CustomerName LIKE @qLike OR c.CustomerMobile LIKE @qLike
                   OR (h.Jobprefix + CAST(h.JobNo AS nvarchar(20))) LIKE @qLike)
            ORDER BY h.JobinDate DESC, h.CreatedDate DESC";

        var results = new List<BaplDmsJobCardListRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@take", take);
            cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@qLike", string.IsNullOrWhiteSpace(q) ? (object)DBNull.Value : $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsJobCardListRow(
                    (int)rdr["JobCardHeaderId"],
                    rdr["JobNo"] as int?,
                    rdr["Jobprefix"] as string,
                    ToDateOnly(rdr["JobinDate"]),
                    rdr["JobStatus"] as string,
                    rdr["DealerCode"] as string,
                    rdr["CustomerName"] as string,
                    rdr["CustomerMobile"] as string,
                    rdr["ModelName"] as string,
                    rdr["ChassisNo"] as string,
                    rdr["RegisterNo"] as string,
                    rdr["Supervisor"] as string,
                    rdr["Technician"] as string));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not search BAPL DMS's job cards: {ex.Message}", ex);
        }

        return results;
    }

    public async Task<BaplDmsJobCardDetailRow?> GetJobCardByIdAsync(int jobCardHeaderId, CancellationToken ct = default)
    {
        // JobStatus computed the same way as SearchJobCardsAsync above - see that method's comment
        // on why a stored h.JobStatus column isn't trustworthy here.
        const string sql = @"
            SELECT TOP 1
                h.Id AS JobCardHeaderId, h.JobNo, h.Jobprefix, h.JobinDate, h.InwardType,
                h.Vehiclekms, h.Supervisor, h.Technician, h.InvoiceNo, h.DealerCode,
                c.CustomerName, c.CustomerMobile, c.CustomerAltMobile, c.ModelName, c.ChassisNo, c.RegisterNo,
                c.MotorNo, c.BatteryNo, c.SaleDate, c.InsuranceExpDate, c.NextserviceDueDate, c.RSARenewalDate, c.Remarks,
                b.ControllerNo, b.ConverterNo, b.ChargerNo,
                (SELECT STRING_AGG(cp.Complaint, '; ') FROM [dbo].[JobCardComplaint] cp WHERE cp.JobCardHeaderId = h.Id) AS Complaints,
                CASE
                    WHEN rb.RepairbillStatus = 'Billed' THEN 'Closed'
                    WHEN rb.TotalNetAmount > 0 THEN 'Complete'
                    WHEN h.IsMaterialTransfer = 1 THEN 'Material Transfer'
                    WHEN fr.Ffirstatus = 'Closed' THEN 'FFIR Closed'
                    WHEN fr.Id IS NOT NULL THEN 'FFIR Created'
                    ELSE 'Open'
                END AS JobStatus
            FROM [dbo].[JobCardHeader] h
            JOIN [dbo].[JobCardCustomer] c ON c.JobCardHeaderId = h.Id
            LEFT JOIN [dbo].[JobCardBatteryDetail] b ON b.JobCardHeaderId = h.Id
            OUTER APPLY (
                SELECT TOP 1 rb2.RepairbillStatus, rb2.TotalNetAmount
                FROM [dbo].[RepairBillHeader] rb2 WHERE rb2.JobId = h.Id ORDER BY rb2.Id DESC
            ) rb
            OUTER APPLY (
                SELECT TOP 1 fr2.Id, fr2.Ffirstatus
                FROM [dbo].[Ffirheader] fr2 WHERE fr2.JobCardHeaderId = h.Id ORDER BY fr2.Id DESC
            ) fr
            WHERE h.Id = @id AND ISNULL(h.IsDelete, 0) = 0";

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@id", jobCardHeaderId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (!await rdr.ReadAsync(ct)) return null;

            return new BaplDmsJobCardDetailRow(
                (int)rdr["JobCardHeaderId"],
                rdr["JobNo"] as int?,
                rdr["Jobprefix"] as string,
                ToDateOnly(rdr["JobinDate"]),
                rdr["JobStatus"] as string,
                rdr["InwardType"] as string,
                rdr["Vehiclekms"] as int?,
                rdr["Supervisor"] as string,
                rdr["Technician"] as string,
                rdr["InvoiceNo"] as string,
                rdr["DealerCode"] as string,
                rdr["CustomerName"] as string,
                rdr["CustomerMobile"] as string,
                rdr["CustomerAltMobile"] as string,
                rdr["ModelName"] as string,
                rdr["ChassisNo"] as string,
                rdr["RegisterNo"] as string,
                rdr["MotorNo"] as string,
                rdr["BatteryNo"] as string,
                ToDateOnly(rdr["SaleDate"]),
                ToDateOnly(rdr["InsuranceExpDate"]),
                ToDateOnly(rdr["NextserviceDueDate"]),
                ToDateOnly(rdr["RSARenewalDate"]),
                rdr["Remarks"] as string,
                rdr["ControllerNo"] as string,
                rdr["ConverterNo"] as string,
                rdr["ChargerNo"] as string,
                rdr["Complaints"] as string);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS job card {jobCardHeaderId}: {ex.Message}", ex);
        }
    }

    // Matches a Loccode ending in "W" followed by one or more digits (e.g. "CUS0435W1") - BAPL
    // DMS's own convention for the workshop location in a dealer's S/W/G location series (Showroom/
    // Workshop/Godown), confirmed against the sample rows you pasted from LocationMaster.
    private static readonly Regex WorkshopLocCodeRegex = new(@"W\d+$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public async Task<IReadOnlyList<BaplDmsWorkshopRow>> GetWorkshopsAsync(string? dealerCode, string? q, CancellationToken ct = default)
    {
        // LocationMaster is a small master table (one row per dealer per S/W/G location), so it's
        // simplest and safest to filter the W-series in C# with a regex rather than trying to
        // express "ends in a letter then any number of digits" in a portable SQL LIKE pattern.
        const string sql = @"
            SELECT loccode, locname, ISNULL(city, '') AS city, ISNULL(state, '') AS state, dealercode
            FROM [dbo].[LocationMaster]
            WHERE active = 'Y'
              AND (@dealerCode IS NULL OR dealercode = @dealerCode)
              AND (@qLike IS NULL OR locname LIKE @qLike OR loccode LIKE @qLike)
            ORDER BY locname";

        var results = new List<BaplDmsWorkshopRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@qLike", string.IsNullOrWhiteSpace(q) ? (object)DBNull.Value : $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var loccode = rdr["loccode"] as string ?? "";
                if (!WorkshopLocCodeRegex.IsMatch(loccode)) continue;
                results.Add(new BaplDmsWorkshopRow(
                    loccode,
                    rdr["locname"] as string ?? loccode,
                    rdr["city"] as string ?? "",
                    rdr["state"] as string ?? "",
                    rdr["dealercode"] as string ?? ""));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's workshop locations (LocationMaster): {ex.Message}", ex);
        }

        return results;
    }

    public async Task<IReadOnlyList<BaplDmsJobTypeRow>> GetJobTypesAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT id, JobTypeName FROM [dbo].[JobType] ORDER BY JobTypeName";
        var results = new List<BaplDmsJobTypeRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsJobTypeRow((int)rdr["id"], rdr["JobTypeName"] as string ?? ""));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's job types (JobType): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsServiceHeadRow>> GetServiceHeadsAsync(int jobTypeId, CancellationToken ct = default)
    {
        const string sql = "SELECT id, JobTypeId, ServiceHeadName FROM [dbo].[ServiceHead] WHERE JobTypeId = @jobTypeId ORDER BY ServiceHeadName";
        var results = new List<BaplDmsServiceHeadRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@jobTypeId", jobTypeId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsServiceHeadRow((int)rdr["id"], (int)rdr["JobTypeId"], rdr["ServiceHeadName"] as string ?? ""));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's service heads (ServiceHead): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsServiceTypeRow>> GetServiceTypesAsync(int serviceHeadId, CancellationToken ct = default)
    {
        const string sql = "SELECT id, ServiceHeadId, ServiceTypeName FROM [dbo].[ServiceType] WHERE ServiceHeadId = @serviceHeadId ORDER BY ServiceTypeName";
        var results = new List<BaplDmsServiceTypeRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@serviceHeadId", serviceHeadId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsServiceTypeRow((int)rdr["id"], (int)rdr["ServiceHeadId"], rdr["ServiceTypeName"] as string ?? ""));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's service types (ServiceType): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsComplaintRow>> GetComplaintsAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT Id, ComplaintName, GroupName FROM [dbo].[ComplaintMaster] WHERE Status = 1 ORDER BY ComplaintName";
        var results = new List<BaplDmsComplaintRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsComplaintRow((int)rdr["Id"], rdr["ComplaintName"] as string ?? "", rdr["GroupName"] as int?));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's complaint master (ComplaintMaster): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsJobSourceRow>> GetJobSourcesAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT id, JobSourceName FROM [dbo].[JobSource] ORDER BY id";
        var results = new List<BaplDmsJobSourceRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsJobSourceRow((int)rdr["id"], rdr["JobSourceName"] as string ?? ""));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's job sources (JobSource): {ex.Message}", ex);
        }
        return results;
    }

    /// <summary>
    /// Writes one new job card into BAPL DMS's own JobCardHeader/JobCardCustomer/
    /// JobCardBatteryDetail/JobCardComplaint tables, mirroring your own JobCardRepo.
    /// InsertJobCardinfoDetails as closely as an ADO.NET insert can (this project reads BAPLDMSvad
    /// with plain SqlClient rather than a second EF DbContext - see this class's header comment for
    /// why - so this is a hand-written parameterized-SQL equivalent of that EF code, not a literal
    /// port). Three things could NOT be copied exactly from your pasted code and are best-effort
    /// guesses instead, called out here so a first failed attempt is easy to diagnose:
    ///   - JobNo: your GetNextJobNumber(dealerCode) logic (MAX(JobNo) WHERE DealerCode = ... + 1) IS
    ///     copied exactly, but if two job cards are created for the same dealer at the same moment
    ///     from different places, there's a small race window your real backend likely closes with
    ///     a lock/sequence/unique constraint this insert doesn't take out.
    ///   - Jobprefix: your code only ever strips a numeric suffix off whatever prefix is passed in
    ///     (NormalizeJobPrefix) - it's never generated from scratch anywhere in what you pasted, so
    ///     this insert sends an empty string. If BAPL DMS's UI always shows a specific prefix (a
    ///     dealer code, a location code, ...), tell me the rule and I'll generate it here too.
    ///   - CreatedBy: your schema stores this as a string that looks like a BAPL DMS user's GUID
    ///     (e.g. "973620f2-a192-41c6-af0d-2d515e5ad5e9") - JobCardScanner has no such BAPL DMS user
    ///     id, so this sends a JobCardScanner staff id instead, prefixed so it's identifiable in
    ///     BAPL DMS's own audit trail. If CreatedBy has a foreign key or format constraint that
    ///     rejects that, this insert will throw and the exact SQL error will say so.
    /// Columns your ViewModel carries that the Job Card Wizard has no equivalent input for yet
    /// (AirpressureRearTyre/AirpressurefrontTyre, Observation, SupervisorComment, IsPdiSuccess,
    /// Couponno, InvoiceNo, EstNo/Jobestmate) are left at their column defaults/NULL rather than
    /// guessed.
    /// </summary>
    public async Task<BaplDmsCreateJobCardResult> CreateJobCardAsync(BaplDmsCreateJobCardRequest req, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync(ct);
        var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        try
        {
            int jobNo;
            await using (var cmd = new SqlCommand(
                "SELECT ISNULL(MAX(JobNo), 0) + 1 FROM [dbo].[JobCardHeader] WHERE DealerCode = @dealerCode", conn, tx))
            {
                cmd.Parameters.AddWithValue("@dealerCode", req.DealerCode);
                jobNo = (int)(await cmd.ExecuteScalarAsync(ct))!;
            }

            var now = DateTime.Now;
            var jobInDate = DateOnly.FromDateTime(now);
            var estDelDate = req.ExpectedDeliveryAt.HasValue ? DateOnly.FromDateTime(req.ExpectedDeliveryAt.Value) : jobInDate;
            var estDelTime = req.ExpectedDeliveryAt?.TimeOfDay ?? now.TimeOfDay;

            int headerId;
            const string insertHeaderSql = @"
                INSERT INTO [dbo].[JobCardHeader]
                    (Jobtype, DealerCode, Chassisno, Vehiclekms, Servicehead, Servicetype, Serviceloc,
                     InwardType, Jobprefix, JobinDate, JobinTime, JobNo, ManualjobNo, EstdelDate, EstdelTime,
                     JobSource, Supervisor, Technician, IsDelete, CreatedBy, CreatedDate)
                VALUES
                    (@jobType, @dealerCode, @chassisNo, @vehicleKms, @serviceHead, @serviceType, @serviceLoc,
                     @inwardType, @jobPrefix, @jobinDate, @jobinTime, @jobNo, @manualJobNo, @estDelDate, @estDelTime,
                     @jobSource, @supervisor, @technician, 0, @createdBy, @createdDate);
                SELECT CAST(SCOPE_IDENTITY() AS int);";
            await using (var cmd = new SqlCommand(insertHeaderSql, conn, tx))
            {
                cmd.Parameters.AddWithValue("@jobType", req.JobTypeId);
                cmd.Parameters.AddWithValue("@dealerCode", req.DealerCode);
                cmd.Parameters.AddWithValue("@chassisNo", req.ChassisNo);
                cmd.Parameters.AddWithValue("@vehicleKms", req.VehicleKms);
                cmd.Parameters.AddWithValue("@serviceHead", req.ServiceHeadId);
                cmd.Parameters.AddWithValue("@serviceType", req.ServiceTypeId);
                cmd.Parameters.AddWithValue("@serviceLoc", (object?)req.ServiceLocationCode ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@inwardType", "Service");
                cmd.Parameters.AddWithValue("@jobPrefix", "");
                cmd.Parameters.AddWithValue("@jobinDate", jobInDate.ToDateTime(TimeOnly.MinValue));
                cmd.Parameters.AddWithValue("@jobinTime", now.TimeOfDay);
                cmd.Parameters.AddWithValue("@jobNo", jobNo);
                cmd.Parameters.AddWithValue("@manualJobNo", (object?)req.ManualJobNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@estDelDate", estDelDate.ToDateTime(TimeOnly.MinValue));
                cmd.Parameters.AddWithValue("@estDelTime", estDelTime);
                cmd.Parameters.AddWithValue("@jobSource", req.JobSourceId ?? 1);
                cmd.Parameters.AddWithValue("@supervisor", (object?)req.Supervisor ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@technician", (object?)req.Technician ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@createdBy", req.CreatedBy);
                cmd.Parameters.AddWithValue("@createdDate", now);
                headerId = (int)(await cmd.ExecuteScalarAsync(ct))!;
            }

            const string insertCustomerSql = @"
                INSERT INTO [dbo].[JobCardCustomer]
                    (JobCardHeaderId, CustomerLedgerId, CustomerName, CustomerMobile, ModelName, ChassisNo,
                     RegisterNo, MotorNo, BatteryNo, SaleDate, InsuranceExpDate, NextserviceDueDate, CreatedBy, CreatedDate)
                VALUES
                    (@headerId, @customerLedgerId, @customerName, @customerMobile, @modelName, @chassisNo,
                     @registerNo, @motorNo, @batteryNo, @saleDate, @insuranceExpDate, @nextServiceDueDate, @createdBy, @createdDate)";
            await using (var cmd = new SqlCommand(insertCustomerSql, conn, tx))
            {
                cmd.Parameters.AddWithValue("@headerId", headerId);
                cmd.Parameters.AddWithValue("@customerLedgerId", (object?)req.CustomerLedgerId ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@customerName", (object?)req.CustomerName ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@customerMobile", (object?)req.CustomerMobile ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@modelName", (object?)req.ModelName ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@chassisNo", req.ChassisNo);
                cmd.Parameters.AddWithValue("@registerNo", (object?)req.RegisterNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@motorNo", (object?)req.MotorNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@batteryNo", (object?)req.BatteryNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@saleDate", req.SaleDate.HasValue ? req.SaleDate.Value.ToDateTime(TimeOnly.MinValue) : (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@insuranceExpDate", req.InsuranceExpDate.HasValue ? req.InsuranceExpDate.Value.ToDateTime(TimeOnly.MinValue) : (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@nextServiceDueDate", req.NextServiceDueDate.HasValue ? req.NextServiceDueDate.Value.ToDateTime(TimeOnly.MinValue) : (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@createdBy", req.CreatedBy);
                cmd.Parameters.AddWithValue("@createdDate", now);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            if (!string.IsNullOrWhiteSpace(req.ControllerNo) || !string.IsNullOrWhiteSpace(req.ConverterNo) || !string.IsNullOrWhiteSpace(req.ChargerNo))
            {
                const string insertBatterySql = @"
                    INSERT INTO [dbo].[JobCardBatteryDetail]
                        (JobCardHeaderId, DealerCode, ControllerNo, ConverterNo, ChargerNo, CreatedBy, CreatedDate)
                    VALUES
                        (@headerId, @dealerCode, @controllerNo, @converterNo, @chargerNo, @createdBy, @createdDate)";
                await using var cmd = new SqlCommand(insertBatterySql, conn, tx);
                cmd.Parameters.AddWithValue("@headerId", headerId);
                cmd.Parameters.AddWithValue("@dealerCode", req.DealerCode);
                cmd.Parameters.AddWithValue("@controllerNo", (object?)req.ControllerNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@converterNo", (object?)req.ConverterNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@chargerNo", (object?)req.ChargerNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@createdBy", req.CreatedBy);
                cmd.Parameters.AddWithValue("@createdDate", now);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            foreach (var complaint in req.Complaints.Where(c => !string.IsNullOrWhiteSpace(c)))
            {
                const string insertComplaintSql = @"
                    INSERT INTO [dbo].[JobCardComplaint] (DealerCode, JobCardHeaderId, Complaint, CreatedBy, CreatedDate)
                    VALUES (@dealerCode, @headerId, @complaint, @createdBy, @createdDate)";
                await using var cmd = new SqlCommand(insertComplaintSql, conn, tx);
                cmd.Parameters.AddWithValue("@dealerCode", req.DealerCode);
                cmd.Parameters.AddWithValue("@headerId", headerId);
                cmd.Parameters.AddWithValue("@complaint", complaint);
                cmd.Parameters.AddWithValue("@createdBy", req.CreatedBy);
                cmd.Parameters.AddWithValue("@createdDate", now);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            await tx.CommitAsync(ct);
            return new BaplDmsCreateJobCardResult(headerId, jobNo);
        }
        catch (Exception ex)
        {
            try { await tx.RollbackAsync(ct); } catch { /* connection may already be unusable */ }
            _logger.LogWarning(ex, "Could not create BAPL DMS job card for chassis {ChassisNo}/dealer {DealerCode}", req.ChassisNo, req.DealerCode);
            throw new InvalidOperationException($"Could not create the job card in BAPL DMS: {ex.Message}", ex);
        }
    }

    private static DateOnly? ToDateOnly(object? value) =>
        value is DateTime dt ? DateOnly.FromDateTime(dt) : null;
}
