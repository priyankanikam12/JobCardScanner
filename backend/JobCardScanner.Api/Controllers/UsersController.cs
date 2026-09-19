using System.Text.Json;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>Staff user administration - Dealer Admin manages their own dealer's users,
/// Corporate/System Admin can manage across all dealers. Also backs the "Employees" section of
/// Admin -> Users (2026-09-17) - Designation/Work Area/State/City/Pincode/DOJ fields, all optional
/// so the older Azure AD sync / manual-add panels keep working unchanged.</summary>
[ApiController]
[Route("api/users")]
[Authorize(Policy = Policies.DealerAdminUp)]
public class UsersController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public UsersController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    private bool IsCorporateOrSystem => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    /// <summary>Designation -> Role, so an Employee created here can actually pass this app's
    /// [Authorize(Policy=...)] checks. See User.Designation's doc comment for why "Mechanic" maps
    /// to ServiceAdvisor and not the seemingly-closer StaffRole.Technician: Program.cs's policy
    /// table (ServiceAdvisorUp/WorkshopManagerUp/etc) does NOT include Technician in ANY named
    /// policy - only the bare "any authenticated staff" Policies.Staff - so a Technician-role user
    /// cannot create a job card, cannot open Material Transfer or Repair Bill, cannot do most of
    /// what this app's Job Card Wizard/detail pages require. ServiceAdvisor is the lowest role
    /// that actually satisfies ServiceAdvisorUp (Create Job Card, Material Transfer, Repair Bill,
    /// Part/Labour suggestion, ...), so that's what "Mechanic" resolves to. "Supervisor" maps to
    /// WorkshopManager, a strict superset of ServiceAdvisor's access. Returns null (caller keeps
    /// whatever Role was explicitly supplied) for a designation this map doesn't recognise.</summary>
    private static StaffRole? RoleForDesignation(string? designation) => designation?.Trim() switch
    {
        "Mechanic" => StaffRole.ServiceAdvisor,
        "Supervisor" => StaffRole.WorkshopManager,
        _ => null,
    };

    private static string? SerializeLocationCodes(IReadOnlyList<string>? codes) =>
        codes is null || codes.Count == 0 ? null : JsonSerializer.Serialize(codes.Select(c => c.Trim()).Where(c => c.Length > 0).Distinct().ToList());

    private static IReadOnlyList<string> DeserializeLocationCodes(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<string>();
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>(); }
        catch { return Array.Empty<string>(); } // tolerate hand-edited/corrupt data rather than 500 the whole list
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? dealerId)
    {
        var q = _db.Users.AsNoTracking().Include(u => u.Dealer).AsQueryable();
        if (!IsCorporateOrSystem) q = q.Where(u => u.DealerId == _currentUser.DealerId);
        else if (dealerId.HasValue) q = q.Where(u => u.DealerId == dealerId);

        var users = await q.OrderBy(u => u.Name).ToListAsync();
        return Ok(users.Select(u => new
        {
            u.Id,
            u.Name,
            u.Email,
            u.Mobile,
            Role = u.Role.ToString(),
            u.DealerId,
            DealerName = u.Dealer?.Name,
            u.Active,
            u.AvatarColor,
            u.LastLoginAt,
            AuthType = u.AuthType.ToString(),
            u.State,
            u.City,
            u.Pincode,
            u.DateOfJoining,
            u.Designation,
            WorkLocationCodes = DeserializeLocationCodes(u.WorkLocationCodes),
        }));
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateUserRequest req)
    {
        if (!IsCorporateOrSystem && req.DealerId != _currentUser.DealerId)
            return Forbid();
        if (await _db.Users.AnyAsync(u => u.Email.ToLower() == req.Email.ToLower()))
            return Conflict(new { message = "A user with this email already exists." });
        if (req.AuthType == UserAuthType.Local && string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { message = "A password is required for local (Dealer / Workshop Login) users." });

        var user = new User
        {
            Name = req.Name,
            Email = req.Email,
            Mobile = req.Mobile,
            Role = RoleForDesignation(req.Designation) ?? req.Role,
            DealerId = req.DealerId,
            AuthType = req.AuthType,
            PasswordHash = req.AuthType == UserAuthType.Local ? PasswordHasher.Hash(req.Password!) : null,
            MustChangePassword = req.AuthType == UserAuthType.Local,
            State = req.State,
            City = req.City,
            Pincode = req.Pincode,
            DateOfJoining = req.DateOfJoining,
            Designation = req.Designation,
            WorkLocationCodes = SerializeLocationCodes(req.WorkLocationCodes),
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("User.Create", "User", user.Id.ToString(), new { user.Email, user.Role, user.Designation });
        return CreatedAtAction(nameof(List), new { }, new { user.Id });
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, UpdateUserRequest req)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return NotFound();
        if (!IsCorporateOrSystem && user.DealerId != _currentUser.DealerId) return Forbid();

        if (req.Name is not null) user.Name = req.Name;
        if (req.Mobile is not null) user.Mobile = req.Mobile;
        if (req.Role.HasValue) user.Role = req.Role.Value;
        if (req.DealerId.HasValue) user.DealerId = req.DealerId;
        if (req.Active.HasValue) user.Active = req.Active.Value;
        if (req.State is not null) user.State = req.State;
        if (req.City is not null) user.City = req.City;
        if (req.Pincode is not null) user.Pincode = req.Pincode;
        if (req.DateOfJoining.HasValue) user.DateOfJoining = req.DateOfJoining;
        if (req.Designation is not null)
        {
            user.Designation = req.Designation;
            var mappedRole = RoleForDesignation(req.Designation);
            if (mappedRole.HasValue && !req.Role.HasValue) user.Role = mappedRole.Value; // Designation drives Role unless Role was also explicitly sent
        }
        if (req.WorkLocationCodes is not null) user.WorkLocationCodes = SerializeLocationCodes(req.WorkLocationCodes);
        if (!string.IsNullOrWhiteSpace(req.Password))
        {
            if (user.AuthType != UserAuthType.Local)
                return BadRequest(new { message = "A password can only be set for local (Dealer / Workshop Login) users." });
            user.PasswordHash = PasswordHasher.Hash(req.Password);
        }

        await _db.SaveChangesAsync();
        await _audit.LogAsync("User.Update", "User", user.Id.ToString());
        return Ok(new { user.Id });
    }

    /// <summary>
    /// DELETE /api/users/{id} - permanent removal, distinct from the existing Active toggle
    /// (soft-deactivate, still available via PUT .../active) - the Employees grid's "Delete"
    /// action. Refuses to delete the caller's own account (would lock them out of the page that
    /// just deleted them) and, same as Update, a non-corporate admin can only delete their own
    /// dealer's users.
    /// </summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        if (_currentUser.UserId == id)
            return BadRequest(new { message = "You cannot delete your own account." });

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return NotFound();
        if (!IsCorporateOrSystem && user.DealerId != _currentUser.DealerId) return Forbid();

        _db.Users.Remove(user);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("User.Delete", "User", id.ToString(), new { user.Email });
        return NoContent();
    }
}
