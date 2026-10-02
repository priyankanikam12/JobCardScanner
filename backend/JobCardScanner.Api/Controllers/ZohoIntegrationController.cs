using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-02 ("for this 3 api i want create new api for Zoho customer ... all get api wants to
/// provide them direct all get data of all magnamite dealer excluding [3 named/coded dealers]
/// otherwise all data they can get all magnamite so simple get api with api key"). GET-ONLY
/// integration for Zoho, scoped to every Dealer whose Name contains "MAGNEMITE" EXCEPT the three
/// you named/coded. Mirrors ZomatoIntegrationController's own X-API-Key pattern (CheckApiKey below
/// is a copy of that controller's, keyed "ApiKeys:Zoho" instead of "ApiKeys:Zomato" - same shared
/// "ApiKeys" config section, so add a "Zoho" entry alongside the existing
/// Shadowfax/Internal/Zomato/ANVWeb/Cogzim ones).
///
/// WHY A NEW CONTROLLER, NOT JobCardsController/RepairBillDocsController/MaterialTransferDocsController
/// DIRECTLY: same reasoning as ZomatoIntegrationController's own doc comment - those three are all
/// gated by your staff login (Azure AD/dealer session), which Zoho's system can't use, and they are
/// all scoped to "the signed-in user's own dealer", not "a named group of dealers" - a shape this
/// controller needed to build fresh rather than reuse.
///
/// DEALER SCOPE (INTERPRETATION, confirmed via AskUserQuestion this round): "all magnamite dealer
/// excluding ..." means every Dealer row whose Name contains "MAGNEMITE", MINUS any whose
/// BaplDmsDealerCode is one of the three you gave (CUS0347/CUS0213/CUS0209) - NOT the local
/// Dealer.Code column, which elsewhere in this app is a different, numeric code space (e.g. "288" -
/// see JobCardsController.Detail's own BaplDealerCode comment distinguishing the two). You confirmed
/// this reading. ResolveAllowedDealersAsync() below is the ONE place this match happens - if the
/// real codes turn out to live in a different column, this is a one-method fix, nothing else in this
/// file needs to change. Name matching uses plain SQL Contains (no explicit ToUpper/ToLower) - same
/// convention as this app's existing PartyName == "Zomato" checks elsewhere, which also don't
/// normalize case; this relies on the database's default (normally case-insensitive) collation. If
/// your SQL Server collation is case-sensitive, tell me and I'll add an explicit
/// EF.Functions.Like or ToUpper() comparison instead.
///
/// SCOPE OF DATA RETURNED (confirmed via AskUserQuestion this round - "full financial detail"):
/// Repair Bills and Material Transfers return the SAME full line-item/tax/total shape as
/// RepairBillDocsController.ToRow/MaterialTransferDocsController.ToRow (just re-declared here as
/// ToRepairBillRow/ToMaterialTransferRow, since those are `private` on their own controllers and
/// not reusable directly) - real amounts, discounts, CGST/SGST/IGST, same as a dealer staff member
/// sees. Job Cards deliberately stay a STATUS/descriptive view only (no pricing fields exist on
/// JobCard itself to trim - the real amounts live on RepairBillDocs, already covered above) - this
/// mirrors ZomatoIntegrationController.GetJobCardStatus's own scope, which is a proven, already-
/// reviewed shape for an external partner, rather than inventing a new job-card projection from
/// scratch. QcChecklistItems/Worklogs/Photos/raw PartSuggestion-LabourSuggestion (pre-billing,
/// not-yet-invoiced guesses - see JobCardsController.AddPartSuggestion's own doc comment: "does not
/// write anything back into DMS", JobCardScanner-internal only) are NOT included anywhere in this
/// controller, same reasoning Zomato's own controller gives for leaving them out - tell me if Zoho
/// specifically needs one of these.
///
/// ONLY SCOPING RULE: a dealer's data is returned here purely by DealerId membership in the
/// resolved Magnamite set above - NOT by any PartyName/Customer field on individual bills (unlike
/// Zomato's repair-bills/material-transfers endpoints, which filter by PartyName == "Zomato" because
/// Zomato is a customer/party of many different dealers). Magnamite, per your own wording
/// ("magnamite dealer"), is itself one or more of BGauss's own Dealer rows - so every bill/transfer/
/// job card OWNED by one of those dealers comes back, regardless of who the customer/party on any
/// individual document is.
/// </summary>
[ApiController]
[Route("api/zoho")]
[AllowAnonymous]
public class ZohoIntegrationController : ControllerBase
{
    /// <summary>The three dealer exclusions, exactly as you gave them (name + BaplDmsDealerCode +,
    /// where you gave one, city) - kept here, not just as a bare code array, so the exclusion list
    /// is self-documenting if you come back to it later. Only ExcludedBaplDealerCodes is actually
    /// used for matching (see this controller's own class-level doc comment on why Code, not Name,
    /// is the safe way to exclude these three - MAGNEMITE MOTO LLP-PUNE/-AHMEDABAD both carry a
    /// "-CITY" suffix on Name, but the third, MAGNEMITE MOTO LLP/CUS0209/RAJKOT, does NOT - matching
    /// by Name suffix would have missed that inconsistency; matching by Code sidesteps it entirely).</summary>
    private static readonly (string BaplDealerCode, string Name, string? City)[] ExcludedDealers =
    {
        ("CUS0347", "MAGNEMITE MOTO LLP-PUNE", null),
        ("CUS0213", "MAGNEMITE MOTO LLP-AHMEDABAD", "AHMEDABAD"),
        ("CUS0209", "MAGNEMITE MOTO LLP", "RAJKOT"),
    };
    private static readonly string[] ExcludedBaplDealerCodes = ExcludedDealers.Select(d => d.BaplDealerCode).ToArray();

    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<ZohoIntegrationController> _logger;

    public ZohoIntegrationController(JobCardScannerDbContext db, IConfiguration config, ILogger<ZohoIntegrationController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>Same pattern as ZomatoIntegrationController.CheckApiKey, keyed "ApiKeys:Zoho".</summary>
    private IActionResult? CheckApiKey()
    {
        var configuredKey = _config["ApiKeys:Zoho"];
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            _logger.LogWarning("Zoho API called but ApiKeys:Zoho is not configured - refusing every request until it is set.");
            return StatusCode(503, new { message = "This integration is not yet configured." });
        }
        if (!Request.Headers.TryGetValue("X-API-Key", out var providedKey) || providedKey != configuredKey)
            return Unauthorized(new { message = "Missing or invalid X-API-Key." });
        return null;
    }

    /// <summary>The ONE place "all magnamite dealer excluding ..." is resolved to actual Dealer
    /// rows - see this controller's own class-level doc comment for the reasoning. Returns the full
    /// Dealer rows (not just Ids) so every action below can also read Name/BaplDmsDealerCode for its
    /// response without a second round trip.</summary>
    private async Task<List<(Guid Id, string Name, string? BaplDmsDealerCode)>> ResolveAllowedDealersAsync()
    {
        var dealers = await _db.Dealers.AsNoTracking()
            .Where(d => d.Name.Contains("MAGNEMITE"))
            .Select(d => new { d.Id, d.Name, d.BaplDmsDealerCode })
            .ToListAsync();

        return dealers
            .Where(d => d.BaplDmsDealerCode == null || !ExcludedBaplDealerCodes.Contains(d.BaplDmsDealerCode))
            .Select(d => (d.Id, d.Name, d.BaplDmsDealerCode))
            .ToList();
    }

    /// <summary>GET /api/zoho/dealers - lists exactly which dealers this API key currently resolves
    /// to (Name + BaplDmsDealerCode only, nothing financial) - a sanity-check endpoint so you (or
    /// Zoho) can confirm the scope is right before pulling bulk data from the other three endpoints.
    /// Not something you asked for by name, but cheap, low-risk (no pricing/customer data), and the
    /// fastest way to catch a dealer-matching mistake before it silently under- or over-shares data.</summary>
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

    /// <summary>GET /api/zoho/jobcards?from=&amp;to=&amp;status=&amp;dealerCode=&amp;jobCardNumber=
    /// - job card status/descriptive view across every in-scope Magnamite dealer. from/to filter on
    /// CreatedAt (job-open date); dealerCode narrows to one Magnamite location's own
    /// BaplDmsDealerCode (e.g. just Delhi) instead of every location at once; jobCardNumber is an
    /// exact-match lookup for one specific job. Capped at 500 rows, newest first - paginate with
    /// from/to (or ask me to add real pageIndex/pageSize paging if Zoho needs to pull more than that
    /// in one call).</summary>
    [HttpGet("jobcards")]
    public async Task<IActionResult> JobCards(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] JobCardStatus? status, [FromQuery] string? dealerCode, [FromQuery] string? jobCardNumber)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var allowedIds = allowed.Select(d => d.Id).ToList();
        if (allowedIds.Count == 0) return Ok(Array.Empty<object>());
        if (!string.IsNullOrWhiteSpace(dealerCode))
        {
            allowedIds = allowed.Where(d => d.BaplDmsDealerCode == dealerCode).Select(d => d.Id).ToList();
            if (allowedIds.Count == 0) return Ok(Array.Empty<object>());
        }

        var query = _db.JobCards.AsNoTracking()
            .Include(j => j.Customer).Include(j => j.Vehicle).Include(j => j.CurrentStage)
            .Include(j => j.Dealer).Include(j => j.Complaints)
            .Where(j => allowedIds.Contains(j.DealerId));

        if (from is not null) { var f = from.Value.ToDateTime(TimeOnly.MinValue); query = query.Where(j => j.CreatedAt >= f); }
        if (to is not null) { var t = to.Value.ToDateTime(TimeOnly.MaxValue); query = query.Where(j => j.CreatedAt <= t); }
        if (status.HasValue) query = query.Where(j => j.Status == status);
        if (!string.IsNullOrWhiteSpace(jobCardNumber)) query = query.Where(j => j.JobCardNumber == jobCardNumber);

        var rows = await query.OrderByDescending(j => j.CreatedAt).Take(500).ToListAsync();

        return Ok(rows.Select(j => new
        {
            j.Id,
            j.JobCardNumber,
            Status = j.Status.ToString(),
            ServiceType = j.ServiceType.ToString(),
            Priority = j.Priority.ToString(),
            j.CreatedAt,
            j.ExpectedDeliveryAt,
            j.ActualDeliveryAt,
            j.ClosedAt,
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

    /// <summary>GET /api/zoho/repair-bills?from=&amp;to=&amp;dealerCode= - full Repair Bill detail
    /// (line items, discounts, CGST/SGST/IGST, totals - see this controller's own class-level doc
    /// comment on why this is the FULL shape, not Zomato's trimmed one) for every in-scope Magnamite
    /// dealer's own JobCardScannerDb-native bills (IsDeleted excluded). from/to filter BillDate;
    /// dealerCode narrows to one Magnamite location. Does NOT blend in the DMSBAPLDATA-synced rows
    /// RepairBillDocsController.Combined also shows staff - those are a different, read-only data
    /// source this app doesn't own, and the real financial record for anything billed through this
    /// app lives in these JobCardScannerDb rows. Capped at 1000 rows, newest first.</summary>
    [HttpGet("repair-bills")]
    public async Task<IActionResult> RepairBills(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? dealerCode)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var dealerLookup = allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode));
        var allowedIds = allowed.Select(d => d.Id).ToList();
        if (!string.IsNullOrWhiteSpace(dealerCode))
            allowedIds = allowed.Where(d => d.BaplDmsDealerCode == dealerCode).Select(d => d.Id).ToList();
        if (allowedIds.Count == 0) return Ok(Array.Empty<object>());

        var query = _db.RepairBillDocs.AsNoTracking().Where(r => !r.IsDeleted && allowedIds.Contains(r.DealerId));
        if (from is not null) query = query.Where(r => r.BillDate >= from);
        if (to is not null) query = query.Where(r => r.BillDate <= to);

        var bills = await query.Include(r => r.Items).Include(r => r.JobCard)
            .OrderByDescending(r => r.BillDate).Take(1000).ToListAsync();

        return Ok(bills.Select(b => ToRepairBillRow(b, dealerLookup)));
    }

    /// <summary>GET /api/zoho/material-transfers?from=&amp;to=&amp;dealerCode= - same reasoning and
    /// shape as RepairBills above, for Material Transfer documents. from/to filter TransferDate.</summary>
    [HttpGet("material-transfers")]
    public async Task<IActionResult> MaterialTransfers(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? dealerCode)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var dealerLookup = allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode));
        var allowedIds = allowed.Select(d => d.Id).ToList();
        if (!string.IsNullOrWhiteSpace(dealerCode))
            allowedIds = allowed.Where(d => d.BaplDmsDealerCode == dealerCode).Select(d => d.Id).ToList();
        if (allowedIds.Count == 0) return Ok(Array.Empty<object>());

        var query = _db.MaterialTransferDocs.AsNoTracking().Where(m => allowedIds.Contains(m.DealerId));
        if (from is not null) query = query.Where(m => m.TransferDate >= from);
        if (to is not null) query = query.Where(m => m.TransferDate <= to);

        var docs = await query.Include(m => m.Items).Include(m => m.JobCard)
            .OrderByDescending(m => m.TransferDate).Take(1000).ToListAsync();

        return Ok(docs.Select(d => ToMaterialTransferRow(d, dealerLookup)));
    }

    /// <summary>Re-declared from RepairBillDocsController.ToRow (that one is `private` on its own
    /// controller, not reusable from here) - IDENTICAL field set, plus DealerId/DealerName/
    /// DealerCode added so a multi-dealer caller like Zoho can tell which Magnamite location each
    /// bill belongs to (the original, single-dealer-scoped endpoint never needed that - its caller
    /// already knows their own dealer).</summary>
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
            Status = b.Status.ToString(),
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
                // 2026-10-02 ("in both discount feild not added?"): DiscountType/DiscountValue
                // above are the raw stored inputs (e.g. DiscountType "Percentage", DiscountValue
                // 10) - reading the actual rupee amount deducted from them means redoing
                // RepairBillDocsController.BuildAndAttachItemsAsync's own discount arithmetic
                // yourself. Added this computed field so Zoho doesn't have to: same formula as
                // that method (gross = Qty * Rate; Percentage applies DiscountValue as a % of
                // gross, otherwise DiscountValue is a flat rupee amount; capped so it can never
                // exceed the line's own gross). This is NOT a new stored column - RepairBillDocItem
                // itself only ever stored DiscountType/DiscountValue (see that model's own doc
                // comment) and TaxableAmount (already net of discount AND zero-tax special-casing
                // for IssueType "U/W"/"FSC" - so TaxableAmount minus gross would be wrong for those
                // lines). Computed fresh here, every call, from the same two fields the database
                // already has - nothing new persisted, nothing recomputed differently than the
                // original save already decided.
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

    /// <summary>Same discount arithmetic as RepairBillDocsController.BuildAndAttachItemsAsync's
    /// own inline calculation (gross = Qty * Rate; "Percentage" DiscountType applies DiscountValue
    /// as a percentage of gross, anything else treats DiscountValue as a flat rupee amount; the
    /// result is capped at gross so a line can never show a negative post-discount amount) -
    /// re-declared here for the same reason ToRepairBillRow/ToMaterialTransferRow are: that method
    /// is private on RepairBillDocsController, not reusable from this controller.</summary>
    private static decimal ComputeDiscountAmount(double qty, decimal rate, string? discountType, decimal discountValue)
    {
        decimal gross = (decimal)qty * rate;
        decimal discountAmt = string.Equals(discountType, "Percentage", StringComparison.OrdinalIgnoreCase)
            ? gross * discountValue / 100m
            : discountValue;
        return discountAmt > gross ? gross : discountAmt;
    }

    /// <summary>Re-declared from MaterialTransferDocsController.ToRow, same reasoning/addition as
    /// ToRepairBillRow above. NOTE ("in both discount feild not added?"): unlike RepairBillDocItem,
    /// MaterialTransferDocItem has NO DiscountType/DiscountValue columns at all - confirmed from
    /// the real MaterialTransferDocsController.cs you pasted earlier (its own ToRow/
    /// ApplyStockAndBuildItemsAsync never reference a discount field anywhere). Material Transfer
    /// in this app has never supported a discount, on any line, for any caller - this is not
    /// something missing from this endpoint specifically, there is no discount value anywhere in
    /// JobCardScannerDb for a Material Transfer line to return. If Zoho needs discounting on
    /// transfers, that is a new field on MaterialTransferDocItem itself (and on every page that
    /// creates one) - tell me and I will add it as its own change, not invent one here.</summary>
    private static object ToMaterialTransferRow(MaterialTransferDoc m, Dictionary<Guid, (string Name, string? BaplDmsDealerCode)> dealerLookup)
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
            m.Location,
            TransferType = m.TransferType.ToString(),
            m.IssueType,
            m.PartyName,
            m.TechnicianId,
            m.Remarks,
            Status = m.Status.ToString(),
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
