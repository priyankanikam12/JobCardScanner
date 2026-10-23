using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-23 (VAPT DMS-12, the part that was still open): "The customer OTP login returns a different response for unregistered numbers ('No account found...') versus registered ones ('OTP sent...')".
/// Done in one place, in front of the portal OTP controller, so OtpService and the controller need no change:
///   POST /api/portal/otp/request - every outcome that says whether the number is registered becomes ONE answer: HTTP 200 { otpRequestId, message: "If this number is registered, an OTP has been sent to it." }.
///        A registered number gets its real otpRequestId; an unregistered one gets a random id that can never be verified. The answer carries no other field (so nothing stale can give a fabricated answer away),
///        and it always takes at least Security:OtpMinResponseMs (a real SMS takes longer than a refusal). A refusal that does not say anything about the number - a badly formed number (HTTP 400) or the rate limit
///        (HTTP 429) - is left alone.
///   POST /api/portal/otp/verify  - a wrong code, an expired request and an unknown request id all answer the same HTTP 400 "Invalid or expired OTP." (after the same minimum time); the rate limit (429) and a success are untouched.
/// Security:AllowDevTokens=true (a temporary switch for sites with no SMS provider) keeps a "devOtpCode" in the answer; an unregistered number then gets a random six-digit "devOtpCode" too, so even that mode does not
/// tell the two apart. The page that shows "No account found" is fixed in the web app (PortalLoginPage.tsx).
/// </summary>
public sealed class OtpEnumerationMiddleware
{
    public const string RequestMessage = "If this number is registered, an OTP has been sent to it.";
    public const string VerifyMessage = "Invalid or expired OTP.";

    private static readonly Regex NoAccount = new("(no account|not found|not registered|no customer|does not exist|unknown number|no user)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex RequestRoute = new(@"^/api/portal/otp/request/?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex VerifyRoute = new(@"^/api/portal/otp/verify/?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static volatile bool _lastSuccessHadDevCode;

    private readonly RequestDelegate _next;
    private readonly SecurityOptions _opt;

    public OtpEnumerationMiddleware(RequestDelegate next, IOptions<SecurityOptions> opt)
    {
        _next = next;
        _opt = opt.Value;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? "";
        var isRequest = HttpMethods.IsPost(ctx.Request.Method) && RequestRoute.IsMatch(path);
        var isVerify = HttpMethods.IsPost(ctx.Request.Method) && VerifyRoute.IsMatch(path);
        if (!isRequest && !isVerify)
        {
            await _next(ctx);
            return;
        }

        var clock = Stopwatch.StartNew();
        var original = ctx.Response.Body;
        using var buffer = new MemoryStream();
        ctx.Response.Body = buffer;
        try { await _next(ctx); }
        finally { ctx.Response.Body = original; }

        var status = ctx.Response.StatusCode;
        var bytes = buffer.ToArray();
        JsonNode? body = null;
        try { if (bytes.Length > 0) body = JsonNode.Parse(Encoding.UTF8.GetString(bytes)); } catch (Exception) { /* not JSON */ }
        var message = (body as JsonObject)?.FirstOrDefault(kv => string.Equals(kv.Key, "message", StringComparison.OrdinalIgnoreCase)).Value?.ToString();

        object? replacement = null;
        var rewrite = false;
        var padTime = false;

        if (isRequest)
        {
            if (status >= 200 && status < 300 && body is JsonObject ok)
            {
                var devCode = ok.FirstOrDefault(kv => string.Equals(kv.Key, "devOtpCode", StringComparison.OrdinalIgnoreCase)).Value?.ToString();
                _lastSuccessHadDevCode = devCode is not null;
                replacement = Answer(ok.FirstOrDefault(kv => string.Equals(kv.Key, "otpRequestId", StringComparison.OrdinalIgnoreCase)).Value?.ToString() ?? Guid.NewGuid().ToString(), devCode);
                rewrite = true;
                padTime = true;
            }
            else if (status != StatusCodes.Status429TooManyRequests && (status == StatusCodes.Status404NotFound || (status >= 400 && message is not null && NoAccount.IsMatch(message))))
            {
                replacement = Answer(Guid.NewGuid().ToString(), _opt.AllowDevTokens && _lastSuccessHadDevCode ? Random.Shared.Next(100000, 1000000).ToString() : null);
                rewrite = true;
                padTime = true;
            }
        }
        else if (status >= 400 && status != StatusCodes.Status429TooManyRequests)
        {
            replacement = new { message = VerifyMessage };
            rewrite = true;
            padTime = true;
        }

        if (padTime)
        {
            var left = TimeSpan.FromMilliseconds(Math.Max(0, _opt.OtpMinResponseMs)) - clock.Elapsed;
            if (left > TimeSpan.Zero) await Task.Delay(left, ctx.RequestAborted);
        }

        if (!rewrite)
        {
            if (bytes.Length > 0) ctx.Response.ContentLength = bytes.Length;
            await original.WriteAsync(bytes);
            return;
        }

        ctx.Response.StatusCode = isRequest ? StatusCodes.Status200OK : StatusCodes.Status400BadRequest;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        var output = Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(replacement, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));
        ctx.Response.ContentLength = output.Length;
        await original.WriteAsync(output);
    }

    private static object Answer(string otpRequestId, string? devOtpCode) =>
        devOtpCode is null
            ? new { otpRequestId, message = RequestMessage }
            : new { otpRequestId, message = RequestMessage, devOtpCode };
}
