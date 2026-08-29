namespace JobCardScanner.Api.Auth;

public interface ICustomerTokenService
{
    /// <summary>Issues a signed JWT for the customer tracking portal after OTP verification.</summary>
    string IssueToken(Guid customerId, string mobile, Guid? jobCardId = null);
}
