namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT DMS-06): checks an uploaded photo / video by what is IN the file, not by what the browser says (the multipart Content-Type and the file name are attacker-controlled - a file declared image/png that
/// held HTML was accepted and stored as "x.png.html", then served as a web page). Use in the upload action in place of Path.GetExtension(file.FileName):
///
///     var check = await SafeUpload.ValidateAsync(file, ct: HttpContext.RequestAborted);
///     if (!check.Ok) return BadRequest(new { message = check.Error });
///     var storedName = $"{Guid.NewGuid():N}{check.Extension}";      // GUID + a fixed safe extension, never the client's
///
/// Accepted: JPEG, PNG, GIF, WebP, HEIC / HEIF, MP4, MOV, WebM, 3GP, AVI. Everything else (HTML, SVG, scripts, executables, ...) is refused. The serving side (SecurityExtensions.UseAppStaticFiles) also refuses to serve any
/// other extension, so an old file that is already on disk cannot be used either.
/// </summary>
public static class SafeUpload
{
    public const long DefaultMaxBytes = 100L * 1024 * 1024;

    public readonly record struct Result(bool Ok, string Extension, string Error);

    public static async Task<Result> ValidateAsync(IFormFile? file, long maxBytes = DefaultMaxBytes, CancellationToken ct = default)
    {
        if (file is null || file.Length == 0) return new Result(false, "", "No file was uploaded.");
        if (file.Length > maxBytes) return new Result(false, "", "The file is too large.");

        var head = new byte[16];
        var read = 0;
        await using (var s = file.OpenReadStream())
        {
            while (read < head.Length)
            {
                var n = await s.ReadAsync(head.AsMemory(read, head.Length - read), ct);
                if (n == 0) break;
                read += n;
            }
        }
        if (read < 12) return new Result(false, "", "The file is not a supported photo or video.");

        var ext = DetectExtension(head);
        return ext is null
            ? new Result(false, "", "Only photos (JPG, PNG, WebP, GIF, HEIC) and videos (MP4, MOV, WebM, 3GP, AVI) can be uploaded.")
            : new Result(true, ext, "");
    }

    private static string? DetectExtension(byte[] b)
    {
        static bool At(byte[] x, int offset, string ascii)
        {
            for (var i = 0; i < ascii.Length; i++) if (x[offset + i] != (byte)ascii[i]) return false;
            return true;
        }

        if (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return ".jpg";
        if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return ".png";
        if (At(b, 0, "GIF87a") || At(b, 0, "GIF89a")) return ".gif";
        if (At(b, 0, "RIFF") && At(b, 8, "WEBP")) return ".webp";
        if (At(b, 0, "RIFF") && At(b, 8, "AVI ")) return ".avi";
        if (b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3) return ".webm";
        if (At(b, 4, "ftyp"))
        {
            var brand = new string(new[] { (char)b[8], (char)b[9], (char)b[10], (char)b[11] });
            if (brand is "heic" or "heix" or "hevc" or "hevx" or "heim" or "heis" or "mif1" or "msf1") return ".heic";
            if (brand == "qt  ") return ".mov";
            if (brand.StartsWith("3gp", StringComparison.Ordinal) || brand.StartsWith("3g2", StringComparison.Ordinal)) return ".3gp";
            if (brand is "isom" or "iso2" or "mp41" or "mp42" or "avc1" or "M4V " or "dash" or "MSNV") return ".mp4";
        }
        return null;
    }
}
