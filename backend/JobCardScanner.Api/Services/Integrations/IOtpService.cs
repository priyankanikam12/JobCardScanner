using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services.Integrations;

/// <summary>
/// RequestId is always populated. DevCode carries the plaintext 6-digit code ONLY when the API is
/// running in the Development environment (see OtpService) - there's no real SMS provider wired
/// up yet (MockNotificationClient just logs the message and rows it into NotificationRecords), so
/// without this a tester has no way to ever complete an OTP flow short of reading server logs or
/// querying the DB directly. Every caller (closure, estimate approval, customer portal login)
/// threads this into its OtpIssueResponse so the page can show it inline for local testing; it is
/// always null outside Development, so nothing here can leak a real customer's OTP in production.
/// </summary>
public record OtpIssueResult(Guid RequestId, string? DevCode);

public interface IOtpService
{
    /// <summary>Generates a 6-digit OTP, persists its hash, and dispatches it via SMS - and, when
    /// email is supplied, ALSO via the customer's registered email through Microsoft Graph (see
    /// GraphEmailClient). Email is strictly additive and best-effort: passing null/empty just
    /// skips it, and a Graph failure never affects the SMS channel or the returned OtpIssueResult.</summary>
    Task<OtpIssueResult> IssueOtpAsync(OtpPurpose purpose, string mobile, Guid? jobCardId = null, Guid? estimateId = null, string? email = null);

    /// <summary>Verifies a submitted code against the given request. Fails closed after 5 attempts or on expiry.</summary>
    Task<bool> VerifyOtpAsync(Guid otpRequestId, string code);
}