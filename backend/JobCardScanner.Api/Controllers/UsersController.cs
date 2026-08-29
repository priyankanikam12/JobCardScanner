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
/// Corporate/System Admin can manage across all dealers.</summary>
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

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? dealerId)
    {
        var q = _db.Users.AsNoTracking().Include(u => u.Dealer).AsQueryable();
        if (!IsCorporateOrSystem) q = q.Where(u => u.DealerId == _currentUser.DealerId);
        else if (dealerId.HasValue) q = q.Where(u => u.DealerId == dealerId);

        var users = await q.OrderBy(u => u.Name).ToListAsync();
        return Ok(users.Select(u => new { u.Id, u.Name, u.Email, u.Mobile, Role = u.Role.ToString(), u.DealerId, DealerName = u.Dealer?.Name, u.Active, u.AvatarColor, u.LastLoginAt, AuthType = u.AuthType.ToString() }));
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
            Role = req.Role,
            DealerId = req.DealerId,
            AuthType = req.AuthType,
            PasswordHash = req.AuthType == UserAuthType.Local ? PasswordHasher.Hash(req.Password!) : null,
            MustChangePassword = req.AuthType == UserAuthType.Local,
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("User.Create", "User", user.Id.ToString(), new { user.Email, user.Role });
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

        await _db.SaveChangesAsync();
        await _audit.LogAsync("User.Update", "User", user.Id.ToString());
        return Ok(new { user.Id });
    }
}
