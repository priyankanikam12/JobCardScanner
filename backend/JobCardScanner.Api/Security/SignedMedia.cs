using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-23 (VAPT DMS-14): job-card photos used to be reachable by ANYONE who held the address (only a long random file name protected them, and such links travel in e-mails and chats and never expire).
/// Now a photo address is only valid with an expiring signature: the API adds "?exp=...&amp;sig=..." to every "/uploads/jobcard-photos/..." address it returns to a signed-in user
/// (ResponseSanitizerMiddleware), and the static-file layer (SecurityExtensions.UseAppStaticFiles) answers 404 for an address without a valid, unexpired signature.
/// The signature is an HMAC-SHA256 of the path and the expiry time, so a link cannot be changed to another photo or extended. A browser &lt;img&gt;, an Android Image and a shared link all keep working without
/// any header, because the proof is in the address itself - but only for MediaLinkMinutes (default 2 hours), and only for people the API already let see that job card.
/// Key: Security:MediaSigningKey (environment variable Security__MediaSigningKey, 32+ characters, keep it out of appsettings.json). Without it a temporary key is made at start-up and every link
/// simply stops working when the API restarts (pages reload and get fresh links) - it works, but set the key.
/// </summary>
public sealed class SignedMedia
{
    public const string Prefix = "/uploads/jobcard-photos/";

    private readonly byte[] _key;
    private readonly TimeSpan _ttl;

    public SignedMedia(IOptions<SecurityOptions> options, ILogger<SignedMedia> log)
    {
        var o = options.Value;
        var secret = o.MediaSigningKey;
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
        {
            secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
            log.LogWarning("Security:MediaSigningKey is not set (needs 32+ characters): job-card photo links are signed with a temporary key and stop working when the API restarts. Set Security__MediaSigningKey.");
        }
        _key = Encoding.UTF8.GetBytes(secret);
        _ttl = TimeSpan.FromMinutes(Math.Clamp(o.MediaLinkMinutes, 5, 1440));
    }

    /// <summary>True for a stored photo path that still needs signing (it starts with the photo folder and carries no query string yet).</summary>
    public bool IsSignable(string? value) =>
        value is not null && value.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase) && value.IndexOf('?') < 0;

    public string Sign(string path) => SignUntil(path, DateTimeOffset.UtcNow.Add(_ttl));

    public string SignUntil(string path, DateTimeOffset expires)
    {
        var exp = expires.ToUnixTimeSeconds();
        return $"{path}?exp={exp}&sig={Mac(path, exp)}";
    }

    public bool Verify(string path, string? expText, string? signature)
    {
        if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(signature) || !long.TryParse(expText, out var exp)) return false;
        if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > exp) return false;
        var expected = Encoding.ASCII.GetBytes(Mac(path, exp));
        var given = Encoding.ASCII.GetBytes(signature.ToLowerInvariant());
        return expected.Length == given.Length && CryptographicOperations.FixedTimeEquals(expected, given);
    }

    private string Mac(string path, long exp)
    {
        using var h = new HMACSHA256(_key);
        return Convert.ToHexString(h.ComputeHash(Encoding.UTF8.GetBytes($"{path.ToLowerInvariant()}|{exp}"))).ToLowerInvariant();
    }
}
