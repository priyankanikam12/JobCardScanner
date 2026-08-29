using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using JobCardScanner.Api.Models;
using Microsoft.IdentityModel.Tokens;

namespace JobCardScanner.Api.Auth;

/// <summary>
/// Issues symmetric-key JWTs for local ("Dealer / Workshop Login") staff sign-in - see
/// Controllers/DealerAuthController.cs. Validation of these tokens is configured as a third
/// JwtBearer scheme, "DealerJwt", in Program.cs, using the "DealerAuthJwt" config section.
/// </summary>
public class DealerJwtTokenService : IDealerJwtTokenService
{
    private readonly IConfiguration _config;

    public DealerJwtTokenService(IConfiguration config)
    {
        _config = config;
    }

    public string IssueToken(User user)
    {
        var section = _config.GetSection("DealerAuthJwt");
        var secret = section["Secret"] ?? throw new InvalidOperationException("DealerAuthJwt:Secret is not configured.");
        var issuer = section["Issuer"];
        var audience = section["Audience"];
        var expiryMinutes = section.GetValue<int?>("ExpiryMinutes") ?? 480;

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("app_user_id", user.Id.ToString()),
            new("app_role", user.Role.ToString()),
            new(ClaimTypes.Role, user.Role.ToString()),
            new("app_name", user.Name),
            new("app_auth_type", "Local"),
        };
        if (user.DealerId.HasValue)
            claims.Add(new Claim("app_dealer_id", user.DealerId.Value.ToString()));

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
