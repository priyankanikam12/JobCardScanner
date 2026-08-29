using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services;

public class CurrentUserService : ICurrentUserService
{
    private readonly IHttpContextAccessor _accessor;

    public CurrentUserService(IHttpContextAccessor accessor)
    {
        _accessor = accessor;
    }

    private System.Security.Claims.ClaimsPrincipal? Principal => _accessor.HttpContext?.User;

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated ?? false;
    public bool IsStaff => Principal?.HasClaim(c => c.Type == "app_role") ?? false;
    public bool IsCustomer => Principal?.HasClaim(c => c.Type == "customer_id") ?? false;

    public Guid? UserId => Guid.TryParse(Principal?.FindFirst("app_user_id")?.Value, out var g) ? g : null;
    public string? UserName => Principal?.FindFirst("app_name")?.Value;
    public StaffRole? Role => Enum.TryParse<StaffRole>(Principal?.FindFirst("app_role")?.Value, out var r) ? r : null;
    public Guid? DealerId => Guid.TryParse(Principal?.FindFirst("app_dealer_id")?.Value, out var g) ? g : null;

    public Guid? CustomerId => Guid.TryParse(Principal?.FindFirst("customer_id")?.Value, out var g) ? g : null;
    public string? CustomerMobile => Principal?.FindFirst("mobile")?.Value;
}
