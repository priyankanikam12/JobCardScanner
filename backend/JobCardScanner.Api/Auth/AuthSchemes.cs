namespace JobCardScanner.Api.Auth;

public static class AuthSchemes
{
    public const string AzureAd = "AzureAd";
    public const string CustomerPortal = "CustomerPortal";
    /// <summary>Local email+password sign-in for dealer/workshop staff who don't have an Azure
    /// AD account - see Controllers/DealerAuthController.cs and Auth/DealerJwtTokenService.cs.
    /// Issues the same app_role/app_user_id/app_dealer_id claims as an Azure AD sign-in does
    /// (post AppClaimsTransformation), so every existing staff policy below accepts both
    /// schemes side by side.</summary>
    public const string DealerJwt = "DealerJwt";
}

public static class Policies
{
    public const string Staff = "Staff";
    public const string Customer = "Customer";
    public const string ServiceAdvisorUp = "ServiceAdvisorUp";
    public const string WorkshopManagerUp = "WorkshopManagerUp";
    public const string PartsUserUp = "PartsUserUp";
    public const string CashierUp = "CashierUp";
    public const string DealerAdminUp = "DealerAdminUp";
    public const string CorporateAdminUp = "CorporateAdminUp";
    public const string SystemAdminOnly = "SystemAdminOnly";
}
