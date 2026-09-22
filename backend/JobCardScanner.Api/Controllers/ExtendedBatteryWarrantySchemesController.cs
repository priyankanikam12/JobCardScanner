using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-09-22 "needs to create warenty table in jobcardscanner db for this functionality and add
/// this in our function" - CRUD + eligibility check for the dealer-configurable Extended Battery
/// Warranty Scheme master (see Models/ExtendedBatteryWarrantySchemes.cs for the full field-by-field
/// disclosure of what was ported vs. adapted from the BAPL DMS reference pasted earlier in this
/// session, and for the eligibility formula itself - which is INTERPRETATION and should be checked
/// against actual BGauss policy before being treated as authoritative for a real warranty claim,
/// not a confirmed business rule).
///
/// Follows the direct-_db CRUD pattern used by RepairBillDocsController/MaterialTransferDocsController
/// (this table lives in JobCardScannerDb, not BAPLDMSvad/DMSBAPLDATA, so there is no service-layer
/// indirection to go through here, unlike LabourMasterController/ItemMasterController which read
/// external BAPL data). Gated at WorkshopManagerUp for the whole controller, matching
/// LabourMasterController's own rationale: dealer/customer pricing (DealerPrice/CustomerPrice/
/// DiscountAmount below) is confidential per org policy and shouldn't be visible to every
/// Staff-level login.
///
/// NOTE for whoever reviews this: JobCardScannerDb already has an unrelated, simpler field -
/// Vehicle.Warranty.BatteryWarrantyExpiry (see Models/MasterData.cs) - a single per-vehicle expiry
/// date with no pricing/scheme concept at all. That field is NOT touched or read by this
/// controller. The two are separate, additive concepts: this new table is the dealer-configurable,
/// priced "Extended Battery Warranty Scheme" being requested, not a replacement for the existing
/// simple expiry field.
/// </summary>
[ApiController]
[Route("api/extended-battery-warranty-schemes")]
[Authorize(Policy = Policies.WorkshopManagerUp)]
public class ExtendedBatteryWarrantySchemesController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IExtendedBatteryWarrantyEligibilityService _eligibility;
    private readonly IAuditLogService _audit;
    private readonly ILogger<ExtendedBatteryWarrantySchemesController> _logger;

    public ExtendedBatteryWarrantySchemesController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IExtendedBatteryWarrantyEligibilityService eligibility,
        IAuditLogService audit, ILogger<ExtendedBatteryWarrantySchemesController> logger)
    {
        _db = db;
        _currentUser = currentUser;
        _eligibility = eligibility;
        _audit = audit;
        _logger = logger;
    }

    /// <summary>GET /api/extended-battery-warranty-schemes - this dealer's own schemes, newest
    /// first. `search` matches SchemeName or VehicleModel (contains, case-insensitive via SQL
    /// Server's default collation); `isActive` optionally narrows to active/inactive only.</summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? search = null, [FromQuery] bool? isActive = null)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null) return Forbid();

        var query = _db.ExtendedBatteryWarrantySchemes.AsNoTracking().Include(s => s.OemModel).Where(s => s.DealerId == dealerId);
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(s => s.SchemeName.Contains(search) || s.VehicleModel.Contains(search));
        if (isActive is not null) query = query.Where(s => s.IsActive == isActive);

        var schemes = await query.OrderByDescending(s => s.CreatedAt).ToListAsync();
        return Ok(schemes.Select(ToRow));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var scheme = await _db.ExtendedBatteryWarrantySchemes.AsNoTracking().Include(s => s.OemModel)
            .FirstOrDefaultAsync(s => s.Id == id && s.DealerId == dealerId);
        return scheme is null ? NotFound() : Ok(ToRow(scheme));
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateExtendedBatteryWarrantySchemeRequest req)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null) return Forbid();
        if (string.IsNullOrWhiteSpace(req.SchemeName)) return BadRequest(new { message = "Scheme Name is required." });
        if (string.IsNullOrWhiteSpace(req.VehicleModel)) return BadRequest(new { message = "Vehicle Model is required." });
        if (!IsValidDurationType(req.DurationType))
            return BadRequest(new { message = "Duration Type must be Days, Months, or Years." });

        var scheme = new ExtendedBatteryWarrantyScheme
        {
            DealerId = dealerId.Value,
            SchemeName = req.SchemeName.Trim(),
            VehicleModel = req.VehicleModel.Trim(),
            RateType = req.RateType,
            Duration = req.Duration,
            DurationType = req.DurationType,
            Kms = req.Kms,
            DealerPrice = req.DealerPrice,
            CustomerPrice = req.CustomerPrice,
            DiscountAmount = req.DiscountAmount,
            GstPercent = req.GstPercent,
            PurchaseValidityDays = req.PurchaseValidityDays,
            BatteryPartCode = req.BatteryPartCode,
            PartCode = req.PartCode,
            FromDate = req.FromDate,
            ToDate = req.ToDate,
            IsActive = req.IsActive,
            OemModelId = req.OemModelId,
            CreatedById = _currentUser.UserId,
        };

        _db.ExtendedBatteryWarrantySchemes.Add(scheme);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("ExtendedBatteryWarrantyScheme.Create", "ExtendedBatteryWarrantyScheme", scheme.Id.ToString(), new { scheme.SchemeName, scheme.VehicleModel });

        return Ok(ToRow(scheme));
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, CreateExtendedBatteryWarrantySchemeRequest req)
    {
        var dealerId = _currentUser.DealerId;
        var scheme = await _db.ExtendedBatteryWarrantySchemes.FirstOrDefaultAsync(s => s.Id == id && s.DealerId == dealerId);
        if (scheme is null) return NotFound();
        if (string.IsNullOrWhiteSpace(req.SchemeName)) return BadRequest(new { message = "Scheme Name is required." });
        if (string.IsNullOrWhiteSpace(req.VehicleModel)) return BadRequest(new { message = "Vehicle Model is required." });
        if (!IsValidDurationType(req.DurationType))
            return BadRequest(new { message = "Duration Type must be Days, Months, or Years." });

        scheme.SchemeName = req.SchemeName.Trim();
        scheme.VehicleModel = req.VehicleModel.Trim();
        scheme.RateType = req.RateType;
        scheme.Duration = req.Duration;
        scheme.DurationType = req.DurationType;
        scheme.Kms = req.Kms;
        scheme.DealerPrice = req.DealerPrice;
        scheme.CustomerPrice = req.CustomerPrice;
        scheme.DiscountAmount = req.DiscountAmount;
        scheme.GstPercent = req.GstPercent;
        scheme.PurchaseValidityDays = req.PurchaseValidityDays;
        scheme.BatteryPartCode = req.BatteryPartCode;
        scheme.PartCode = req.PartCode;
        scheme.FromDate = req.FromDate;
        scheme.ToDate = req.ToDate;
        scheme.IsActive = req.IsActive;
        scheme.OemModelId = req.OemModelId;
        scheme.UpdatedById = _currentUser.UserId;
        scheme.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await _audit.LogAsync("ExtendedBatteryWarrantyScheme.Update", "ExtendedBatteryWarrantyScheme", scheme.Id.ToString(), new { scheme.SchemeName, scheme.VehicleModel });

        return Ok(ToRow(scheme));
    }

    /// <summary>DELETE - a real row removal, not a soft delete (unlike RepairBillDoc's IsDeleted
    /// pattern): schemes are pricing configuration, not a financial transaction that needs an
    /// audit-trail/undo, so this is kept simple deliberately. The global Restrict FK default
    /// (JobCardScannerDbContext.OnModelCreating's per-entity loop) means SQL itself would block
    /// deleting a scheme any RepairBillDocItem.ExtendedBatteryWarrantySchemeId still points to -
    /// that case is checked explicitly here and surfaced as a 409 rather than an unhandled 500.
    /// Use IsActive = false (via PUT) instead of deleting a scheme still referenced by past bills.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var scheme = await _db.ExtendedBatteryWarrantySchemes.FirstOrDefaultAsync(s => s.Id == id && s.DealerId == dealerId);
        if (scheme is null) return NotFound();

        var inUse = await _db.RepairBillDocItems.AnyAsync(i => i.ExtendedBatteryWarrantySchemeId == id);
        if (inUse) return Conflict(new { message = "This scheme is referenced by an existing Repair Bill line and cannot be deleted. Mark it Inactive instead." });

        _db.ExtendedBatteryWarrantySchemes.Remove(scheme);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("ExtendedBatteryWarrantyScheme.Delete", "ExtendedBatteryWarrantyScheme", scheme.Id.ToString(), new { scheme.SchemeName });

        return NoContent();
    }

    /// <summary>
    /// GET /api/extended-battery-warranty-schemes/eligible?vehicleId=&amp;vehicleModel=&amp;kms=&amp;claimDate=
    /// Implements the eligibility formula documented on ExtendedBatteryWarrantyScheme's own class
    /// comment - repeated here for convenience: a scheme is a candidate when VehicleModel matches
    /// (case-insensitive) AND the vehicle's PurchaseDate falls inside [FromDate, ToDate]; within
    /// that, a scheme is ELIGIBLE for a given claim when claimDate is on/before
    /// PurchaseDate + Duration(DurationType) AND kms is on/below the scheme's Kms cap (a Kms of 0
    /// on the scheme is treated as "no mileage cap", since 0 as a real cap would make every claim
    /// ineligible - PurchaseValidityDays is carried through on the scheme but not used here, for
    /// the same "nothing confirms what it gates" reason documented on the model.
    ///
    /// vehicleId is optional and, when supplied, pulls Model/PurchaseDate/Odometer from that
    /// JobCardScannerDb Vehicle row directly (this is how RepairBillDocsController.Create calls
    /// this internally - see that controller's own wiring comment). When vehicleId is omitted the
    /// caller must supply vehicleModel and purchaseDate itself (e.g. a pre-check before a Vehicle
    /// row exists, or from the admin scheme-list page). claimDate defaults to today; every
    /// ACTIVE scheme is returned (not just eligible ones) so the caller can show why an
    /// ineligible scheme didn't match.
    /// </summary>
    [HttpGet("eligible")]
    public async Task<IActionResult> Eligible(
        [FromQuery] Guid? vehicleId = null, [FromQuery] string? vehicleModel = null,
        [FromQuery] DateOnly? purchaseDate = null, [FromQuery] decimal? kms = null,
        [FromQuery] DateOnly? claimDate = null)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null) return Forbid();

        if (vehicleId is not null)
        {
            var vehicle = await _db.Vehicles.AsNoTracking().FirstOrDefaultAsync(v => v.Id == vehicleId && v.DealerId == dealerId);
            if (vehicle is null) return NotFound(new { message = "Vehicle not found." });
            vehicleModel = vehicle.Model;
            purchaseDate = vehicle.PurchaseDate;
            kms ??= (decimal)vehicle.Odometer;
        }

        if (string.IsNullOrWhiteSpace(vehicleModel))
            return BadRequest(new { message = "vehicleModel (or vehicleId) is required." });
        if (purchaseDate is null)
            return Ok(new { schemes = Array.Empty<ExtendedBatteryWarrantyEligibilityResult>(), reason = "No purchase date on record for this vehicle - cannot evaluate scheme eligibility." });

        var effectiveClaimDate = claimDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var effectiveKms = kms ?? 0;

        var results = await _eligibility.EvaluateAsync(
            dealerId.Value, vehicleModel, purchaseDate.Value, effectiveKms, effectiveClaimDate, HttpContext.RequestAborted);

        return Ok(new { schemes = results });
    }

    private static bool IsValidDurationType(string? durationType) =>
        durationType is "Days" or "Months" or "Years";

    private static object ToRow(ExtendedBatteryWarrantyScheme s) => new
    {
        s.Id,
        s.SchemeName,
        s.VehicleModel,
        s.RateType,
        s.Duration,
        s.DurationType,
        s.Kms,
        s.DealerPrice,
        s.CustomerPrice,
        s.DiscountAmount,
        s.GstPercent,
        s.PurchaseValidityDays,
        s.BatteryPartCode,
        s.PartCode,
        s.FromDate,
        s.ToDate,
        s.IsActive,
        s.OemModelId,
        OemModelName = s.OemModel?.ModelName,
        s.CreatedAt,
        s.UpdatedAt,
    };
}
