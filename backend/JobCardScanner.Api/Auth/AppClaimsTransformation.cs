using System.Linq;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Data;

namespace JobCardScanner.Api.Auth;

/// <summary>
/// Runs automatically on every authenticated request. Azure AD only proves *identity* (an
/// email/UPN + object id) - it knows nothing about our app's roles or dealer assignment. This
/// transformation looks the signed-in user up in our own <c>Users</c> table by email and, if
/// found and active, stamps on "app_role" / "app_user_id" / "app_dealer_id" claims that the
/// rest of the app (policies, [Authorize(Roles=...)], ICurrentUserService) relies on.
///
/// This is a deliberate simplification documented for the customer: authorization is sourced
/// from our own database, not from Azure AD App Roles / Enterprise App role assignments, so
/// there is nothing extra to configure in the Azure Portal beyond the App Registration itself.
/// A user must be provisioned (added) in the app by an admin before they can do anything, even
/// if their Azure AD sign-in succeeds.
/// </summary>
public class AppClaimsTransformation : IClaimsTransformation
{
    private readonly JobCardScannerDbContext _db;

    public AppClaimsTransformation(JobCardScannerDbContext db)
    {
        _db = db;
    }

    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        var identity = principal.Identity as ClaimsIdentity;
        if (identity is null || !identity.IsAuthenticated) return principal;

        // Only touch tokens that look like Azure AD staff tokens. We deliberately do not key
        // this off ClaimsIdentity.AuthenticationType - JwtBearerHandler does not reliably stamp
        // it to the scheme name, so relying on it here previously risked silently skipping the
        // transformation for genuine staff sign-ins. Instead: the customer-portal JWT carries
        // only sub/customer_id/mobile/jti (see Auth/CustomerTokenService.cs) and never an
        // email/UPN claim, so an email-claim lookup is naturally a no-op for customer tokens.
        if (identity.HasClaim(c => c.Type == "app_role")) return principal; // already transformed
        if (identity.HasClaim(c => c.Type == "customer_id")) return principal; // customer-portal token, not staff

        // Try every claim name Azure AD might use for the sign-in email/UPN. Which one(s)
        // actually show up on the access token depends on the token version (v1 vs v2) and the
        // API App Registration's optional-claims config, and - as of the JwtBearer defaults
        // shipped with .NET 8 - short JWT claim names ("upn", "email") are NOT auto-mapped to
        // the long ClaimTypes.* URIs the way older ASP.NET Core versions used to. So we check
        // both the short and long forms rather than assuming one.
        var email = principal.FindFirstValue("preferred_username")
                    ?? principal.FindFirstValue("upn")
                    ?? principal.FindFirstValue(ClaimTypes.Upn)
                    ?? principal.FindFirstValue("email")
                    ?? principal.FindFirstValue(ClaimTypes.Email)
                    ?? principal.FindFirstValue("unique_name")
                    ?? principal.FindFirstValue("emails");

        if (string.IsNullOrWhiteSpace(email))
        {
            Console.WriteLine("[AppClaimsTransformation] No email/UPN claim found on this token at all. " +
                "Raw claims received: " + string.Join(", ", identity.Claims.Select(c => $"{c.Type}={c.Value}")));
            return principal;
        }

        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Email.ToLower() == email.ToLower() && u.Active);
        if (user is null)
        {
            Console.WriteLine($"[AppClaimsTransformation] Token identifies '{email}' but no ACTIVE row in Users " +
                "matches that email exactly. Add/activate this exact address in Admin -> Users, or in the " +
                "Users table check for a typo/trailing space/case difference and that Active = 1.");
            return principal;
        }

        Console.WriteLine($"[AppClaimsTransformation] Matched '{email}' -> UserId={user.Id}, Role={user.Role}. Access granted.");

        var oid = principal.FindFirstValue("oid") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!string.IsNullOrWhiteSpace(oid) && user.AzureAdObjectId != oid)
        {
            // Stamp the Azure AD object id on first successful sign-in (fire-and-forget update).
            var tracked = await _db.Users.FirstOrDefaultAsync(u => u.Id == user.Id);
            if (tracked is not null)
            {
                tracked.AzureAdObjectId = oid;
                tracked.LastLoginAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
            }
        }

        identity.AddClaim(new Claim("app_user_id", user.Id.ToString()));
        identity.AddClaim(new Claim("app_role", user.Role.ToString()));
        identity.AddClaim(new Claim(ClaimTypes.Role, user.Role.ToString()));
        if (user.DealerId.HasValue)
            identity.AddClaim(new Claim("app_dealer_id", user.DealerId.Value.ToString()));
        identity.AddClaim(new Claim("app_name", user.Name));

        return principal;
    }
}