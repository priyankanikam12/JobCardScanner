using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// GET /api/jobcards/{id}/stage-prerequisites (2026-10-07) - tells the Job Card page's "Update Workflow Stage" card whether this job card already has a Material Transfer and a
/// Repair Bill, because "Mark Repair Completed", "Mark Ready for Delivery" and "Mark Invoice Generated" are not allowed until both exist.
///   hasMaterialTransfer : at least one Material Transfer of this job card that is not Cancelled (Draft or Confirmed).
///   hasRepairBill       : at least one Repair Bill of this job card that is not deleted / Cancelled (Proforma or Billed).
/// The stage change itself is refused by JobCardsController.ChangeStage with the same rule (see patches/jobcard-stage-gate), so this endpoint only drives the page's
/// notice and greyed-out buttons - it is not the lock. Gated Policies.Staff (the Material Transfer / Repair Bill modules are role-gated, this answers only yes / no for one job card
/// the caller can open); scoped like opening the job card: CorporateAdmin / SystemAdmin any, everyone else its own dealer and - with a Work Area - its own locations, else 404.
/// </summary>
[ApiController]
[Route("api/jobcards")]
[Authorize(Policy = Policies.Staff)]
public class JobCardStagePrerequisitesController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;

    public JobCardStagePrerequisitesController(JobCardScannerDbContext db, ICurrentUserService currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    [HttpGet("{id:guid}/stage-prerequisites")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var jc = await _db.JobCards.AsNoTracking().Where(j => j.Id == id)
            .Select(j => new { j.DealerId, j.BaplServiceLocationCode })
            .FirstOrDefaultAsync(ct);
        if (jc is null) return NotFound(new { message = "That job card no longer exists." });

        var isOrgWide = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        if (!isOrgWide)
        {
            if (_currentUser.DealerId is null || jc.DealerId != _currentUser.DealerId)
                return NotFound(new { message = "That job card no longer exists." });
            var allowed = _currentUser.WorkLocationCodes;
            if (allowed.Count > 0 && (jc.BaplServiceLocationCode is null || !allowed.Contains(jc.BaplServiceLocationCode, StringComparer.OrdinalIgnoreCase)))
                return NotFound(new { message = "That job card no longer exists." });
        }

        var hasMt = await _db.MaterialTransferDocs.AsNoTracking()
            .AnyAsync(m => m.JobCardId == id && m.Status != MaterialTransferDocStatus.Cancelled, ct);
        var hasRb = await _db.RepairBillDocs.AsNoTracking()
            .AnyAsync(r => r.JobCardId == id && !r.IsDeleted && r.Status != RepairBillDocStatus.Cancelled, ct);

        return Ok(new { hasMaterialTransfer = hasMt, hasRepairBill = hasRb });
    }
}