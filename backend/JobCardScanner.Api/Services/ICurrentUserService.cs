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
    StaffRole? Role { get; }
    Guid? DealerId { get; }

    Guid? CustomerId { get; }
    string? CustomerMobile { get; }
}
