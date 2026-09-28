using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Services;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// SECTION 155 (2026-09-29) - "for sidebar menu acces provide page make foe which role which menu
/// wants to shown a every where". See Models/MenuAccessOverride.cs's class doc comment for the
/// full design/interpretation.
///
/// GET is open to every signed-in staff member (Policies.Staff, the lowest bar) - every login's
/// own sidebar needs to read these overrides, not just admins; there's nothing sensitive in "which
/// roles can see nav item X" that isn't already visible in the web bundle's own StaffLayout.tsx
/// source. PUT is gated to CorporateAdmin/SystemAdmin only via an explicit _currentUser.Role check
/// - the SAME pattern AttendanceController.cs already uses for its own org-wide-role checks
/// (`_currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin`), used here instead of
/// a named Policies constant since I don't have your real Auth/Policies.cs's full RoleUp
/// definitions in this session to confirm an exact "CorporateAdminUp"-style constant exists -
/// this inline check is equivalent and avoids guessing a policy name that might not compile.
///
/// SECTION 170 (2026-09-30) added the /role-modes endpoints below (Models/RoleMenuMode.cs) - same
/// GET-open/PUT-admin-only gating, same bulk-replace-the-whole-set PUT shape as the item overrides
/// above.
/// </summary>
[ApiController]
[Route("api/menu-access")]
[Authorize(Policy = Policies.Staff)]
public class MenuAccessController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;

    public MenuAccessController(JobCardScannerDbContext db, ICurrentUserService currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var rows = await _db.MenuAccessOverrides.AsNoTracking().ToListAsync();
        return Ok(rows.Select(r => new { navKey = r.NavKey, roles = SplitRoles(r.RolesCsv) }));
    }

    /// <summary>Replaces the WHOLE override set in one call - the admin page's Save button submits
    /// every row at once, not one PUT per nav item. CorporateAdmin/SystemAdmin only - see class
    /// doc comment.</summary>
    [HttpPut]
    public async Task<IActionResult> Put([FromBody] List<MenuAccessOverrideRequest> req)
    {
        if (_currentUser.Role is not (StaffRole.CorporateAdmin or StaffRole.SystemAdmin))
            return Forbid();

        var existing = await _db.MenuAccessOverrides.ToListAsync();
        _db.MenuAccessOverrides.RemoveRange(existing);
        foreach (var item in req)
        {
            if (string.IsNullOrWhiteSpace(item.NavKey)) continue;
            _db.MenuAccessOverrides.Add(new MenuAccessOverride
            {
                NavKey = item.NavKey.Trim(),
                RolesCsv = string.Join(",", (item.Roles ?? new List<string>()).Where(r => !string.IsNullOrWhiteSpace(r))),
                UpdatedBy = _currentUser.UserName,
                UpdatedAtUtc = DateTime.UtcNow,
            });
        }
        await _db.SaveChangesAsync();
        return Ok();
    }

    /// <summary>SECTION 170 - one row per role that has an explicit mode saved; a role with no row
    /// at all is OnlyShowChecked=false (today's existing behavior) - same "no row = default" fallback
    /// convention GET /api/menu-access itself uses for items with no override.</summary>
    [HttpGet("role-modes")]
    public async Task<IActionResult> GetRoleModes()
    {
        var rows = await _db.RoleMenuModes.AsNoTracking().ToListAsync();
        return Ok(rows.Select(r => new { role = r.Role, onlyShowChecked = r.OnlyShowChecked }));
    }

    /// <summary>Replaces the WHOLE role-mode set in one call, same bulk-replace shape as PUT
    /// /api/menu-access above. CorporateAdmin/SystemAdmin only.</summary>
    [HttpPut("role-modes")]
    public async Task<IActionResult> PutRoleModes([FromBody] List<RoleMenuModeRequest> req)
    {
        if (_currentUser.Role is not (StaffRole.CorporateAdmin or StaffRole.SystemAdmin))
            return Forbid();

        var existing = await _db.RoleMenuModes.ToListAsync();
        _db.RoleMenuModes.RemoveRange(existing);
        foreach (var item in req)
        {
            if (string.IsNullOrWhiteSpace(item.Role)) continue;
            _db.RoleMenuModes.Add(new RoleMenuMode
            {
                Role = item.Role.Trim(),
                OnlyShowChecked = item.OnlyShowChecked,
                UpdatedBy = _currentUser.UserName,
                UpdatedAtUtc = DateTime.UtcNow,
            });
        }
        await _db.SaveChangesAsync();
        return Ok();
    }

    private static List<string> SplitRoles(string csv) =>
        string.IsNullOrWhiteSpace(csv)
            ? new List<string>()
            : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
}

/// <summary>Request body for one nav item's row in the PUT /api/menu-access bulk save. Roles=null
/// or an empty list both mean "visible to every staff role" - same "empty = unrestricted"
/// convention as User.WorkLocationCodes elsewhere in this codebase.</summary>
public record MenuAccessOverrideRequest(string NavKey, List<string>? Roles);

/// <summary>Request body for one role's row in the PUT /api/menu-access/role-modes bulk save -
/// SECTION 170, see Models/RoleMenuMode.cs.</summary>
public record RoleMenuModeRequest(string Role, bool OnlyShowChecked);
