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
/// 2026-09-22 "this wants to integrate for my battery-warranty-schemes for link models for
/// warrenty and this all table add in jobcard db that all functionality need to craete in jc" -
/// CRUD for the new OEM Model Master (see Models/OemModels.cs for the full field-by-field
/// reasoning ported from the DMS reference's OemmodelMaster table/screens you pasted).
///
/// GLOBAL, not dealer-scoped (confirmed via AskUserQuestion) - so List/Get are gated at
/// WorkshopManagerUp (any dealer's Workshop Manager can browse this catalog to pick a model on an
/// Extended Battery Warranty Scheme) while Create/Update/Delete/SetActive are gated at the
/// stricter CorporateAdminUp, stacked on top of the controller-level policy - the same
/// "controller-level policy + a stricter one on specific actions" pattern already used by
/// ReportsController.ExportInvoices ([Authorize(Policy = Policies.CashierUp)] on an action inside
/// a controller whose own [Authorize] is Policies.Staff) elsewhere in this codebase, not a new
/// convention invented for this controller.
///
/// Direct-_db CRUD (no repo/service layer), matching ExtendedBatteryWarrantySchemesController's own
/// rationale: this table lives in JobCardScannerDb, not BAPLDMSvad/DMSBAPLDATA.
/// </summary>
[ApiController]
[Route("api/oem-models")]
[Authorize(Policy = Policies.WorkshopManagerUp)]
public class OemModelsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;
    private readonly IExcelExportService _excel;

    public OemModelsController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit, IExcelExportService excel)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _excel = excel;
    }

    /// <summary>GET /api/oem-models - the full shared catalog, newest first. `search` matches
    /// ModelName/ModelShortName (contains, case-insensitive); `isActive` optionally narrows.</summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? search = null, [FromQuery] bool? isActive = null)
    {
        var query = _db.OemModels.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(m => m.ModelName.Contains(search) || (m.ModelShortName != null && m.ModelShortName.Contains(search)));
        if (isActive is not null) query = query.Where(m => m.IsActive == isActive);

        var models = await query.OrderBy(m => m.ModelName).ToListAsync();
        return Ok(models.Select(ToRow));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var model = await _db.OemModels.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id);
        return model is null ? NotFound() : Ok(ToRow(model));
    }

    [HttpPost]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Create(CreateOemModelRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.ModelName)) return BadRequest(new { message = "Model Name is required." });

        var name = req.ModelName.Trim();
        var exists = await _db.OemModels.AsNoTracking().AnyAsync(m => m.ModelName == name);
        if (exists) return Conflict(new { message = $"A model named \"{name}\" already exists." });

        var model = new OemModel
        {
            ModelName = name,
            ModelShortName = string.IsNullOrWhiteSpace(req.ModelShortName) ? null : req.ModelShortName.Trim(),
            IsActive = req.IsActive,
            CreatedById = _currentUser.UserId,
        };

        _db.OemModels.Add(model);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("OemModel.Create", "OemModel", model.Id.ToString(), new { model.ModelName });

        return Ok(ToRow(model));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Update(Guid id, CreateOemModelRequest req)
    {
        var model = await _db.OemModels.FirstOrDefaultAsync(m => m.Id == id);
        if (model is null) return NotFound();
        if (string.IsNullOrWhiteSpace(req.ModelName)) return BadRequest(new { message = "Model Name is required." });

        var name = req.ModelName.Trim();
        var exists = await _db.OemModels.AsNoTracking().AnyAsync(m => m.ModelName == name && m.Id != id);
        if (exists) return Conflict(new { message = $"A model named \"{name}\" already exists." });

        model.ModelName = name;
        model.ModelShortName = string.IsNullOrWhiteSpace(req.ModelShortName) ? null : req.ModelShortName.Trim();
        model.IsActive = req.IsActive;
        model.UpdatedById = _currentUser.UserId;
        model.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await _audit.LogAsync("OemModel.Update", "OemModel", model.Id.ToString(), new { model.ModelName });

        return Ok(ToRow(model));
    }

    /// <summary>DELETE - blocked (409) if any ExtendedBatteryWarrantyScheme still points at this
    /// model via OemModelId (the Restrict default on that FK - see JobCardScannerDbContext), same
    /// "check explicitly, surface as 409" pattern as ExtendedBatteryWarrantySchemesController.Delete.
    /// Its own OemModelWarranty rows are NOT a blocker - that FK is Cascade (see DbContext), so they
    /// are removed along with the model, matching Customer -> Vehicles' own cascade rationale.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Delete(Guid id)
    {
        var model = await _db.OemModels.FirstOrDefaultAsync(m => m.Id == id);
        if (model is null) return NotFound();

        var inUse = await _db.ExtendedBatteryWarrantySchemes.AnyAsync(s => s.OemModelId == id);
        if (inUse) return Conflict(new { message = "This model is referenced by an existing Extended Battery Warranty Scheme and cannot be deleted. Mark it Inactive instead." });

        _db.OemModels.Remove(model);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("OemModel.Delete", "OemModel", model.Id.ToString(), new { model.ModelName });

        return NoContent();
    }

    /// <summary>GET /api/oem-models/export - Excel download, matching the reference screen's own
    /// "Download" button, via this app's existing IExcelExportService (same service/pattern as
    /// ReportsController's exports).</summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] bool? isActive = null)
    {
        var query = _db.OemModels.AsNoTracking().AsQueryable();
        if (isActive is not null) query = query.Where(m => m.IsActive == isActive);
        var rows = await query.OrderBy(m => m.ModelName).ToListAsync();

        var headers = new[] { "Model Name", "Model Short Name", "Active", "Created At" };
        var data = rows.Select(m => (IReadOnlyList<object?>)new object?[]
        {
            m.ModelName, m.ModelShortName, m.IsActive ? "Yes" : "No", m.CreatedAt,
        }).ToList();

        var bytes = _excel.Export("OEM Models", headers, data);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "oem-models.xlsx");
    }

    private static object ToRow(OemModel m) => new
    {
        m.Id,
        m.ModelName,
        m.ModelShortName,
        m.IsActive,
        m.CreatedAt,
        m.UpdatedAt,
    };
}
