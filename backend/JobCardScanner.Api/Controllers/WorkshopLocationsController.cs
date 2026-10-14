using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-13 ("give master table and our all Magnemite dealers with their location"): admin endpoints over dbo.WorkshopLocations, the app's own workshop-location master
/// (sql/2026-10-13_create_workshop_locations.sql). Everything that needs a workshop list (Employees Work Area, Job Card wizard Service Location, Material Transfer / Repair Bill
/// Location pickers) now reads this table through GET /api/bapl-dms/workshops, so a blocked BAPLDMSvad connection no longer empties them or leaves BaplServiceLocation /
/// BaplServiceLocationCode NULL on new job cards.
///   POST /api/workshop-locations/sync[?all=true] - copies each dealer's W1..Wn list from live DMS into the table (default: Magnemite dealers; all=true: every dealer that has a DMS dealer code).
///        Needs DMS reachable ONCE, when it runs; it only adds and corrects, never deletes. Run it again whenever a new workshop is opened.
///   GET  /api/workshop-locations[?dealerId=] - what the table holds.
/// CorporateAdmin / SystemAdmin only.
/// </summary>
[ApiController]
[Route("api/workshop-locations")]
[Authorize(Policy = Policies.CorporateAdminUp)]
public class WorkshopLocationsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly IBaplDmsService _baplDms;
    private readonly ILogger<WorkshopLocationsController> _logger;

    public WorkshopLocationsController(JobCardScannerDbContext db, IBaplDmsService baplDms, ILogger<WorkshopLocationsController> logger)
    {
        _db = db;
        _baplDms = baplDms;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? dealerId, [FromQuery] string? q, CancellationToken ct)
    {
        try
        {
            var rows = await WorkshopLocationStore.GetAsync(_db, dealerId, q, ct);
            return Ok(rows.Select(r => new { r.LocCode, r.LocName, r.DealerId, r.DealerCode, r.DealerName }));
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Could not read WorkshopLocations (has sql/2026-10-13_create_workshop_locations.sql been run?): {ex.GetBaseException().Message}" });
        }
    }

    [HttpPost("sync")]
    public async Task<IActionResult> Sync([FromQuery] bool all = false, CancellationToken ct = default)
    {
        var dealers = await _db.Dealers.AsNoTracking()
            .Where(d => d.BaplDmsDealerCode != null && d.BaplDmsDealerCode != "")
            .Select(d => new { d.Id, d.Name, d.BaplDmsDealerCode })
            .ToListAsync(ct);
        if (!all) dealers = dealers.Where(d => d.Name != null && d.Name.Contains("MAGNEMITE", StringComparison.OrdinalIgnoreCase)).ToList();

        int dealersWithLocations = 0, added = 0, updated = 0;
        var errors = new List<string>();
        foreach (var d in dealers)
        {
            try
            {
                var rows = await _baplDms.GetWorkshopsAsync(d.BaplDmsDealerCode, null, ct);
                if (rows.Count > 0) dealersWithLocations++;
                var result = await WorkshopLocationStore.UpsertAsync(_db, d.Id, rows.Select(w => (w.LocCode, w.LocName)), "DMS", ct);
                added += result.Added;
                updated += result.Updated;
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Workshop sync: DMS failed for dealer {Dealer}", d.BaplDmsDealerCode);
                errors.Add($"{d.Name} ({d.BaplDmsDealerCode}): {ex.Message}");
                // DMS unreachable (e.g. the firewall): stop after a few failures instead of waiting out a connection timeout for every dealer
                if (errors.Count >= 3 && dealersWithLocations == 0) break;
            }
        }

        return Ok(new { dealersChecked = dealers.Count, dealersWithLocations, locationsAdded = added, locationsUpdated = updated, errors });
    }
}