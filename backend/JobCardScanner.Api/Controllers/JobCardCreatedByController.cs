using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// POST /api/jobcards/created-by { ids: [jobCardId, ...] } (2026-10-12, "on systemadmin and corporateadmin login the job card list shows who created the job card"): returns, for the job cards
/// on the list page, the name of the user who created each one (JobCard.CreatedById -> Users.Name), so the list can show a "Created By" column to CorporateAdmin / SystemAdmin.
/// It is a separate small endpoint (not a field of the list response) so the list itself is untouched; it is POST because a page of job card ids does not fit a URL. At most 1000 ids per call.
/// CorporateAdmin / SystemAdmin only. A job card with no recorded creator (or one whose user row no longer exists) comes back with createdByName null.
/// </summary>
[ApiController]
[Route("api/jobcards")]
[Authorize(Policy = Policies.CorporateAdminUp)]
public class JobCardCreatedByController : ControllerBase
{
    private const int MaxIds = 1000;
    private readonly JobCardScannerDbContext _db;

    public JobCardCreatedByController(JobCardScannerDbContext db) { _db = db; }

    public record CreatedByRequest(List<Guid>? Ids);

    [HttpPost("created-by")]
    public async Task<IActionResult> Lookup([FromBody] CreatedByRequest req, CancellationToken ct)
    {
        var ids = (req.Ids ?? new List<Guid>()).Distinct().Take(MaxIds).ToList();
        if (ids.Count == 0) return Ok(Array.Empty<object>());

        var jobs = await _db.JobCards.AsNoTracking()
            .Where(j => ids.Contains(j.Id))
            .Select(j => new { j.Id, CreatedById = (Guid?)j.CreatedById })
            .ToListAsync(ct);

        var userIds = jobs.Where(j => j.CreatedById != null).Select(j => j.CreatedById!.Value).Distinct().ToList();
        var names = userIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id)).Select(u => new { u.Id, u.Name }).ToDictionaryAsync(u => u.Id, u => u.Name, ct);

        return Ok(jobs.Select(j => new
        {
            id = j.Id,
            createdByName = j.CreatedById is Guid uid && names.TryGetValue(uid, out var n) ? n : null,
        }));
    }
}