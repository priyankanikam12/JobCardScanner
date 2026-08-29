using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace JobCardScanner.Api.Auth;

/// <summary>
/// Issues symmetric-key JWTs for the customer OTP portal (customers are not Azure AD
/// principals). Validation of these tokens is configured as a second JwtBearer scheme,
/// "CustomerPortal", in Program.cs using the same secret/issuer/audience.
/// </summary>
public class CustomerTokenService : ICustomerTokenService
{
    private readonly IConfiguration _config;

    public CustomerTokenService(IConfiguration config)
    {
        _config = config;
    }

    public string IssueToken(Guid customerId, string mobile, Guid? jobCardId = null)
    {
        var section = _config.GetSection("CustomerPortalJwt");
        var secret = section["Secret"] ?? throw new InvalidOperationException("CustomerPortalJwt:Secret is not configured.");
        var issuer = section["Issuer"];
        var audience = section["Audience"];
        var expiryMinutes = section.GetValue<int?>("ExpiryMinutes") ?? 720;

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, customerId.ToString()),
            new("customer_id", customerId.ToString()),
            new("mobile", mobile),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };
        if (jobCardId.HasValue)
            claims.Add(new Claim("job_card_id", jobCardId.Value.ToString()));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiryMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
