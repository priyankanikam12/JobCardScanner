using System.Text.Json;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;

    public AuthController(JobCardScannerDbContext db, ICurrentUserService currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Called immediately after the web/mobile client signs in with MSAL against Azure AD.
    /// Returns the resolved app profile (role, dealer) for the signed-in user, or 403 with a
    /// clear message if their email has not been provisioned in the app yet - see
    /// docs/AZURE_AD_SETUP.md for how an admin adds a staff user before their first sign-in.
    /// </summary>
    [HttpGet("me")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<IActionResult> Me()
    {
        if (_currentUser.UserId is null)
            return StatusCode(403, new { message = "Your Azure AD account is not provisioned in JobCardScanner. Ask your Dealer/System Admin to add you as a user with this exact email." });

        var user = await _db.Users.AsNoTracking()
            .Include(u => u.Dealer)
            .FirstOrDefaultAsync(u => u.Id == _currentUser.UserId);
        if (user is null) return NotFound();

        return Ok(new
        {
            user.Id,
            user.Name,
            user.Email,
            user.Mobile,
            Role = user.Role.ToString(),
            user.DealerId,
            DealerName = user.Dealer?.Name,
            // DMS's own dealer code (e.g. "CUS0435") - not user.Dealer.Code, which for
            // BaplImport-sourced dealers is a different code space (see Dealer.BaplDmsDealerCode's
            // doc comment). Lets the frontend scope chassis/reg-no vehicle search
            // (BaplDmsController.VehicleLookup/VehicleSuggestions) to only this dealer's own
            // ChassisDetails rows for a dealer-login user, instead of searching across every dealer.
            DealerBaplDmsCode = user.Dealer?.BaplDmsDealerCode,
            // 2026-09-21 ("Labour - ... according to state Intra state and inter state"): the
            // reference RepairBillRepo/Angular never guesses this from anywhere but a straight
            // Dealer.State == Customer.State string compare (repair-bill.ts addLabour()/
            // calculatePart(), confirmed against the pasted source) - exposed here so the Repair
            // Bill / Material Transfer create pages can do the same compare client-side instead of
            // asking the user to pick "Same State/Different State" by hand every time.
            DealerState = user.Dealer?.State,
            user.AvatarColor,
            user.LastLoginAt,
            AuthType = user.AuthType.ToString(),
            // 2026-10-01 ("still not shown his designation is captain"): the second half of the
            // CurrentUser.designation fix - web/src/types/index.ts already declares this field on
            // the frontend, but it was always coming back undefined because this endpoint never
            // selected it. StaffLayout.tsx's topbar badge reads it to show Captain/ViceCaptain
            // users' actual Designation instead of their real (different) underlying Role - see
            // that file's badgeLabel() doc comment. user.Designation is the same free-text field
            // EmployeesPage.tsx's Designation dropdown already writes (separate from Role, see
            // that page's own DESIGNATIONS doc comment).
            user.Designation,
            // 2026-09-18: the Job Card wizard's "Service Location (workshop)" dropdown (and the
            // equivalent picker on Material Transfer) was listing EVERY workshop for the user's
            // dealer, even for an Employee scoped to just one or a few Work Area locations - the
            // dropdown itself had no way to know which locations this user is actually allowed to
            // use, since /api/auth/me never told the frontend. Server-side enforcement
            // (JobCardsController.Create, DmsBaplDataController) already blocks a request for an
            // out-of-scope location either way, but the UI should not offer a choice it's only
            // going to reject - see User.WorkLocationCodes's doc comment for the full mechanism.
            WorkLocationCodes = DeserializeLocationCodes(user.WorkLocationCodes),
        });
    }

    private static IReadOnlyList<string> DeserializeLocationCodes(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<string>();
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>(); }
        catch { return Array.Empty<string>(); } // tolerate hand-edited/corrupt data rather than 500 this endpoint
    }
}
