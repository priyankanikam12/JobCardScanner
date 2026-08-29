using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Auth;

public interface IDealerJwtTokenService
{
    /// <summary>Issues a signed JWT for a local ("Dealer / Workshop Login") staff sign-in.
    /// Carries the same app_role/app_user_id/app_dealer_id/app_name claims that
    /// AppClaimsTransformation stamps onto an Azure AD token, so downstream policies and
    /// ICurrentUserService need no special-casing for which scheme authenticated the request.</summary>
    string IssueToken(User user);
}