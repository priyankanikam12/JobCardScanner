using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Services;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-09-28 ("edit button for new page where we can edit details like reg no. we can edit and
/// that was save in our jobcard db that will data reflect on ui"): ONE endpoint - save (upsert) a
/// hand-corrected Reg No for one vehicle, keyed by ChassisNo, into JobCardScannerDb (this app's own
/// database - see VehicleSaleOverride.cs's doc comment for why this is deliberately NOT written
/// into DMSBAPLDATA/BaplConnection). Read back by DmsBaplDataService.GetVehicleSalesAsync as the
/// final, highest-priority layer on every future Vehicle Sale page load.
///
/// Mirrors AttendanceController's own auth/audit conventions (Policies.Staff class-level,
/// Policies.ServiceAdvisorUp on the actual write, IAuditLogService.LogAsync per save) rather than
/// introducing a new pattern.
///
/// SCOPE: only Reg No right now - see VehicleSaleOverride.cs's doc comment on why, and what to tell
/// me if you want more fields covered.
/// </summary>
[ApiController]
[Route("api/vehicle-sale-overrides")]
[Authorize(Policy = Policies.Staff)]
public class VehicleSaleOverridesController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public VehicleSaleOverridesController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    [HttpPost]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> Save(SaveVehicleSaleOverrideRequest req)
    {
        var chassisNo = req.ChassisNo?.Trim();
        var regNo = req.RegNo?.Trim();
        if (string.IsNullOrWhiteSpace(chassisNo)) return BadRequest(new { message = "Chassis No. is required." });
        if (string.IsNullOrWhiteSpace(regNo)) return BadRequest(new { message = "Reg No. is required." });

        var existing = await _db.VehicleSaleOverrides.FirstOrDefaultAsync(o => o.ChassisNo == chassisNo);
        if (existing is null)
        {
            existing = new VehicleSaleOverride
            {
                Id = Guid.NewGuid(),
                ChassisNo = chassisNo,
            };
            _db.VehicleSaleOverrides.Add(existing);
        }
        existing.RegNo = regNo;
        existing.UpdatedByUserId = _currentUser.UserId;
        existing.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _audit.LogAsync("VehicleSale.OverrideRegNo", "VehicleSaleOverride", existing.Id.ToString(),
            new { existing.ChassisNo, existing.RegNo });

        return Ok(new { existing.ChassisNo, existing.RegNo });
    }
}

/// <summary>Request body for POST /api/vehicle-sale-overrides.</summary>
public record SaveVehicleSaleOverrideRequest(string ChassisNo, string RegNo);
