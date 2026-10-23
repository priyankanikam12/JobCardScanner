using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT DMS-12, DMS-15): two small response clean-ups, done in one place so no controller has to change.
///   1. Outside Development, any JSON answer of an OTP route (path contains "otp") loses its "devOtpCode" property - the development OTP value the report saw in the production build (DMS-12).
///      The real fix is in OtpService (never put the code in the response when an SMS / email provider is configured); this is the safety net.
///   2. GET /api/dealers for a NON-corporate login: the rows of OTHER dealers lose their contact fields (email, phone, mobile, contact*) - a dealer keeps its own full record and the other dealers' names
///      (DMS-15). Corporate roles are unchanged.
/// Only these two kinds of response are buffered and rewritten; everything else streams through untouched.
/// </summary>
public sealed class ResponseSanitizerMiddleware
{
    private static readonly Regex ContactField = new("(e-?mail|phone|mobile|contact)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly string[] Corporate = { "CorporateAdmin", "SystemAdmin" };

    /// <summary>The only routes whose JSON carries stored photo addresses: the job-card list and search, one job card, and the two photo POSTs. An explicit list, so file downloads (the invoice PDF ...) are never buffered.</summary>
    private static readonly Regex PhotoRoutes = new(
        @"^/api/jobcards(/search|/[0-9a-fA-F-]{36}|/[0-9a-fA-F-]{36}/photos(/upload)?)?/?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static bool ReturnsPhotoAddresses(string method, string path) =>
        (HttpMethods.IsGet(method) || HttpMethods.IsPost(method)) && PhotoRoutes.IsMatch(path);

    private readonly RequestDelegate _next;
    private readonly bool _isDevelopment;
    private readonly SignedMedia _media;
    private readonly bool _allowDevTokens;

    public ResponseSanitizerMiddleware(RequestDelegate next, IWebHostEnvironment env, SignedMedia media, IOptions<SecurityOptions> options)
    {
        _next = next;
        _isDevelopment = env.IsDevelopment();
        _media = media;
        _allowDevTokens = options.Value.AllowDevTokens;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? "";
        // DMS-12: the development shortcuts "devOtpCode" and "devResetToken" never leave the API outside Development - on every OTP route and on the sign-in / password-reset routes (dealer login, customer portal).
        var stripOtp = !_isDevelopment && !_allowDevTokens
                       && (path.Contains("otp", StringComparison.OrdinalIgnoreCase)
                           || ctx.Request.Path.StartsWithSegments("/api/dealer-auth", StringComparison.OrdinalIgnoreCase)
                           || ctx.Request.Path.StartsWithSegments("/api/portal", StringComparison.OrdinalIgnoreCase));
        var role = ctx.User.FindFirst("app_role")?.Value;
        var isDealersList = HttpMethods.IsGet(ctx.Request.Method)
                            && ctx.Request.Path.StartsWithSegments("/api/dealers", StringComparison.OrdinalIgnoreCase)
                            && ctx.User.Identity?.IsAuthenticated == true
                            && role is not null
                            && !Corporate.Contains(role, StringComparer.OrdinalIgnoreCase);

        // DMS-14: every JSON answer of /api/jobcards/** that contains a stored photo address gets the address signed (see SignedMedia). Only answers that really contain one are rewritten.
        var signMedia = ctx.User.Identity?.IsAuthenticated == true && ReturnsPhotoAddresses(ctx.Request.Method, path);

        if (!stripOtp && !isDealersList && !signMedia)
        {
            await _next(ctx);
            return;
        }

        var original = ctx.Response.Body;
        using var buffer = new MemoryStream();
        ctx.Response.Body = buffer;
        try
        {
            await _next(ctx);
        }
        finally
        {
            ctx.Response.Body = original;
        }

        buffer.Position = 0;
        var isJson = ctx.Response.ContentType?.Contains("json", StringComparison.OrdinalIgnoreCase) == true && ctx.Response.StatusCode == StatusCodes.Status200OK;
        if (!isJson || buffer.Length == 0)
        {
            if (buffer.Length > 0) ctx.Response.ContentLength = buffer.Length;
            await buffer.CopyToAsync(original);
            return;
        }

        byte[] output;
        try
        {
            var text = Encoding.UTF8.GetString(buffer.ToArray());
            if (!stripOtp && !isDealersList && text.IndexOf(SignedMedia.Prefix, StringComparison.OrdinalIgnoreCase) < 0)
            {
                // nothing to change in this answer: send the original bytes untouched
                ctx.Response.ContentLength = buffer.Length;
                await original.WriteAsync(buffer.ToArray());
                return;
            }
            var node = JsonNode.Parse(text);
            if (signMedia) SignPhotoAddresses(node);
            if (stripOtp) { RemoveProperty(node, "devOtpCode"); RemoveProperty(node, "devResetToken"); }
            if (isDealersList) HideOtherDealerContacts(node, ctx.User.FindFirst("app_dealer_id")?.Value);
            output = Encoding.UTF8.GetBytes(node?.ToJsonString() ?? "null");
        }
        catch (Exception)
        {
            output = buffer.ToArray();
        }
        ctx.Response.ContentLength = output.Length;
        await original.WriteAsync(output);
    }

    /// <summary>Replaces every string value that is a stored photo address with the same address plus an expiring signature.</summary>
    private void SignPhotoAddresses(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var key in obj.Select(kv => kv.Key).ToList())
                {
                    if (obj[key] is JsonValue v && v.TryGetValue<string>(out var s) && _media.IsSignable(s)) obj[key] = _media.Sign(s);
                    else SignPhotoAddresses(obj[key]);
                }
                break;
            case JsonArray arr:
                for (var i = 0; i < arr.Count; i++)
                {
                    if (arr[i] is JsonValue v && v.TryGetValue<string>(out var s) && _media.IsSignable(s)) arr[i] = _media.Sign(s);
                    else SignPhotoAddresses(arr[i]);
                }
                break;
        }
    }

    private static void RemoveProperty(JsonNode? node, string name)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var key in obj.Select(kv => kv.Key).ToList())
                {
                    if (string.Equals(key, name, StringComparison.OrdinalIgnoreCase)) obj.Remove(key);
                    else RemoveProperty(obj[key], name);
                }
                break;
            case JsonArray arr:
                foreach (var item in arr) RemoveProperty(item, name);
                break;
        }
    }

    private static void HideOtherDealerContacts(JsonNode? node, string? ownDealerId)
    {
        if (node is not JsonArray arr) return;
        foreach (var item in arr)
        {
            if (item is not JsonObject obj) continue;
            var id = obj.FirstOrDefault(kv => string.Equals(kv.Key, "id", StringComparison.OrdinalIgnoreCase)).Value?.ToString();
            if (id is not null && ownDealerId is not null && string.Equals(id, ownDealerId, StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var key in obj.Select(kv => kv.Key).Where(k => ContactField.IsMatch(k)).ToList()) obj.Remove(key);
        }
    }
}
