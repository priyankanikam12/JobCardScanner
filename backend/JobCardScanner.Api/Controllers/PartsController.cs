using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using JobCardScanner.Api.Services.Integrations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

[ApiController]
[Route("api")]
[Authorize(Policy = Policies.Staff)]
public class PartsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IDmsClient _dms;
    private readonly IAuditLogService _audit;

    public PartsController(JobCardScannerDbContext db, ICurrentUserService currentUser, IDmsClient dms, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _dms = dms;
        _audit = audit;
    }

    [HttpGet("parts")]
    public async Task<IActionResult> Search([FromQuery] string? q)
    {
        var query = _db.PartMasters.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(q))
            query = query.Where(p => p.Name.Contains(q) || p.PartNumber.Contains(q) || (p.Category != null && p.Category.Contains(q)));
        return Ok(await query.OrderBy(p => p.Name).Take(100).ToListAsync());
    }

    [HttpGet("parts/{partNumber}/network-availability")]
    public async Task<IActionResult> NetworkAvailability(string partNumber) =>
        Ok(await _dms.CheckNetworkAvailabilityAsync(partNumber));

    [HttpPost("jobcards/{jobCardId:guid}/parts")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> RequestPart(Guid jobCardId, RequestPartRequest req)
    {
        var part = await _db.PartMasters.FirstOrDefaultAsync(p => p.Id == req.PartId);
        if (part is null) return NotFound(new { message = "Part not found." });
        if (!await _db.JobCards.AnyAsync(j => j.Id == jobCardId)) return NotFound(new { message = "Job card not found." });

        var jcPart = new JobCardPart
        {
            JobCardId = jobCardId,
            PartId = req.PartId,
            Quantity = req.Quantity,
            UnitPrice = part.UnitPrice,
            Amount = part.UnitPrice * (decimal)req.Quantity,
            Status = JobCardPartStatus.Requested,
            RequestedById = _currentUser.UserId,
        };
        _db.JobCardParts.Add(jcPart);
        await _db.SaveChangesAsync();
        return Ok(jcPart);
    }

    [HttpPost("jobcard-parts/{id:guid}/issue")]
    [Authorize(Policy = Policies.PartsUserUp)]
    public async Task<IActionResult> Issue(Guid id)
    {
        var jcPart = await _db.JobCardParts.Include(p => p.Part).FirstOrDefaultAsync(p => p.Id == id);
        if (jcPart is null) return NotFound();
        if (jcPart.Part is null) return BadRequest();
        if (jcPart.Part.StockQty < jcPart.Quantity)
            return BadRequest(new { message = "Insufficient stock to issue this quantity." });

        jcPart.Part.StockQty -= (int)jcPart.Quantity;
        jcPart.Status = JobCardPartStatus.Issued;
        jcPart.IssuedById = _currentUser.UserId;
        jcPart.IssuedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("JobCardPart.Issue", "JobCardPart", jcPart.Id.ToString());
        return Ok(jcPart);
    }

    [HttpPost("jobcard-parts/{id:guid}/return")]
    [Authorize(Policy = Policies.PartsUserUp)]
    public async Task<IActionResult> Return(Guid id)
    {
        var jcPart = await _db.JobCardParts.Include(p => p.Part).FirstOrDefaultAsync(p => p.Id == id);
        if (jcPart is null) return NotFound();
        if (jcPart.Status == JobCardPartStatus.Issued && jcPart.Part is not null)
            jcPart.Part.StockQty += (int)jcPart.Quantity;
        jcPart.Status = JobCardPartStatus.Returned;
        await _db.SaveChangesAsync();
        return Ok(jcPart);
    }
}
