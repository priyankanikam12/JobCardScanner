using System.Security.Cryptography;

namespace JobCardScanner.Api.Auth;

/// <summary>
/// PBKDF2-SHA256 password hashing for local ("Dealer / Workshop Login") accounts. Deliberately
/// uses only System.Security.Cryptography (no BCrypt/Argon2 NuGet package) because this project
/// was built without the ability to run `dotnet restore` against a new package - see the README
/// "About this build" section. PBKDF2 with 100k iterations is still a reasonable, industry-
/// accepted choice (it's what ASP.NET Core Identity itself uses under the hood).
/// Stored format: "{iterations}.{saltBase64}.{hashBase64}" - self-describing, so the iteration
/// count can be bumped later without invalidating already-hashed passwords.
/// </summary>
public static class PasswordHasher
{
    private const int SaltSize = 16; // 128-bit
    private const int HashSize = 32; // 256-bit
    private const int DefaultIterations = 100_000;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, DefaultIterations, HashAlgorithmName.SHA256, HashSize);
        return $"{DefaultIterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string? storedHash)
    {
        if (string.IsNullOrWhiteSpace(storedHash)) return false;
        var parts = storedHash.Split('.', 3);
        if (parts.Length != 3) return false;
        if (!int.TryParse(parts[0], out var iterations)) return false;

        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[1]);
            expected = Convert.FromBase64String(parts[2]);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    /// <summary>Generates a URL-safe random token for forgot-password emails/SMS, and returns
    /// both the raw token (send to the user, never store it) and its SHA-256 hash (store this).</summary>
    public static (string RawToken, string TokenHash) GenerateResetToken()
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace("+", "-").Replace("/", "_").Replace("=", "");
        var hash = Convert.ToBase64String(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(raw)));
        return (raw, hash);
    }

    public static string HashResetToken(string rawToken) =>
        Convert.ToBase64String(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rawToken)));
}