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
    /// <summary>2026-09-21 ("why stock not shown in material and repair bill page from
    /// part-upload"): read-only access to GET /api/part-uploads for whoever can create a Repair
    /// Bill or Material Transfer (ServiceAdvisorUp), UNION'd with PartsUserUp's own roles. Root
    /// cause of the reported bug - PartUploadController's GET action was gated to PartsUserUp
    /// only, so a plain ServiceAdvisor (who CAN open Repair Bill/Material Transfer, gated
    /// ServiceAdvisorUp) got a 403 on the merge-in fetch and silently saw zero uploaded-stock
    /// rows/badges, with live DMS stock (often 0 for a part DMS has no current stock for) showing
    /// instead. Only the read (Get) action uses this - Import/Update/Delete on
    /// PartUploadController stay PartsUserUp-only, unchanged.</summary>
    public const string PartsReadUp = "PartsReadUp";
    public const string CashierUp = "CashierUp";
    public const string DealerAdminUp = "DealerAdminUp";
    public const string CorporateAdminUp = "CorporateAdminUp";
    public const string SystemAdminOnly = "SystemAdminOnly";
    /// <summary>2026-09-24 - the new "Technician Employee" tab (TechniciansController's write
    /// actions - Create/Update/Delete). Deliberately its OWN policy, not folded into
    /// WorkshopManagerUp: per the explicit request ("that supervisor when login then he have
    /// access to create Tecnician"), a WorkshopManager should NOT automatically get this - only
    /// Supervisor and the dealer/corporate/system admin tiers above it. See
    /// StaffRole.Supervisor's own doc comment. TechniciansController's own GET (list) action is
    /// gated ServiceAdvisorUp instead (see that controller) - reading the list to populate a
    /// dropdown is a much wider need than managing the records.</summary>
    public const string SupervisorUp = "SupervisorUp";
}
