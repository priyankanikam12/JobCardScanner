using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

[ApiController]
[Route("api/workflow-stages")]
[Authorize(Policy = Policies.Staff)]
public class WorkflowStagesController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public WorkflowStagesController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    /// <summary>Effective stage list for a dealer: the global template (DealerId == null) overridden/extended
    /// by any dealer-specific rows with the same StageKey, ordered by Seq.</summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? dealerId)
    {
        var effectiveDealerId = dealerId ?? _currentUser.DealerId;
        var all = await _db.WorkflowStages.AsNoTracking()
            .Where(s => s.DealerId == null || s.DealerId == effectiveDealerId)
            .ToListAsync();

        var merged = all
            .GroupBy(s => s.StageKey)
            .Select(g => g.OrderByDescending(s => s.DealerId.HasValue).First()) // dealer-specific wins over global
            .Where(s => s.Active)
            .OrderBy(s => s.Seq)
            .ToList();

        return Ok(merged);
    }

    [HttpPost]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Upsert(UpsertWorkflowStageRequest req)
    {
        if (_currentUser.DealerId is null) return BadRequest(new { message = "Corporate/System admins must configure workflow via a dealer-scoped request." });

        var existing = await _db.WorkflowStages.FirstOrDefaultAsync(s => s.DealerId == _currentUser.DealerId && s.StageKey == req.StageKey);
        if (existing is null)
        {
            existing = new WorkflowStage { DealerId = _currentUser.DealerId, StageKey = req.StageKey };
            _db.WorkflowStages.Add(existing);
        }
        existing.Label = req.Label;
        existing.Seq = req.Seq;
        existing.Icon = req.Icon;
        existing.Active = req.Active;
        existing.IsTerminal = req.IsTerminal;

        await _db.SaveChangesAsync();
        await _audit.LogAsync("WorkflowStage.Upsert", "WorkflowStage", existing.Id.ToString(), req);
        return Ok(existing);
    }
}
