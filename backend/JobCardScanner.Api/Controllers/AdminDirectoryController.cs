using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Backs the "Sync from Azure AD" panel on Admin -> Users: lists the tenant's real Azure AD
/// accounts (via <see cref="IAzureAdDirectoryService"/>) cross-referenced against our own Users
/// table, so an admin can search the real directory and add/re-role people instead of typing
/// emails blind. Adding/updating itself still goes through the existing UsersController
/// endpoints - this controller is read-only.
/// </summary>
[ApiController]
[Route("api/admin/azure-directory")]
[Authorize(Policy = Policies.DealerAdminUp)]
public class AdminDirectoryController : ControllerBase
{
    private readonly IAzureAdDirectoryService _directory;
    private readonly JobCardScannerDbContext _db;

    public AdminDirectoryController(IAzureAdDirectoryService directory, JobCardScannerDbContext db)
    {
        _directory = directory;
        _db = db;
    }

    /// <summary>
    /// GET /api/admin/azure-directory/users?q=oat - q filters by name/email substring (case
    /// insensitive); omit q to list everyone (capped at 500 results so the page stays usable
    /// against a 1,000+ user tenant - narrow with q to find someone specific).
    /// </summary>
    [HttpGet("users")]
    public async Task<IActionResult> ListUsers([FromQuery] string? q)
    {
        IReadOnlyList<AzureAdDirectoryUser> directoryUsers;
        try
        {
            directoryUsers = await _directory.ListUsersAsync(HttpContext.RequestAborted);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }

        var existing = await _db.Users.AsNoTracking()
            .Where(u => u.AuthType == Models.UserAuthType.AzureAd)
            .ToDictionaryAsync(u => u.Email.ToLower(), u => u);

        var query = directoryUsers.Where(d => !string.IsNullOrWhiteSpace(d.Email));
        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(d =>
                d.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                d.Email!.Contains(q, StringComparison.OrdinalIgnoreCase));
        }

        var results = query
            .OrderBy(d => d.DisplayName)
            .Take(500)
            .Select(d =>
            {
                existing.TryGetValue(d.Email!.ToLower(), out var local);
                return new
                {
                    d.ObjectId,
                    d.DisplayName,
                    d.Email,
                    d.AccountEnabled,
                    Provisioned = local is not null,
                    UserId = local?.Id,
                    Role = local?.Role.ToString(),
                    Active = local?.Active,
                    DealerId = local?.DealerId,
                };
            });

        return Ok(new { total = directoryUsers.Count, results });
    }
}