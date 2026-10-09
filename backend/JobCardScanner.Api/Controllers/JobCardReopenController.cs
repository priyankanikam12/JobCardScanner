using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// POST /api/jobcards/{id}/reopen { reason } (2026-10-09, "we delete this material transfer and repair bill and reopen jobcard ... and we can create mt and repair bill").
/// Puts a CLOSED job card back to work so its Material Transfer and Repair Bill can be created again. CorporateAdmin / SystemAdmin only (a closed job card is a finished record).
/// Rules:
///   * the job card must be Closed;
///   * it must not still have a live Repair Bill saved as Invoice (Billed, not deleted) - that bill is what closed it; delete (or cancel) that bill first, otherwise the job card would simply
///     close again with nothing to show for it;
///   * Status goes back to InProgress (Open when no work was ever logged on it), ClosedAt / ActualDeliveryAt are cleared;
///   * the workflow goes back to "Estimate Created" - the stage just before Repair Completed - so the Material Transfer + Repair Bill step is open again; the open stage-history row is
///     closed and a new one is added with the reason, so the history grid shows who reopened it and why.
/// It does NOT touch stock: Part Upload quantities are restored by the Material Transfer / Repair Bill delete itself (see their Delete actions). Check the balances after deleting.
/// </summary>
[ApiController]
[Route("api/jobcards")]
[Authorize(Policy = Policies.CorporateAdminUp)]
public class JobCardReopenController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;
    private readonly ILogger<JobCardReopenController> _logger;

    public JobCardReopenController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit, ILogger<JobCardReopenController> logger)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _logger = logger;
    }

    public record ReopenJobCardRequest(string? Reason);

    [HttpPost("{id:guid}/reopen")]
    public async Task<IActionResult> Reopen(Guid id, [FromBody] ReopenJobCardRequest? req, CancellationToken ct)
    {
        var jc = await _db.JobCards.Include(j => j.StageHistory).FirstOrDefaultAsync(j => j.Id == id, ct);
        if (jc is null) return NotFound(new { message = "That job card no longer exists." });
        if (jc.Status != JobCardStatus.Closed)
            return BadRequest(new { message = $"Only a Closed job card can be reopened - this one is {jc.Status}." });

        var liveInvoice = await _db.RepairBillDocs.AsNoTracking()
            .Where(r => r.JobCardId == id && !r.IsDeleted && r.Status == RepairBillDocStatus.Billed)
            .Select(r => r.BillNumber).FirstOrDefaultAsync(ct);
        if (liveInvoice is not null)
            return BadRequest(new { message = $"Repair Bill {liveInvoice} is still saved as Invoice for this job card - delete it first, then reopen the job card." });

        // the stage just before Repair Completed; a dealer-specific stage wins over the global one
        var stage = await _db.WorkflowStages.AsNoTracking()
            .Where(s => (s.DealerId == null || s.DealerId == jc.DealerId) && s.Active && s.StageKey == "estimate_created")
            .OrderByDescending(s => s.DealerId != null)
            .FirstOrDefaultAsync(ct);
        stage ??= await _db.WorkflowStages.AsNoTracking()
            .Where(s => (s.DealerId == null || s.DealerId == jc.DealerId) && s.Active && s.StageKey == "in_repair")
            .OrderByDescending(s => s.DealerId != null)
            .FirstOrDefaultAsync(ct);

        var hadWork = await _db.JobCardWorklogs.AsNoTracking().AnyAsync(w => w.JobCardId == id, ct);
        var reason = string.IsNullOrWhiteSpace(req?.Reason) ? "No reason given" : req!.Reason!.Trim();
        var now = DateTime.UtcNow;

        try
        {
            jc.Status = hadWork ? JobCardStatus.InProgress : JobCardStatus.Open;
            jc.ClosedAt = null;
            jc.ActualDeliveryAt = null;
            jc.UpdatedAt = now;

            if (stage is not null)
            {
                foreach (var open in jc.StageHistory.Where(h => h.ExitedAt == null)) open.ExitedAt = now;
                var entry = new JobCardStageHistory { JobCardId = jc.Id, StageId = stage.Id, ChangedById = _currentUser.UserId, Notes = $"Reopened: {reason}" };
                _db.JobCardStageHistories.Add(entry);
                jc.CurrentStageId = stage.Id;
            }

            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Could not reopen job card {JobCardId}.", id);
            return StatusCode(500, new { message = $"Could not reopen the job card: {ex.GetBaseException().Message}" });
        }

        try { await _audit.LogAsync("JobCard.Reopen", "JobCard", jc.Id.ToString(), new { jc.JobCardNumber, reason }); }
        catch (Exception ex) { _logger.LogWarning(ex, "Audit entry for JobCard.Reopen could not be written."); }

        return Ok(new { jc.Id, jc.JobCardNumber, Status = jc.Status.ToString(), stage = stage?.Label });
    }
}