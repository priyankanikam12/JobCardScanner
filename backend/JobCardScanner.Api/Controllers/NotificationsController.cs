using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>Admin visibility into every customer communication the mock notification client
/// has sent (or failed to send) - SMS/WhatsApp/Email/Push log with delivery status.</summary>
[ApiController]
[Route("api/notifications")]
[Authorize(Policy = Policies.WorkshopManagerUp)]
public class NotificationsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    public NotificationsController(JobCardScannerDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? jobCardId, [FromQuery] Guid? customerId)
    {
        var query = _db.NotificationRecords.AsNoTracking().AsQueryable();
        if (jobCardId.HasValue) query = query.Where(n => n.JobCardId == jobCardId);
        if (customerId.HasValue) query = query.Where(n => n.CustomerId == customerId);

        var records = await query.OrderByDescending(n => n.CreatedAt).Take(300).ToListAsync();
        return Ok(records);
    }

    [HttpGet("templates")]
    public async Task<IActionResult> Templates() => Ok(await _db.NotificationTemplates.AsNoTracking().ToListAsync());
}
