using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Services;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// SECTION 163 (2026-09-30) - read API for the new Service Menu Master (Job Type -&gt; Service
/// Head -&gt; Priority cascade) - see Models/ServiceMenuMaster.cs for the full field reasoning and
/// the flagged Assumption on Priority's data shape.
///
/// Gated to Policies.Staff (any authenticated staff role) for the read (GET) endpoints - the same
/// as the wizard itself: every role that can open the Job Card Wizard needs to read these
/// dropdowns, and the hardcoded serviceCatalog.ts data it replaces was never role-restricted
/// either.
///
/// ALL() returns the full active list in one call - both web and mobile derive their three
/// cascading dropdowns from it client-side (mirroring the existing serviceHeadsForJobType()
/// helper), the same shape the hardcoded catalog produced, so this is a drop-in data-source swap,
/// not a rewrite of the wizard's own dropdown logic. job-types/service-heads/priorities below are
/// provided as convenience server-side equivalents in case either app prefers to call the API
/// again on each cascade step instead of filtering the full list locally.
///
/// UPDATE - SECTION 166 (2026-09-30) "for this 3 master create edit delete access ?": added
/// POST/PUT/DELETE below, gated to Policies.WorkshopManagerUp - the SAME role floor already used
/// to gate who can even SEE this master's sidebar page (StaffLayout.tsx: WorkshopManager,
/// DealerAdmin, CorporateAdmin, SystemAdmin). FLAGGED (Fact worth your attention, not something I
/// silently narrowed): this table is a single GLOBAL list shared by every dealer's Job Card Wizard
/// - a WorkshopManager or DealerAdmin editing a row here changes what EVERY dealer sees in their
/// wizard's dropdowns, not just their own dealer. If you'd rather only CorporateAdmin/SystemAdmin
/// be able to write (leaving WorkshopManager/DealerAdmin able to only view), tell me and I'll
/// tighten [Authorize] on the three write actions below to Policies.CorporateAdminOnly - it's a
/// one-line change.
///
/// DELETE is a SOFT delete (sets IsActive=false) - the row is hidden from GET All()/dropdowns
/// immediately but the data is not destroyed, so it's reversible by editing IsActive back to true
/// (there is no separate "reactivate" endpoint - use PUT with isActive=true). Chose this over a
/// hard SQL DELETE per the org's "make safe reversible changes" rule; tell me if you actually want
/// a permanent hard delete instead.
///
/// EDIT SCOPE NOTE (flagged): PUT edits ONE row only. JobTypeName/ServiceHeadName are denormalized
/// onto every row that shares the same JobTypeId/ServiceHeadId (this table is deliberately flat,
/// not normalized into separate JobType/ServiceHead tables - see the Model's doc comment). Editing
/// one row's JobTypeName does NOT cascade to other rows sharing that JobTypeId - if "Accidental"
/// (JobTypeId 1) appears in 5 rows and you rename it on one row, the other 4 will still show the
/// old name until you edit them too. Kept this way deliberately (a single-row edit should not
/// silently mass-edit unrelated rows) but flagging so you don't populate inconsistent names by
/// accident.
/// </summary>
[ApiController]
[Route("api/service-menu-master")]
[Authorize(Policy = Policies.Staff)]
public class ServiceMenuMasterController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public ServiceMenuMasterController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public record ServiceMenuRow(Guid Id, int JobTypeId, string JobTypeName, int ServiceHeadId, string ServiceHeadName, string PriorityValue, string PriorityLabel, int SortOrder, bool IsActive);
    public record JobTypeRow(int Id, string Name);
    public record ServiceHeadRow(int Id, string Name);
    public record PriorityRow(string Value, string Label);
    public record CreateServiceMenuRequest(int JobTypeId, string JobTypeName, int ServiceHeadId, string ServiceHeadName, string PriorityValue, string PriorityLabel, int SortOrder);
    public record UpdateServiceMenuRequest(int JobTypeId, string JobTypeName, int ServiceHeadId, string ServiceHeadName, string PriorityValue, string PriorityLabel, int SortOrder, bool IsActive);

    /// <summary>Full active flat list, ordered the same way the hardcoded catalog was (SortOrder
    /// then name) - the recommended single call for both web and mobile.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ServiceMenuRow>>> All(CancellationToken ct)
    {
        var rows = await _db.ServiceMenuMasters.AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.JobTypeName).ThenBy(x => x.ServiceHeadName).ThenBy(x => x.SortOrder)
            .Select(x => new ServiceMenuRow(x.Id, x.JobTypeId, x.JobTypeName, x.ServiceHeadId, x.ServiceHeadName, x.PriorityValue, x.PriorityLabel, x.SortOrder, x.IsActive))
            .ToListAsync(ct);
        return Ok(rows);
    }

    /// <summary>SECTION 166 - same as All() but includes deactivated (IsActive=false) rows too, so
    /// the admin CRUD page can show/reactivate them. Same role floor as the write actions
    /// (Policies.WorkshopManagerUp) - not exposed to the plain wizard-reading call above.</summary>
    [HttpGet("admin-list")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<ActionResult<IReadOnlyList<ServiceMenuRow>>> AdminList(CancellationToken ct)
    {
        var rows = await _db.ServiceMenuMasters.AsNoTracking()
            .OrderBy(x => x.SortOrder).ThenBy(x => x.JobTypeName).ThenBy(x => x.ServiceHeadName)
            .Select(x => new ServiceMenuRow(x.Id, x.JobTypeId, x.JobTypeName, x.ServiceHeadId, x.ServiceHeadName, x.PriorityValue, x.PriorityLabel, x.SortOrder, x.IsActive))
            .ToListAsync(ct);
        return Ok(rows);
    }

    [HttpGet("job-types")]
    public async Task<ActionResult<IReadOnlyList<JobTypeRow>>> JobTypes(CancellationToken ct)
    {
        var rows = await _db.ServiceMenuMasters.AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => new { x.JobTypeId, x.JobTypeName, x.SortOrder })
            .Distinct()
            .OrderBy(x => x.SortOrder).ThenBy(x => x.JobTypeName)
            .Select(x => new JobTypeRow(x.JobTypeId, x.JobTypeName))
            .ToListAsync(ct);
        return Ok(rows);
    }

    [HttpGet("service-heads/{jobTypeId:int}")]
    public async Task<ActionResult<IReadOnlyList<ServiceHeadRow>>> ServiceHeads(int jobTypeId, CancellationToken ct)
    {
        var rows = await _db.ServiceMenuMasters.AsNoTracking()
            .Where(x => x.IsActive && x.JobTypeId == jobTypeId)
            .Select(x => new { x.ServiceHeadId, x.ServiceHeadName, x.SortOrder })
            .Distinct()
            .OrderBy(x => x.SortOrder).ThenBy(x => x.ServiceHeadName)
            .Select(x => new ServiceHeadRow(x.ServiceHeadId, x.ServiceHeadName))
            .ToListAsync(ct);
        return Ok(rows);
    }

    [HttpGet("priorities")]
    public async Task<ActionResult<IReadOnlyList<PriorityRow>>> Priorities([FromQuery] int jobTypeId, [FromQuery] int serviceHeadId, CancellationToken ct)
    {
        var rows = await _db.ServiceMenuMasters.AsNoTracking()
            .Where(x => x.IsActive && x.JobTypeId == jobTypeId && x.ServiceHeadId == serviceHeadId)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.PriorityLabel)
            .Select(x => new PriorityRow(x.PriorityValue, x.PriorityLabel))
            .ToListAsync(ct);
        return Ok(rows);
    }

    /// <summary>SECTION 166 - add one new (Job Type, Service Head, Priority) combination row.</summary>
    [HttpPost]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Create([FromBody] CreateServiceMenuRequest req, CancellationToken ct)
    {
        var jobTypeName = req.JobTypeName?.Trim();
        var serviceHeadName = req.ServiceHeadName?.Trim();
        var priorityValue = req.PriorityValue?.Trim();
        var priorityLabel = req.PriorityLabel?.Trim();
        if (string.IsNullOrWhiteSpace(jobTypeName) || string.IsNullOrWhiteSpace(serviceHeadName) ||
            string.IsNullOrWhiteSpace(priorityValue) || string.IsNullOrWhiteSpace(priorityLabel))
        {
            return BadRequest(new { message = "Job Type Name, Service Head Name, Priority Value and Priority Label are all required." });
        }

        var entity = new ServiceMenuMaster
        {
            JobTypeId = req.JobTypeId,
            JobTypeName = jobTypeName,
            ServiceHeadId = req.ServiceHeadId,
            ServiceHeadName = serviceHeadName,
            PriorityValue = priorityValue,
            PriorityLabel = priorityLabel,
            SortOrder = req.SortOrder,
            IsActive = true,
            CreatedById = _currentUser.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.ServiceMenuMasters.Add(entity);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict(new { message = "A row with this exact Job Type + Service Head + Priority combination already exists." });
        }

        await _audit.LogAsync("ServiceMenuMaster.Create", "ServiceMenuMaster", entity.Id.ToString(),
            new { entity.JobTypeId, entity.JobTypeName, entity.ServiceHeadId, entity.ServiceHeadName, entity.PriorityValue, entity.PriorityLabel });

        return Ok(new ServiceMenuRow(entity.Id, entity.JobTypeId, entity.JobTypeName, entity.ServiceHeadId, entity.ServiceHeadName, entity.PriorityValue, entity.PriorityLabel, entity.SortOrder, entity.IsActive));
    }

    /// <summary>SECTION 166 - edit one row's own fields. See class doc comment's "EDIT SCOPE NOTE"
    /// - this does not cascade JobTypeName/ServiceHeadName changes to other rows sharing the same
    /// JobTypeId/ServiceHeadId.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateServiceMenuRequest req, CancellationToken ct)
    {
        var entity = await _db.ServiceMenuMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null) return NotFound(new { message = "That Service Menu Master row no longer exists." });

        var jobTypeName = req.JobTypeName?.Trim();
        var serviceHeadName = req.ServiceHeadName?.Trim();
        var priorityValue = req.PriorityValue?.Trim();
        var priorityLabel = req.PriorityLabel?.Trim();
        if (string.IsNullOrWhiteSpace(jobTypeName) || string.IsNullOrWhiteSpace(serviceHeadName) ||
            string.IsNullOrWhiteSpace(priorityValue) || string.IsNullOrWhiteSpace(priorityLabel))
        {
            return BadRequest(new { message = "Job Type Name, Service Head Name, Priority Value and Priority Label are all required." });
        }

        entity.JobTypeId = req.JobTypeId;
        entity.JobTypeName = jobTypeName;
        entity.ServiceHeadId = req.ServiceHeadId;
        entity.ServiceHeadName = serviceHeadName;
        entity.PriorityValue = priorityValue;
        entity.PriorityLabel = priorityLabel;
        entity.SortOrder = req.SortOrder;
        entity.IsActive = req.IsActive;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict(new { message = "Another row already uses this exact Job Type + Service Head + Priority combination." });
        }

        await _audit.LogAsync("ServiceMenuMaster.Update", "ServiceMenuMaster", entity.Id.ToString(),
            new { entity.JobTypeId, entity.JobTypeName, entity.ServiceHeadId, entity.ServiceHeadName, entity.PriorityValue, entity.PriorityLabel, entity.IsActive });

        return Ok(new ServiceMenuRow(entity.Id, entity.JobTypeId, entity.JobTypeName, entity.ServiceHeadId, entity.ServiceHeadName, entity.PriorityValue, entity.PriorityLabel, entity.SortOrder, entity.IsActive));
    }

    /// <summary>SECTION 166 - SOFT delete (IsActive=false) - see class doc comment for why. Use
    /// PUT with isActive=true on the same row to reverse this.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var entity = await _db.ServiceMenuMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null) return NotFound(new { message = "That Service Menu Master row no longer exists." });

        entity.IsActive = false;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("ServiceMenuMaster.Deactivate", "ServiceMenuMaster", entity.Id.ToString(), new { entity.JobTypeName, entity.ServiceHeadName, entity.PriorityLabel });

        return Ok();
    }
}
