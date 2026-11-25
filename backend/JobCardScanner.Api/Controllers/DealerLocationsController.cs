using System.Text.RegularExpressions;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-11-25: the dealer workshop locations synced from the ERP (see Services/DealerLocationSyncService.cs).
/// GET  /api/dealer-locations?dealerId=&amp;includeInactive=  any signed-in staff. A dealer login always gets its OWN dealer's locations (dealerId is ignored);
///                                                          Corporate / System Admin may pass a dealerId, or none for every dealer. Answers locCode / locName so it can replace
///                                                          /api/bapl-dms/workshops wherever a workshop list is needed.
/// POST /api/dealer-locations/sync                          Corporate / System Admin: run the ERP sync now.
/// </summary>
[ApiController]
[Route("api/dealer-locations")]
[Authorize(Policy = Policies.Staff)]
public class DealerLocationsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IDealerLocationSyncService _sync;
    private readonly IAuditLogService _audit;

    public DealerLocationsController(JobCardScannerDbContext db, ICurrentUserService currentUser, IDealerLocationSyncService sync, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _sync = sync;
        _audit = audit;
    }

    private bool IsCorporateOrSystem => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    private static int WorkshopNumber(string code)
    {
        var m = Regex.Match(code, @"W(\d+)$", RegexOptions.IgnoreCase);
        return m.Success && int.TryParse(m.Groups[1].Value, out var n) ? n : int.MaxValue;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? dealerId, [FromQuery] bool includeInactive = false)
    {
        var q = _db.DealerLocations.AsNoTracking().AsQueryable();
        if (!IsCorporateOrSystem)
        {
            var own = _currentUser.DealerId;
            if (own is null) return Ok(Array.Empty<object>());
            q = q.Where(l => l.DealerId == own);
        }
        else if (dealerId.HasValue)
        {
            q = q.Where(l => l.DealerId == dealerId);
        }
        if (!includeInactive) q = q.Where(l => l.IsActive);

        var rows = await q.ToListAsync();
        return Ok(rows
            .OrderBy(l => l.DealerCode, StringComparer.OrdinalIgnoreCase)
            .ThenBy(l => WorkshopNumber(l.LocationCode))
            .ThenBy(l => l.LocationCode, StringComparer.OrdinalIgnoreCase)
            .Select(l => new
            {
                locCode = l.LocationCode,
                locName = l.LocationName ?? l.LocationCode,
                dealerId = l.DealerId,
                dealerCode = l.DealerCode,
                address = l.Address,
                city = l.City,
                state = l.State,
                pincode = l.Pincode,
                isActive = l.IsActive,
            }));
    }

    [HttpPost("sync")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Sync()
    {
        try
        {
            var result = await _sync.SyncAsync(HttpContext.RequestAborted);
            await _audit.LogAsync("DealerLocation.Sync", "DealerLocation", "all",
                new { result.SourceRows, result.Added, result.Updated, result.Reactivated, result.Deactivated, result.UnmatchedLocations, result.DealerAdminsUpdated });
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }
    }
}