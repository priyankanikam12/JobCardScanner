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
    bool IsSold);

public interface IBaplDmsService
{
    /// <summary>Live search of BAPL DMS's active dealers by name/code (min 2 chars), for the Job
    /// Card Wizard's "search Dealer / Workshop" picker. Throws <see cref="InvalidOperationException"/>
    /// if BAPLDMSvadConnection isn't configured or the query fails.</summary>
    Task<IReadOnlyList<BaplDmsDealerRow>> SearchDealersAsync(string q, CancellationToken ct = default);

    /// <summary>
    /// Looks up one vehicle by chassis number or registration number, mirroring BAPL DMS's own
    /// "PDI" (not yet sold - v.SaleDate IS NULL) vs "Sale/Service" (already sold) branches. When
    /// <paramref name="dealerCode"/> is given, results are scoped to that dealer (matching BAPL
    /// DMS's own per-dealer inspected-lot view); when it's null, every dealer is searched, which is
    /// safe here because the caller is always searching by an already-specific chassis/reg no, not
    /// browsing a whole inventory.
    /// Returns null (never throws) on "not found" OR on any connection/query failure, since this is
    /// a best-effort auto-fill inside the Job Card Wizard - a BAPL DMS hiccup should never block
    /// staff from creating a vehicle/job card by hand instead.
    /// </summary>
    Task<BaplDmsVehicleRow?> LookupVehicleAsync(string chassisOrRegNo, string? dealerCode, CancellationToken ct = default);
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

    public async Task<BaplDmsVehicleRow?> LookupVehicleAsync(string chassisOrRegNo, string? dealerCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(chassisOrRegNo)) return null;
        var value = chassisOrRegNo.Trim();

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            // ----- Branch 1: already sold (BAPL DMS's "Sale / Service" branch - v.SaleDate IS NOT
            // NULL). This is the common case for a job card: an existing customer's vehicle coming
            // in for service. Ported from JobCardRepo.GetAllInspectedLotChassisAsync's `else` arm. -----
            const string soldSql = @"
                SELECT TOP 1
                    d.ChassisNo, v.RegNo, i.Itemname AS ModelName,
                    custLg.LedgerName AS CustomerName, custLg.MobileNumber AS CustomerMobile,
                    v.SaleDate, vsd.InsExpDate,
                    vc.BatteryNo, vc.MotorNo, vc.ControllerNo, vc.ConverterNo, vc.ChargerNo,
                    o.Id AS OemModelId
                FROM [dbo].[LotinspectionHeader] h
                JOIN [dbo].[LotinspectionDetail] d ON h.Id = d.LotHeaderId
                JOIN [dbo].[ChassisDetail] v ON d.ChassisNo = v.ChassisNo
                JOIN [dbo].[ItemMaster] i ON v.ItemCode = i.Itemcode
                JOIN [dbo].[VehicleSaleBillDetail] vsd ON d.ChassisNo = vsd.ChassisNo
                JOIN [dbo].[LedgerMaster] custLg ON v.LedgerId = custLg.Id
                LEFT JOIN [dbo].[OemmodelMaster] o
                    ON LTRIM(RTRIM(LOWER(i.Oemmodelname))) = LTRIM(RTRIM(LOWER(o.ModelName)))
                OUTER APPLY (
                    SELECT TOP 1 x.BatteryNo, x.MotorNo, x.ControllerNo, x.ConverterNo, x.ChargerNo
                    FROM [dbo].[ChassisBatteryDetail] x
                    WHERE x.ChassisNo = v.ChassisNo
                    ORDER BY x.CreatedDate DESC
                ) vc
                WHERE h.IsLotInspected = 1
                  AND v.SaleDate IS NOT NULL
                  AND (v.ChassisNo = @val OR v.RegNo = @val)
                  AND (@dealerCode IS NULL OR v.DealerId = @dealerCode)
                ORDER BY v.SaleDate DESC";

            await using (var cmd = new SqlCommand(soldSql, conn) { CommandTimeout = 30 })
            {
                cmd.Parameters.AddWithValue("@val", value);
                cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    var chassisNo = rdr["ChassisNo"] as string ?? value;
                    var saleDate = ToDateOnly(rdr["SaleDate"]);
                    var oemModelId = rdr["OemModelId"] as int?;

                    // Previous KMs = this chassis's most recent JobCardHeader.Vehiclekms in BAPL
                    // DMS itself. FIXED (not carried over): BAPL's own code originally wrote this
                    // filter as `j.Chassisno == v.ChassisNo && j.IsDelete != true || j.IsDelete ==
                    // null` - because && binds tighter than ||, that matched ANY undeleted row
                    // system-wide, not just this chassis, leaking one vehicle's previous KM onto
                    // another's job card. BAPL's own team already fixed this in the code pasted into
                    // this project's chat; this query is written the corrected way from the start.
                    int? prevKms = null;
                    await using (var kmCmd = new SqlCommand(
                        "SELECT TOP 1 Vehiclekms FROM [dbo].[JobCardHeader] WHERE Chassisno = @c AND ISNULL(IsDelete, 0) = 0 ORDER BY CreatedDate DESC",
                        conn) { CommandTimeout = 30 })
                    {
                        kmCmd.Parameters.AddWithValue("@c", chassisNo);
                        var result = await kmCmd.ExecuteScalarAsync(ct);
                        if (result is int i) prevKms = i;
                    }

                    DateOnly? nextServiceDue = null;
                    decimal? odoReading = null, duration = null;
                    string? durationType = null;
                    DateOnly? expireWarranty = null;

                    if (oemModelId.HasValue)
                    {
                        if (saleDate.HasValue)
                        {
                            int completedServiceCount;
                            await using (var countCmd = new SqlCommand(@"
                                SELECT COUNT(*) FROM [dbo].[JobCardHeader] jh
                                JOIN [dbo].[JobCardCustomer] jc ON jh.Id = jc.JobCardHeaderId
                                WHERE jc.ChassisNo = @c AND jh.Jobtype != 1", conn) { CommandTimeout = 30 })
                            {
                                countCmd.Parameters.AddWithValue("@c", chassisNo);
                                completedServiceCount = (int)(await countCmd.ExecuteScalarAsync(ct) ?? 0);
                            }

                            await using var scheduleCmd = new SqlCommand(@"
                                SELECT DaysFrom FROM [dbo].[ModelwiseServiceSchedule]
                                WHERE OemmodelId = @m ORDER BY Seqno
                                OFFSET @skip ROWS FETCH NEXT 1 ROWS ONLY", conn) { CommandTimeout = 30 };
                            scheduleCmd.Parameters.AddWithValue("@m", oemModelId.Value);
                            scheduleCmd.Parameters.AddWithValue("@skip", completedServiceCount);
                            var daysFrom = await scheduleCmd.ExecuteScalarAsync(ct);
                            if (daysFrom is int df) nextServiceDue = saleDate.Value.AddDays(df);
                        }

                        await using var warrantyCmd = new SqlCommand(@"
                            SELECT TOP 1 Odoreading, Duration, DurationType, EffectiveDate
                            FROM [dbo].[OemmodelWarranty] WHERE OemmodelId = @m
                            ORDER BY EffectiveDate DESC", conn) { CommandTimeout = 30 };
                        warrantyCmd.Parameters.AddWithValue("@m", oemModelId.Value);
                        await using var wRdr = await warrantyCmd.ExecuteReaderAsync(ct);
                        if (await wRdr.ReadAsync(ct))
                        {
                            odoReading = wRdr["Odoreading"] as decimal?;
                            duration = wRdr["Duration"] as decimal?;
                            durationType = wRdr["DurationType"] as string;
                            var effectiveDate = ToDateOnly(wRdr["EffectiveDate"]);
                            if (effectiveDate.HasValue && duration.HasValue)
                            {
                                expireWarranty = durationType == "MONTH" ? effectiveDate.Value.AddMonths((int)duration.Value)
                                    : durationType == "YEAR" ? effectiveDate.Value.AddYears((int)duration.Value)
                                    : effectiveDate;
                            }
                        }
                    }

                    return new BaplDmsVehicleRow(
                        chassisNo,
                        rdr["RegNo"] as string,
                        rdr["ModelName"] as string,
                        rdr["CustomerName"] as string,
                        rdr["CustomerMobile"] as string,
                        rdr["BatteryNo"] as string,
                        rdr["MotorNo"] as string,
                        rdr["ControllerNo"] as string,
                        rdr["ConverterNo"] as string,
                        rdr["ChargerNo"] as string,
                        saleDate,
                        ToDateOnly(rdr["InsExpDate"]),
                        nextServiceDue,
                        prevKms,
                        odoReading,
                        duration,
                        durationType,
                        expireWarranty,
                        IsSold: true);
                }
            }

            // ----- Branch 2: not yet sold (BAPL DMS's "PDI" branch - v.SaleDate IS NULL). A new
            // vehicle already inspected/at the dealer but not yet registered to a customer. Ported
            // from the same method's `if (jobTypeId == 1)` arm. -----
            const string pdiSql = @"
                SELECT TOP 1
                    v.ChassisNo, v.RegNo, i.Itemname AS ModelName,
                    dealerLg.LedgerName AS CustomerName, dealerLg.MobileNumber AS CustomerMobile,
                    vc.BatteryNo, vc.MotorNo, vc.ControllerNo, vc.ConverterNo, vc.ChargerNo
                FROM [dbo].[LotinspectionHeader] h
                JOIN [dbo].[LotinspectionDetail] d ON h.Id = d.LotHeaderId
                JOIN [dbo].[ChassisDetail] v ON d.ChassisNo = v.ChassisNo
                JOIN [dbo].[LedgerMaster] dealerLg ON v.DealerId = dealerLg.DealerCode AND dealerLg.LedgerType = 'Dealer'
                JOIN [dbo].[ItemMaster] i ON v.ItemCode = i.Itemcode
                OUTER APPLY (
                    SELECT TOP 1 x.BatteryNo, x.MotorNo, x.ControllerNo, x.ConverterNo, x.ChargerNo
                    FROM [dbo].[ChassisBatteryDetail] x
                    WHERE x.ChassisNo = v.ChassisNo
                    ORDER BY x.CreatedDate DESC
                ) vc
                WHERE h.IsLotInspected = 1
                  AND v.SaleDate IS NULL
                  AND (v.ChassisNo = @val OR v.RegNo = @val)
                  AND (@dealerCode IS NULL OR v.DealerId = @dealerCode)";

            await using (var cmd = new SqlCommand(pdiSql, conn) { CommandTimeout = 30 })
            {
                cmd.Parameters.AddWithValue("@val", value);
                cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    return new BaplDmsVehicleRow(
                        rdr["ChassisNo"] as string ?? value,
                        rdr["RegNo"] as string,
                        rdr["ModelName"] as string,
                        rdr["CustomerName"] as string,
                        rdr["CustomerMobile"] as string,
                        rdr["BatteryNo"] as string,
                        rdr["MotorNo"] as string,
                        rdr["ControllerNo"] as string,
                        rdr["ConverterNo"] as string,
                        rdr["ChargerNo"] as string,
                        SaleDate: null,
                        InsuranceExpDate: null,
                        NextServiceDueDate: null,
                        VehiclePrevKms: null,
                        OdoReading: null,
                        Duration: null,
                        DurationType: null,
                        ExpireWarrantyDate: null,
                        IsSold: false);
                }
            }
        }
        catch (Exception ex)
        {
            // Best-effort by design (see interface doc comment) - log and return "not found" rather
            // than surfacing a 502 that would block the wizard's manual entry path.
            _logger.LogWarning(ex, "BAPL DMS vehicle lookup failed for {Value} (dealerCode={DealerCode})", value, dealerCode);
            return null;
        }

        return null;
    }

    private static DateOnly? ToDateOnly(object? value) =>
        value is DateTime dt ? DateOnly.FromDateTime(dt) : null;
}
