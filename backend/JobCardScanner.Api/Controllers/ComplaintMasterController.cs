using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Services;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// SECTION 163 (2026-09-30) - read API for the new Complaint Master, a single shared global
/// list (per your answer - no DealerId scoping, see Models/ComplaintMaster.cs). Replaces
/// serviceCatalog.ts's hardcoded COMPLAINTS array (web) and the live GET /api/bapl-dms/complaints
/// call (mobile) - you explicitly confirmed complaints must come from this master table, not be
/// hardcoded, in either app.
///
/// UPDATE - SECTION 166 (2026-09-30) "for this 3 master create edit delete access ?": added
/// POST/PUT/DELETE below, gated to Policies.WorkshopManagerUp - same role floor as the sidebar page
/// itself. This is a GLOBAL shared list (no DealerId) - anyone with write access here changes what
/// every dealer's Job Card Wizard shows, same flag as ServiceMenuMasterController. DELETE is a SOFT
/// delete (IsActive=false, reversible via PUT isActive=true) - see that controller's doc comment
/// for the same reasoning, not repeated here.
/// </summary>
[ApiController]
[Route("api/complaint-master")]
[Authorize(Policy = Policies.Staff)]
public class ComplaintMasterController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public ComplaintMasterController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public record ComplaintRow(Guid Id, string ComplaintText, int SortOrder, bool IsActive);
    public record CreateComplaintRequest(string ComplaintText, int SortOrder);
    public record UpdateComplaintRequest(string ComplaintText, int SortOrder, bool IsActive);

    /// <summary>Unchanged response shape from SECTION 163 (id + complaintText only) - the wizard's
    /// existing consumer code only ever read those two fields, so adding SortOrder/IsActive to this
    /// record did not need a frontend change here.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ComplaintRow>>> All(CancellationToken ct)
    {
        var rows = await _db.ComplaintMasters.AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.ComplaintText)
            .Select(x => new ComplaintRow(x.Id, x.ComplaintText, x.SortOrder, x.IsActive))
            .ToListAsync(ct);
        return Ok(rows);
    }

    /// <summary>SECTION 166 - includes deactivated rows too, for the admin CRUD page. Same role
    /// floor as the write actions.</summary>
    [HttpGet("admin-list")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<ActionResult<IReadOnlyList<ComplaintRow>>> AdminList(CancellationToken ct)
    {
        var rows = await _db.ComplaintMasters.AsNoTracking()
            .OrderBy(x => x.SortOrder).ThenBy(x => x.ComplaintText)
            .Select(x => new ComplaintRow(x.Id, x.ComplaintText, x.SortOrder, x.IsActive))
            .ToListAsync(ct);
        return Ok(rows);
    }

    [HttpPost]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Create([FromBody] CreateComplaintRequest req, CancellationToken ct)
    {
        var text = req.ComplaintText?.Trim();
        if (string.IsNullOrWhiteSpace(text)) return BadRequest(new { message = "Complaint text is required." });

        var entity = new ComplaintMaster
        {
            ComplaintText = text,
            SortOrder = req.SortOrder,
            IsActive = true,
            CreatedById = _currentUser.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.ComplaintMasters.Add(entity);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("ComplaintMaster.Create", "ComplaintMaster", entity.Id.ToString(), new { entity.ComplaintText });

        return Ok(new ComplaintRow(entity.Id, entity.ComplaintText, entity.SortOrder, entity.IsActive));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateComplaintRequest req, CancellationToken ct)
    {
        var entity = await _db.ComplaintMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null) return NotFound(new { message = "That complaint no longer exists." });

        var text = req.ComplaintText?.Trim();
        if (string.IsNullOrWhiteSpace(text)) return BadRequest(new { message = "Complaint text is required." });

        entity.ComplaintText = text;
        entity.SortOrder = req.SortOrder;
        entity.IsActive = req.IsActive;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("ComplaintMaster.Update", "ComplaintMaster", entity.Id.ToString(), new { entity.ComplaintText, entity.IsActive });

        return Ok(new ComplaintRow(entity.Id, entity.ComplaintText, entity.SortOrder, entity.IsActive));
    }

    /// <summary>SOFT delete (IsActive=false) - reversible via PUT isActive=true.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var entity = await _db.ComplaintMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null) return NotFound(new { message = "That complaint no longer exists." });

        entity.IsActive = false;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("ComplaintMaster.Deactivate", "ComplaintMaster", entity.Id.ToString(), new { entity.ComplaintText });

        return Ok();
    }
}
