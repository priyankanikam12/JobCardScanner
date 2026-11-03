using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Shared engine for the GET-only partner data APIs that expose Job Cards, Repair Bills and Material Transfers of a named group of Magnemite dealers behind an X-API-Key
/// (2026-10-08, "for this using apikey make api for both customer ... Shadowfax all magnamite, ANVWeb (Ride EV) only MAGNEMITE MOTO LLP-Delhi, Chennai, Dombivli ... like zoho").
/// The two concrete controllers - ShadowfaxDataController and AnvWebDataController - only say WHICH config key holds their API key and WHICH dealers they may see; every
/// query, filter, paging rule and response shape lives here, once, so the two customers can never drift apart. The response shapes are IDENTICAL to ZohoIntegrationController's
/// (full line-item / discount / tax / total detail for bills and transfers, status view for job cards), with two additions that suit a bulk consumer:
///   * pageIndex (0-based) + pageSize on all three list endpoints, and an X-Total-Count response header, so the whole history can be pulled page by page
///     (Zoho's endpoints stop at the first 500 / 1000 rows). With no paging parameters the first page is returned exactly like Zoho's capped list.
///   * the API key is compared in constant time.
/// Scoping is TWO rules, both must hold (2026-10-08, "for Shadowfax only Shadowfax and ANVWeb only ANV data, like Zomato"): (1) the document belongs to one of the partner's dealers (IsDealerInScope), and
/// (2) the document is the partner's OWN - its customer / party name contains CustomerNameKeyword (case-insensitive). So Shadowfax never sees ANV's records or any other customer's, and vice versa.
/// A job card matches on its customer's name; a Repair Bill or Material Transfer matches on its party name OR the customer of the job card it is linked to.
/// 2026-11-01 (Shadowfax e-mail, "Reading only what has changed" / "Cancelled and deleted records"): all three list endpoints take an optional updatedSince (ISO 8601, for example 2026-11-01T06:30:00Z) and then return everything
/// created or changed since that moment - and a deleted repair bill is returned too, with status "Deleted" and isDeleted true (without updatedSince deleted bills stay hidden, as before). Job cards also carry updatedAt,
/// estimateVersion (see ShadowfaxEstimatesDecisionsController) and chassisMissing. Job cards read with updatedSince come oldest change first, so the last updatedAt received can be used as the next updatedSince.
/// 2026-11-02 (ANV Web / Ride EV e-mail, "we look vehicles up individually" / "Material transfers carry no regNo / chassisNo"): the three list endpoints also take registrationNumber and chassisNo (compared ignoring case, spaces and
/// hyphens, so "dl 1c ab-1234" finds "DL1CAB1234"), and a material transfer now carries regNo and chassisNo of the vehicle of its job card (null when the transfer has no job card).
/// Not included, same as Zoho and for the same reasons: QC items, work logs, photos, raw part / labour suggestions (pre-billing, internal), and the DMSBAPLDATA-synced bill feed.
/// </summary>
public abstract class MagnemitePartnerDataControllerBase : ControllerBase
{
    private const int MaxPageSize = 1000;

    protected readonly JobCardScannerDbContext Db;
    private readonly IConfiguration _config;
    private readonly ILogger _logger;

    protected MagnemitePartnerDataControllerBase(JobCardScannerDbContext db, IConfiguration config, ILogger logger)
    {
        Db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>Configuration key holding this partner's API key, e.g. "ApiKeys:Shadowfax" (the shared ApiKeys section of appsettings / the environment).</summary>
    protected abstract string ApiKeyConfigName { get; }

    /// <summary>Name used only in log lines.</summary>
    protected abstract string PartnerName { get; }

    /// <summary>The partner's own customer name, as a keyword: only records whose customer / party name CONTAINS this (any case) are returned, e.g. "SHADOWFAX" or "ANV WEB". Upper-case.</summary>
    protected abstract string CustomerNameKeyword { get; }

    /// <summary>true when this dealer (already known to contain "MAGNEMITE" in its name, any case) belongs to this partner's scope. dealerName is the Dealer.Name as stored.</summary>
    protected abstract bool IsDealerInScope(string dealerName, string? baplDealerCode);

    // ------------------------------------------------------------------ plumbing

    private IActionResult? CheckApiKey()
    {
        var configuredKey = _config[ApiKeyConfigName];
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            _logger.LogWarning("{Partner} data API called but {Key} is not configured - refusing every request until it is set.", PartnerName, ApiKeyConfigName);
            return StatusCode(503, new { message = "This integration is not yet configured." });
        }
        if (!Request.Headers.TryGetValue("X-API-Key", out var provided) || !SameKey(provided.ToString(), configuredKey))
            return Unauthorized(new { message = "Missing or invalid X-API-Key." });
        return null;
    }

    /// <summary>Constant-time comparison, so response timing never reveals how much of a guessed key was right.</summary>
    private static bool SameKey(string provided, string configured)
    {
        var a = Encoding.UTF8.GetBytes(provided);
        var b = Encoding.UTF8.GetBytes(configured);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    /// <summary>The ONE place the partner's dealer scope is resolved. Dealers are read whole (there are only a few dozen) and matched in memory with OrdinalIgnoreCase, so the
    /// result does not depend on the database collation.</summary>
    private async Task<List<(Guid Id, string Name, string? BaplDmsDealerCode)>> ResolveAllowedDealersAsync()
    {
        var dealers = await Db.Dealers.AsNoTracking()
            .Select(d => new { d.Id, d.Name, d.BaplDmsDealerCode })
            .ToListAsync();

        return dealers
            .Where(d => d.Name != null
                && d.Name.Contains("MAGNEMITE", StringComparison.OrdinalIgnoreCase)
                && IsDealerInScope(d.Name, d.BaplDmsDealerCode))
            .Select(d => (d.Id, d.Name!, d.BaplDmsDealerCode))
            .ToList();
    }

    /// <summary>Applies the optional dealerCode filter (one location's BAPL dealer code, case-insensitive). Returns the ids to query, possibly empty.</summary>
    private static List<Guid> NarrowIds(List<(Guid Id, string Name, string? BaplDmsDealerCode)> allowed, string? dealerCode) =>
        (string.IsNullOrWhiteSpace(dealerCode)
            ? allowed
            : allowed.Where(d => string.Equals(d.BaplDmsDealerCode, dealerCode.Trim(), StringComparison.OrdinalIgnoreCase)).ToList())
        .Select(d => d.Id).ToList();

    private static (int skip, int take) PageWindow(int pageIndex, int pageSize, int defaultSize)
    {
        var size = pageSize <= 0 ? defaultSize : Math.Min(pageSize, MaxPageSize);
        var index = Math.Max(0, pageIndex);
        return (index * size, size);
    }

    // ------------------------------------------------------------------ endpoints

    /// <summary>GET dealers - which dealers this API key resolves to (name + BAPL dealer code only, nothing financial). Use it to confirm the scope before pulling bulk data.</summary>
    [HttpGet("dealers")]
    public async Task<IActionResult> Dealers()
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        return Ok(allowed
            .OrderBy(d => d.Name)
            .Select(d => new { d.Id, d.Name, BaplDealerCode = d.BaplDmsDealerCode }));
    }

    /// <summary>GET jobcards?from=&amp;to=&amp;status=&amp;dealerCode=&amp;jobCardNumber=&amp;pageIndex=&amp;pageSize= - job card status / descriptive view (no pricing: real amounts are on the Repair Bills).
    /// from / to filter the job created date. Newest first; default page size 500, maximum 1000.</summary>
    [HttpGet("jobcards")]
    public async Task<IActionResult> JobCards(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] JobCardStatus? status, [FromQuery] string? dealerCode, [FromQuery] string? jobCardNumber, [FromQuery] DateTimeOffset? updatedSince, [FromQuery] string? registrationNumber, [FromQuery] string? chassisNo,
        [FromQuery] int pageIndex = 0, [FromQuery] int pageSize = 0)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var allowedIds = NarrowIds(allowed, dealerCode);
        if (allowedIds.Count == 0) { Response.Headers["X-Total-Count"] = "0"; return Ok(Array.Empty<object>()); }

        var kw = CustomerNameKeyword.ToUpperInvariant();
        var query = Db.JobCards.AsNoTracking()
            .Where(j => allowedIds.Contains(j.DealerId) && j.Customer != null && j.Customer.Name.ToUpper().Contains(kw));
        if (from is not null) { var f = from.Value.ToDateTime(TimeOnly.MinValue); query = query.Where(j => j.CreatedAt >= f); }
        if (to is not null) { var t = to.Value.ToDateTime(TimeOnly.MaxValue); query = query.Where(j => j.CreatedAt <= t); }
        if (status.HasValue) query = query.Where(j => j.Status == status);
        if (!string.IsNullOrWhiteSpace(jobCardNumber)) query = query.Where(j => j.JobCardNumber == jobCardNumber);
        if (updatedSince is not null) { var since = updatedSince.Value.UtcDateTime; query = query.Where(j => j.UpdatedAt >= since || j.CreatedAt >= since); }
        if (!string.IsNullOrWhiteSpace(registrationNumber)) { var reg = NormId(registrationNumber); query = query.Where(j => j.Vehicle != null && (j.Vehicle.RegNo ?? "").Replace(" ", "").Replace("-", "").ToUpper() == reg); }
        if (!string.IsNullOrWhiteSpace(chassisNo)) { var vin = NormId(chassisNo); query = query.Where(j => j.Vehicle != null && (j.Vehicle.Vin ?? "").Replace(" ", "").Replace("-", "").ToUpper() == vin); }

        Response.Headers["X-Total-Count"] = (await query.CountAsync()).ToString();
        var (skip, take) = PageWindow(pageIndex, pageSize, 500);

        var ordered = updatedSince is null ? query.OrderByDescending(j => j.CreatedAt).ThenBy(j => j.Id) : query.OrderBy(j => j.UpdatedAt).ThenBy(j => j.Id);
        var rows = await ordered
            .Include(j => j.Customer).Include(j => j.Vehicle).Include(j => j.CurrentStage)
            .Include(j => j.Dealer).Include(j => j.Complaints)
            .Skip(skip).Take(take)
            .ToListAsync();
        var versions = await EstimateVersionsAsync(rows.Select(r => r.Id).ToList());

        return Ok(rows.Select(j => new
        {
            j.Id,
            j.JobCardNumber,
            Status = j.Status.ToString(),
            ServiceType = j.ServiceType.ToString(),
            Priority = j.Priority.ToString(),
            CreatedAt = AsUtc(j.CreatedAt),
            UpdatedAt = AsUtc(j.UpdatedAt),
            ExpectedDeliveryAt = AsUtc(j.ExpectedDeliveryAt),
            ActualDeliveryAt = AsUtc(j.ActualDeliveryAt),
            ClosedAt = AsUtc(j.ClosedAt),
            j.OdometerAtCheckIn,
            j.BatteryLevelAtCheckIn,
            DealerId = j.Dealer != null ? j.Dealer.Id : (Guid?)null,
            DealerName = j.Dealer != null ? j.Dealer.Name : null,
            DealerCode = j.Dealer != null ? j.Dealer.BaplDmsDealerCode : null,
            CustomerName = j.Customer != null ? j.Customer.Name : null,
            CustomerMobile = j.Customer != null ? j.Customer.Mobile : null,
            VehicleModel = j.Vehicle != null ? j.Vehicle.Model : null,
            RegNo = j.Vehicle != null ? j.Vehicle.RegNo : null,
            ChassisNo = j.Vehicle != null ? j.Vehicle.Vin : null,
            ChassisMissing = j.Vehicle == null || string.IsNullOrWhiteSpace(j.Vehicle.Vin),
            EstimateVersion = versions.GetValueOrDefault(j.Id),
            StageLabel = j.CurrentStage != null ? j.CurrentStage.Label : null,
            j.BaplJobType,
            j.BaplServiceHeadName,
            j.BaplServiceLocation,
            j.BaplServiceLocationCode,
            j.BaplManualJobNo,
            j.AssignedTechnicianName,
            Complaints = j.Complaints.Select(c => c.Description),
        }));
    }

    /// <summary>GET repair-bills?from=&amp;to=&amp;dealerCode=&amp;pageIndex=&amp;pageSize= - full Repair Bill detail (lines, discounts, CGST / SGST / IGST, totals) of this app's own bills, deleted ones
    /// excluded. from / to filter the bill date. Newest first; default page size 1000, maximum 1000.</summary>
    [HttpGet("repair-bills")]
    public async Task<IActionResult> RepairBills(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? dealerCode, [FromQuery] DateTimeOffset? updatedSince, [FromQuery] string? registrationNumber, [FromQuery] string? chassisNo,
        [FromQuery] int pageIndex = 0, [FromQuery] int pageSize = 0)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var dealerLookup = allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode));
        var allowedIds = NarrowIds(allowed, dealerCode);
        if (allowedIds.Count == 0) { Response.Headers["X-Total-Count"] = "0"; return Ok(Array.Empty<object>()); }

        var kw = CustomerNameKeyword.ToUpperInvariant();
        var query = Db.RepairBillDocs.AsNoTracking()
            .Where(r => (updatedSince != null || !r.IsDeleted) && allowedIds.Contains(r.DealerId)
                && (r.PartyName.ToUpper().Contains(kw)
                    || (r.JobCard != null && r.JobCard.Customer != null && r.JobCard.Customer.Name.ToUpper().Contains(kw))));
        if (from is not null) query = query.Where(r => r.BillDate >= from);
        if (to is not null) query = query.Where(r => r.BillDate <= to);
        if (updatedSince is not null) { var since = updatedSince.Value.UtcDateTime; query = query.Where(r => r.UpdatedAt >= since || r.CreatedAt >= since); }
        if (!string.IsNullOrWhiteSpace(registrationNumber)) { var reg = NormId(registrationNumber); query = query.Where(r => (r.RegNo ?? "").Replace(" ", "").Replace("-", "").ToUpper() == reg); }
        if (!string.IsNullOrWhiteSpace(chassisNo)) { var vin = NormId(chassisNo); query = query.Where(r => (r.ChassisNo ?? "").Replace(" ", "").Replace("-", "").ToUpper() == vin); }

        Response.Headers["X-Total-Count"] = (await query.CountAsync()).ToString();
        var (skip, take) = PageWindow(pageIndex, pageSize, 1000);

        var bills = await query.Include(r => r.Items).Include(r => r.JobCard)
            .OrderByDescending(r => r.BillDate).ThenBy(r => r.Id)
            .Skip(skip).Take(take)
            .ToListAsync();

        return Ok(bills.Select(b => ToRepairBillRow(b, dealerLookup)));
    }

    /// <summary>GET material-transfers?from=&amp;to=&amp;dealerCode=&amp;pageIndex=&amp;pageSize= - same shape and rules as repair-bills, for Material Transfer documents. from / to filter the transfer date.</summary>
    [HttpGet("material-transfers")]
    public async Task<IActionResult> MaterialTransfers(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? dealerCode, [FromQuery] DateTimeOffset? updatedSince, [FromQuery] string? registrationNumber, [FromQuery] string? chassisNo,
        [FromQuery] int pageIndex = 0, [FromQuery] int pageSize = 0)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var dealerLookup = allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode));
        var allowedIds = NarrowIds(allowed, dealerCode);
        if (allowedIds.Count == 0) { Response.Headers["X-Total-Count"] = "0"; return Ok(Array.Empty<object>()); }

        var kw = CustomerNameKeyword.ToUpperInvariant();
        var query = Db.MaterialTransferDocs.AsNoTracking()
            .Where(m => allowedIds.Contains(m.DealerId)
                && ((m.PartyName != null && m.PartyName.ToUpper().Contains(kw))
                    || (m.JobCard != null && m.JobCard.Customer != null && m.JobCard.Customer.Name.ToUpper().Contains(kw))));
        if (from is not null) query = query.Where(m => m.TransferDate >= from);
        if (to is not null) query = query.Where(m => m.TransferDate <= to);
        if (updatedSince is not null)
        {
            // a material transfer has no UpdatedAt in the model: the column and its triggers live in sql/2026-11-01_materialtransfer_updatedat.sql and are read here with raw SQL
            var since = updatedSince.Value.UtcDateTime;
            var changedIds = await MaterialTransferIdsChangedSinceAsync(since);
            query = query.Where(m => m.CreatedAt >= since || changedIds.Contains(m.Id));
        }
        // a transfer has no vehicle of its own: the vehicle is the one of its job card (transfers without a job card never match these filters)
        if (!string.IsNullOrWhiteSpace(registrationNumber)) { var reg = NormId(registrationNumber); query = query.Where(m => m.JobCard != null && m.JobCard.Vehicle != null && (m.JobCard.Vehicle.RegNo ?? "").Replace(" ", "").Replace("-", "").ToUpper() == reg); }
        if (!string.IsNullOrWhiteSpace(chassisNo)) { var vin = NormId(chassisNo); query = query.Where(m => m.JobCard != null && m.JobCard.Vehicle != null && (m.JobCard.Vehicle.Vin ?? "").Replace(" ", "").Replace("-", "").ToUpper() == vin); }

        Response.Headers["X-Total-Count"] = (await query.CountAsync()).ToString();
        var (skip, take) = PageWindow(pageIndex, pageSize, 1000);

        var docs = await query.Include(m => m.Items).Include(m => m.JobCard).ThenInclude(j => j!.Vehicle)
            .OrderByDescending(m => m.TransferDate).ThenBy(m => m.Id)
            .Skip(skip).Take(take)
            .ToListAsync();

        var updatedMap = await MaterialTransferUpdatedAtAsync(docs.Select(d => d.Id).ToList());
        return Ok(docs.Select(d => ToMaterialTransferRow(d, dealerLookup, updatedMap)));
    }

    /// <summary>A registration or chassis number for comparison: no spaces, no hyphens, upper case. The same is applied to the stored value inside the query.</summary>
    private static string NormId(string? s) => (s ?? "").Replace(" ", "").Replace("-", "").ToUpperInvariant();

    /// <summary>The database returns date-times without a zone; they are UTC (the app writes DateTime.UtcNow), so mark them: 2026-10-29T11:03:51Z, as the API document promises.</summary>
    private static DateTime? AsUtc(object? v) => v is DateTime d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null;

    public sealed class EstimateVersionRow { public Guid JobCardId { get; set; } public int Version { get; set; } }

    /// <summary>The estimate version of each job card in the page (dbo.JobCardEstimateVersions, kept by triggers). 0 = no estimate. If that table does not exist yet (the SQL script was not run) the list still works, without versions.</summary>
    private async Task<Dictionary<Guid, int>> EstimateVersionsAsync(List<Guid> ids)
    {
        var result = new Dictionary<Guid, int>();
        if (ids.Count == 0) return result;
        try
        {
            var sql = "SELECT [JobCardId] AS JobCardId, [Version] AS Version FROM [dbo].[JobCardEstimateVersions] WHERE [JobCardId] IN (" + string.Join(",", ids.Select((_, i) => "@j" + i)) + ")";
            var rows = await Db.Database.SqlQueryRaw<EstimateVersionRow>(sql, ids.Select((g, i) => (object)new SqlParameter("@j" + i, g)).ToArray()).ToListAsync();
            foreach (var r in rows) result[r.JobCardId] = r.Version;
        }
        catch (Exception ex) { _logger.LogWarning(ex, "{Partner}: the estimate versions could not be read (is sql/2026-11-01_shadowfax_decisions_estimates.sql installed?).", PartnerName); }
        return result;
    }

    public sealed class GuidRow { public Guid Id { get; set; } }
    public sealed class ChangedAtRow { public Guid Id { get; set; } public DateTime UpdatedAt { get; set; } }

    /// <summary>Ids of the material transfers created or changed since a moment (dbo.MaterialTransferDocs.UpdatedAt, kept by triggers). If the column does not exist yet (the SQL script was not run) this returns nothing, so only newly created transfers are found.</summary>
    private async Task<List<Guid>> MaterialTransferIdsChangedSinceAsync(DateTime sinceUtc)
    {
        try { return (await Db.Database.SqlQueryRaw<GuidRow>("SELECT [Id] AS Id FROM [dbo].[MaterialTransferDocs] WHERE [UpdatedAt] >= {0}", sinceUtc).ToListAsync()).Select(r => r.Id).ToList(); }
        catch (Exception ex) { _logger.LogWarning(ex, "{Partner}: MaterialTransferDocs.UpdatedAt could not be read (is sql/2026-11-01_materialtransfer_updatedat.sql installed?).", PartnerName); return new List<Guid>(); }
    }

    private async Task<Dictionary<Guid, DateTime>> MaterialTransferUpdatedAtAsync(List<Guid> ids)
    {
        var result = new Dictionary<Guid, DateTime>();
        if (ids.Count == 0) return result;
        try
        {
            var sql = "SELECT [Id] AS Id, [UpdatedAt] AS UpdatedAt FROM [dbo].[MaterialTransferDocs] WHERE [UpdatedAt] IS NOT NULL AND [Id] IN (" + string.Join(",", ids.Select((_, i) => "@t" + i)) + ")";
            var rows = await Db.Database.SqlQueryRaw<ChangedAtRow>(sql, ids.Select((g, i) => (object)new SqlParameter("@t" + i, g)).ToArray()).ToListAsync();
            foreach (var r in rows) result[r.Id] = r.UpdatedAt;
        }
        catch (Exception ex) { _logger.LogWarning(ex, "{Partner}: MaterialTransferDocs.UpdatedAt could not be read.", PartnerName); }
        return result;
    }

    // ------------------------------------------------------------------ response shapes (identical to ZohoIntegrationController)

    private static object ToRepairBillRow(RepairBillDoc b, Dictionary<Guid, (string Name, string? BaplDmsDealerCode)> dealerLookup)
    {
        dealerLookup.TryGetValue(b.DealerId, out var dealer);
        return new
        {
            b.Id,
            b.BillNumber,
            BillDate = b.BillDate,
            DealerId = b.DealerId,
            DealerName = dealer.Name,
            DealerCode = dealer.BaplDmsDealerCode,
            b.JobCardId,
            JobCardNumber = b.JobCard?.JobCardNumber,
            b.PartyName,
            b.RegNo,
            b.ChassisNo,
            b.Location,
            b.BillType,
            b.IssueType,
            Status = b.IsDeleted ? "Deleted" : b.Status.ToString(),
            b.IsDeleted,
            UpdatedAt = AsUtc(b.UpdatedAt ?? b.CreatedAt),   // a bill never edited has no UpdatedAt: its change time is its creation (sql/2026-11-02_repairbill_updatedat.sql keeps it current)
            b.Remarks,
            b.InsuranceCompanyName,
            b.InsuranceDescription,
            b.SurveyorName,
            b.SurveyorContactNumber,
            b.PolicyNo,
            b.InsuranceValidTill,
            b.ZeroDepreciation,
            b.TotalDiscount,
            b.AmountReceived,
            b.TaxableAmount,
            b.CgstAmount,
            b.SgstAmount,
            b.IgstAmount,
            b.TotalAmount,
            ItemCount = b.Items.Count,
            Items = b.Items.Select(i => new
            {
                i.Id,
                ItemType = i.ItemType.ToString(),
                i.ItemCode,
                i.ItemDescription,
                i.HsnCode,
                i.IssueType,
                i.Qty,
                i.Rate,
                i.DiscountType,
                i.DiscountValue,
                // The rupee amount the discount took off the line (gross = Qty x Rate; "Percentage" = % of gross, otherwise a flat amount; never more than gross) - computed here from
                // the two stored fields so the caller does not have to redo the arithmetic. Same formula as RepairBillDocsController / ZohoIntegrationController.
                DiscountAmount = ComputeDiscountAmount(i.Qty, i.Rate, i.DiscountType, i.DiscountValue),
                i.CgstPct,
                i.SgstPct,
                i.IgstPct,
                i.TaxableAmount,
                i.CgstAmount,
                i.SgstAmount,
                i.IgstAmount,
                i.TotalAmount,
                i.ExtendedBatteryWarrantySchemeId,
                i.IsUnderExtendedWarranty,
            }),
        };
    }

    private static decimal ComputeDiscountAmount(double qty, decimal rate, string? discountType, decimal discountValue)
    {
        decimal gross = (decimal)qty * rate;
        decimal discountAmt = string.Equals(discountType, "Percentage", StringComparison.OrdinalIgnoreCase)
            ? gross * discountValue / 100m
            : discountValue;
        return discountAmt > gross ? gross : discountAmt;
    }

    private static object ToMaterialTransferRow(MaterialTransferDoc m, Dictionary<Guid, (string Name, string? BaplDmsDealerCode)> dealerLookup, Dictionary<Guid, DateTime>? updatedMap = null)
    {
        dealerLookup.TryGetValue(m.DealerId, out var dealer);
        return new
        {
            m.Id,
            m.TransferNumber,
            TransferDate = m.TransferDate,
            DealerId = m.DealerId,
            DealerName = dealer.Name,
            DealerCode = dealer.BaplDmsDealerCode,
            m.JobCardId,
            JobCardNumber = m.JobCard?.JobCardNumber,
            RegNo = m.JobCard?.Vehicle?.RegNo,
            ChassisNo = m.JobCard?.Vehicle?.Vin,
            m.Location,
            TransferType = m.TransferType.ToString(),
            m.IssueType,
            m.PartyName,
            m.TechnicianId,
            m.Remarks,
            Status = m.Status.ToString(),
            UpdatedAt = updatedMap != null && updatedMap.TryGetValue(m.Id, out var changedAt) ? DateTime.SpecifyKind(changedAt, DateTimeKind.Utc) : (DateTime?)null,
            m.TotalAmount,
            ItemCount = m.Items.Count,
            Items = m.Items.Select(i => new
            {
                i.Id, i.ItemCode, i.ItemDescription, i.HsnCode, i.IssueType, i.Qty, i.Rate, i.Amount,
                i.RackNo, i.Bin, i.SerialNo, i.Mrp, i.ValidDays, i.ItemReceived,
                ItemType = i.ItemType.ToString(),
            }),
        };
    }
}