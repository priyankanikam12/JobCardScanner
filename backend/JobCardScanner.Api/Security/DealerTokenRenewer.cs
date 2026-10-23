using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-23 (VAPT DMS-16: "token lifetimes of 1 hour or less with silent renewal"): turns a still-valid Dealer / Workshop token into a fresh one with the SAME claims and a new lifetime. Used only by
/// POST /api/session/renew, which is reached only with a token the API has already accepted (signature, expiry, revoked list, SessionFreshnessMiddleware). Written with the base library only (HS256 = HMAC-SHA256
/// over "header.payload"), the same signing the Dealer / Workshop login uses (a symmetric key from DealerAuthJwt:Secret), so it does not depend on DealerJwtTokenService.
/// The payload is copied as it is - every claim, including arrays - except exp / nbf / iat / jti, which are set anew.
/// </summary>
public static class DealerTokenRenewer
{
    public static string? Renew(string token, string secret, string expectedIssuer, int minutes, DateTimeOffset now, out string? error)
    {
        error = null;
        var parts = token.Split('.');
        if (parts.Length != 3) { error = "Not a token."; return null; }
        JsonObject? payload;
        try { payload = JsonNode.Parse(Decode(parts[1])) as JsonObject; }
        catch (Exception) { payload = null; }
        if (payload is null) { error = "Not a token."; return null; }
        if (!string.Equals(payload["iss"]?.GetValue<string>(), expectedIssuer, StringComparison.Ordinal)) { error = "Only a Dealer / Workshop login session is renewed here."; return null; }

        var next = new JsonObject();
        foreach (var kv in payload)
        {
            if (kv.Key is "exp" or "nbf" or "iat" or "jti") continue;
            next[kv.Key] = kv.Value?.DeepClone();
        }
        var seconds = now.ToUnixTimeSeconds();
        next["jti"] = Guid.NewGuid().ToString();
        next["iat"] = seconds;
        next["nbf"] = seconds;
        next["exp"] = now.AddMinutes(Math.Max(5, minutes)).ToUnixTimeSeconds();

        var signingInput = Encode(Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}")) + "." + Encode(Encoding.UTF8.GetBytes(next.ToJsonString()));
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return signingInput + "." + Encode(hmac.ComputeHash(Encoding.UTF8.GetBytes(signingInput)));
    }

    private static string Encode(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Decode(string s)
    {
        var b = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(b.PadRight(b.Length + (4 - b.Length % 4) % 4, '='));
    }
}
