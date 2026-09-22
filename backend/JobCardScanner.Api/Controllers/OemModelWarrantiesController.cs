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
/// 2026-09-22 - CRUD for the new OEM Model Warranty master (see Models/OemModels.cs for the full
/// field-by-field reasoning ported from the BAPL DMS reference's OemmodelWarranty table/screens
/// you pasted, including the EffectiveDate-must-be-after-the-model's-last-EffectiveDate rule this
/// controller enforces server-side).
///
/// Same GLOBAL scope and split authorization as OemModelsController (List/Get at
/// WorkshopManagerUp, Create/Update/Delete at the stricter CorporateAdminUp) - a model's standard
/// warranty terms feed eligibility for every dealer alike, so they're centrally governed the same
/// way the model catalog itself is.
/// </summary>
[ApiController]
[Route("api/oem-model-warranties")]
[Authorize(Policy = Policies.WorkshopManagerUp)]
public class OemModelWarrantiesController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;
    private readonly IExcelExportService _excel;

    public OemModelWarrantiesController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit, IExcelExportService excel)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _excel = excel;
    }

    /// <summary>GET /api/oem-model-warranties - optionally narrowed by oemModelId and/or an
    /// EffectiveDate [from, to] range (matching the reference screen's own date-range filter).
    /// Newest EffectiveDate first, capped at 2000 rows (this app has no established pagination
    /// convention on any other master list - see e.g. ReportsController's own Take(5000) exports -
    /// so a generous cap is used instead of inventing one here).</summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] Guid? oemModelId = null, [FromQuery] DateOnly? effectiveFrom = null,
        [FromQuery] DateOnly? effectiveTo = null)
    {
        var query = _db.OemModelWarranties.AsNoTracking().Include(w => w.OemModel).AsQueryable();
        if (oemModelId is not null) query = query.Where(w => w.OemModelId == oemModelId);
        if (effectiveFrom is not null) query = query.Where(w => w.EffectiveDate >= effectiveFrom);
        if (effectiveTo is not null) query = query.Where(w => w.EffectiveDate <= effectiveTo);

        var rows = await query.OrderByDescending(w => w.EffectiveDate).Take(2000).ToListAsync();
        return Ok(rows.Select(ToRow));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var row = await _db.OemModelWarranties.AsNoTracking().Include(w => w.OemModel).FirstOrDefaultAsync(w => w.Id == id);
        return row is null ? NotFound() : Ok(ToRow(row));
    }

    [HttpPost]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Create(CreateOemModelWarrantyRequest req)
    {
        var modelExists = await _db.OemModels.AsNoTracking().AnyAsync(m => m.Id == req.OemModelId);
        if (!modelExists) return BadRequest(new { message = "OEM Model not found." });
        if (!IsValidDurationType(req.DurationType))
            return BadRequest(new { message = "Duration Type must be Months or Years (or left blank)." });

        var minError = await ValidateEffectiveDateAsync(req.OemModelId, req.EffectiveDate, excludeId: null);
        if (minError is not null) return BadRequest(new { message = minError });

        var warranty = new OemModelWarranty
        {
            OemModelId = req.OemModelId,
            EffectiveDate = req.EffectiveDate,
            OdoReading = req.OdoReading,
            DurationType = req.DurationType,
            Duration = req.Duration,
            IsB2b = req.IsB2b,
            CreatedById = _currentUser.UserId,
        };

        _db.OemModelWarranties.Add(warranty);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("OemModelWarranty.Create", "OemModelWarranty", warranty.Id.ToString(), new { warranty.OemModelId, warranty.EffectiveDate });

        var saved = await _db.OemModelWarranties.AsNoTracking().Include(w => w.OemModel).FirstAsync(w => w.Id == warranty.Id);
        return Ok(ToRow(saved));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Update(Guid id, CreateOemModelWarrantyRequest req)
    {
        var warranty = await _db.OemModelWarranties.FirstOrDefaultAsync(w => w.Id == id);
        if (warranty is null) return NotFound();

        var modelExists = await _db.OemModels.AsNoTracking().AnyAsync(m => m.Id == req.OemModelId);
        if (!modelExists) return BadRequest(new { message = "OEM Model not found." });
        if (!IsValidDurationType(req.DurationType))
            return BadRequest(new { message = "Duration Type must be Months or Years (or left blank)." });

        var minError = await ValidateEffectiveDateAsync(req.OemModelId, req.EffectiveDate, excludeId: id);
        if (minError is not null) return BadRequest(new { message = minError });

        warranty.OemModelId = req.OemModelId;
        warranty.EffectiveDate = req.EffectiveDate;
        warranty.OdoReading = req.OdoReading;
        warranty.DurationType = req.DurationType;
        warranty.Duration = req.Duration;
        warranty.IsB2b = req.IsB2b;
        warranty.UpdatedById = _currentUser.UserId;
        warranty.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await _audit.LogAsync("OemModelWarranty.Update", "OemModelWarranty", warranty.Id.ToString(), new { warranty.OemModelId, warranty.EffectiveDate });

        var saved = await _db.OemModelWarranties.AsNoTracking().Include(w => w.OemModel).FirstAsync(w => w.Id == warranty.Id);
        return Ok(ToRow(saved));
    }

    /// <summary>DELETE - real row removal, matching the reference's own delete action. Nothing else
    /// in this app FKs to OemModelWarranty, so no in-use check is needed (unlike OemModel/
    /// ExtendedBatteryWarrantyScheme's deletes).</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Delete(Guid id)
    {
        var warranty = await _db.OemModelWarranties.FirstOrDefaultAsync(w => w.Id == id);
        if (warranty is null) return NotFound();

        _db.OemModelWarranties.Remove(warranty);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("OemModelWarranty.Delete", "OemModelWarranty", warranty.Id.ToString(), new { warranty.OemModelId });

        return NoContent();
    }

    /// <summary>GET /api/oem-model-warranties/export - Excel download, matching the reference
    /// screen's own "Download" button.</summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export(
        [FromQuery] Guid? oemModelId = null, [FromQuery] DateOnly? effectiveFrom = null, [FromQuery] DateOnly? effectiveTo = null)
    {
        var query = _db.OemModelWarranties.AsNoTracking().Include(w => w.OemModel).AsQueryable();
        if (oemModelId is not null) query = query.Where(w => w.OemModelId == oemModelId);
        if (effectiveFrom is not null) query = query.Where(w => w.EffectiveDate >= effectiveFrom);
        if (effectiveTo is not null) query = query.Where(w => w.EffectiveDate <= effectiveTo);

        var rows = await query.OrderByDescending(w => w.EffectiveDate).Take(2000).ToListAsync();
        var headers = new[] { "Model", "Effective Date", "Odo Reading", "Duration", "Duration Type", "B2B" };
        var data = rows.Select(w => (IReadOnlyList<object?>)new object?[]
        {
            w.OemModel?.ModelName, w.EffectiveDate, w.OdoReading, w.Duration, w.DurationType, w.IsB2b == true ? "Yes" : "No",
        }).ToList();

        var bytes = _excel.Export("OEM Model Warranties", headers, data);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "oem-model-warranties.xlsx");
    }

    /// <summary>Ported business rule (see OemModelWarranty's own doc comment): EffectiveDate must
    /// be strictly after this model's most recent OTHER existing EffectiveDate. Returns a
    /// human-readable error message, or null when the date is acceptable.</summary>
    private async Task<string?> ValidateEffectiveDateAsync(Guid oemModelId, DateOnly effectiveDate, Guid? excludeId)
    {
        var lastQuery = _db.OemModelWarranties.AsNoTracking().Where(w => w.OemModelId == oemModelId);
        if (excludeId is not null) lastQuery = lastQuery.Where(w => w.Id != excludeId);

        var lastEffectiveDate = await lastQuery.OrderByDescending(w => w.EffectiveDate).Select(w => (DateOnly?)w.EffectiveDate).FirstOrDefaultAsync();
        if (lastEffectiveDate is not null && effectiveDate <= lastEffectiveDate)
            return $"Effective Date must be after this model's most recent warranty term ({lastEffectiveDate.Value:dd.MM.yyyy}).";

        return null;
    }

    private static bool IsValidDurationType(string? durationType) =>
        durationType is null or "Months" or "Years";

    private static object ToRow(OemModelWarranty w) => new
    {
        w.Id,
        w.OemModelId,
        OemModelName = w.OemModel?.ModelName,
        w.EffectiveDate,
        w.OdoReading,
        w.DurationType,
        w.Duration,
        w.IsB2b,
        w.CreatedAt,
        w.UpdatedAt,
    };
}
