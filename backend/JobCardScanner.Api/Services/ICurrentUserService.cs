using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services;

/// <summary>
/// Cheap, per-request accessor for "who is calling" without re-hitting the database - reads
/// the claims stamped by <see cref="Auth.AppClaimsTransformation"/> (staff, Azure AD scheme)
/// or issued directly into the customer-portal JWT (customer scheme).
/// </summary>
public interface ICurrentUserService
{
    bool IsAuthenticated { get; }
    bool IsStaff { get; }
    bool IsCustomer { get; }

    Guid? UserId { get; }
    string? UserName { get; }
    /// <summary>The signed-in staff user's own Users.Email (Azure AD sign-in or local login,
    /// whichever this token came from - see AppClaimsTransformation/DealerJwtTokenService's
    /// "app_email" claim). Null for an unauthenticated/customer-portal request. 2026-09-24: added
    /// so a caller (JobCardsController.EmailEstimate) can send an outgoing email "as" this actual
    /// person instead of one fixed mailbox - see GraphEmailClient's fromMailbox doc comment.</summary>
    string? Email { get; }
    StaffRole? Role { get; }
    Guid? DealerId { get; }
    /// <summary>DMS workshop LocCodes this user is scoped to (the "Work Area" checkboxes on
    /// the Employees page) - see User.WorkLocationCodes's doc comment. Empty = unrestricted (every
    /// user before this feature shipped, and any admin who hasn't assigned locations yet).</summary>
    IReadOnlyList<string> WorkLocationCodes { get; }

    Guid? CustomerId { get; }
    string? CustomerMobile { get; }
}
