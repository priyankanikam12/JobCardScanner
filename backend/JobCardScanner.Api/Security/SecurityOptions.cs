namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT, Securepoint report v1.0 of 17.10.2026): switches for the security layer. Section "Security" of appsettings / environment variables (Security__CspMode ...).
///   CspMode           "ReportOnly" (default: the browser reports what the policy WOULD block, nothing breaks) | "Enforce" | "Off" - the page policy only; the API and /uploads policies are always enforced.
///   RouteGuardMode    "Enforce" (default) | "LogOnly" (logs what it would block) | "Off" - the corporate-only route rules and the /api/users role rules (DMS-01, 02, 04, 05, 09, 10).
///   DealerScopeMode   "Enforce" (default) | "LogOnly" | "Off" - a dealer login can only touch its own dealer's job cards and can never pass another dealer's id (DMS-03, 07).
///   CorporateRequiresAzureAd   true = the corporate-only routes refuse a token issued by the local Dealer/Workshop login (iss = DealerAuthJwt:Issuer), even if its role says SystemAdmin.
/// Recommended first deployment: RouteGuardMode and DealerScopeMode = LogOnly for a day, read the warnings, then Enforce.
/// </summary>
public sealed class SecurityOptions
{
    public const string Section = "Security";

    public string CspMode { get; set; } = "ReportOnly";
    public string RouteGuardMode { get; set; } = "Enforce";
    public string DealerScopeMode { get; set; } = "Enforce";
    public bool CorporateRequiresAzureAd { get; set; } = true;
    public bool EnableHsts { get; set; } = true;
    public int HstsMaxAgeDays { get; set; } = 180;
    /// <summary>Extra origins the web app may call (CSP connect-src), e.g. a second API host. Microsoft sign-in hosts are always allowed.</summary>
    public string[] ExtraConnectSrc { get; set; } = Array.Empty<string>();
    public int AuthRequestsPerMinute { get; set; } = 20;
    public int ApiRequestsPerMinute { get; set; } = 1200;
    /// <summary>Failed dealer logins (per account, and 5x that per IP) inside the window before a lockout.</summary>
    public int LoginMaxFailures { get; set; } = 10;
    /// <summary>Wrong OTP codes (per mobile number) before the number is locked.</summary>
    public int OtpMaxFailures { get; set; } = 5;
    public int LockoutMinutes { get; set; } = 15;
    /// <summary>2026-10-23 (DMS-14): key that signs the expiring job-card photo links - 32+ random characters, set it as the environment variable Security__MediaSigningKey (not in appsettings.json).</summary>
    public string MediaSigningKey { get; set; } = "";
    /// <summary>How long a signed photo link stays valid (5 .. 1440 minutes). A page that stays open longer shows broken photos until it is refreshed.</summary>
    public int MediaLinkMinutes { get; set; } = 120;
    /// <summary>2026-10-23 (DMS-12): false (default) = outside Development the API never returns "devOtpCode" / "devResetToken" (the development shortcuts that put an OTP or a password-reset token into the response). Set true ONLY as a temporary measure if dealers still reset passwords with the on-screen token because no e-mail provider is configured yet - and understand that anyone who knows a login e-mail can then reset that account.</summary>
    public bool AllowDevTokens { get; set; } = false;

    /// <summary>2026-10-23 (DMS-16): "Enforce" (default) | "LogOnly" (logs what it would refuse) | "Off" - the session checks of a Dealer / Workshop login and a customer-portal login: a token older than
    /// MaxTokenMinutes is refused, and a Dealer / Workshop token is refused once its user was deactivated, deleted, moved to another dealer, given another role or got a new password (SessionFreshnessMiddleware).</summary>
    public string SessionFreshnessMode { get; set; } = "Enforce";
    /// <summary>Longest time a Dealer / Workshop or customer-portal token is accepted after it was issued (the report asks for 1 hour or less). The web and Android apps renew it silently (POST /api/session/renew).</summary>
    public int MaxTokenMinutes { get; set; } = 60;
    /// <summary>Lifetime of a token issued by POST /api/session/renew.</summary>
    public int RenewedTokenMinutes { get; set; } = 60;
    /// <summary>How long the database answer about one user is remembered between two requests (a role change reaches a running session within this time unless the change itself ends it, which it does).</summary>
    public int SessionCheckSeconds { get; set; } = 30;
    /// <summary>2026-10-23 (DMS-12): every answer of POST /api/portal/otp/request takes at least this long (milliseconds), so a registered number (SMS sent) and an unregistered one cannot be told apart by timing.</summary>
    public int OtpMinResponseMs { get; set; } = 700;

    public static bool Is(string? value, string expected) => string.Equals(value, expected, StringComparison.OrdinalIgnoreCase);
}
