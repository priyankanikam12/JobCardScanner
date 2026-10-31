using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT DMS-12, DMS-15): two small response clean-ups, done in one place so no controller has to change.
///   1. Outside Development, any JSON answer of an OTP route (path contains "otp") loses its "devOtpCode" property - the development OTP value the report saw in the production build (DMS-12).
///      The real fix is in OtpService (never put the code in the response when an SMS / email provider is configured); this is the safety net.
///   2. GET /api/dealers for a NON-corporate login: the rows of OTHER dealers lose their contact fields (email, phone, mobile, contact*) - a dealer keeps its own full record and the other dealers' names
///      (DMS-15). Corporate roles are unchanged.
///   3. 2026-10-23 (DMS-15, the part that was still open - "every authenticated user can download the complete role-to-screen permission map (22 modules x 11 roles)"): GET /api/menu-access and
///      GET /api/menu-access/role-modes for a NON-corporate login return only what that login's own role can use. Each page keeps its list of allowed roles reduced to the caller's own role (the caller's
///      Designation - Captain / ViceCaptain - counts as well): a page open to everyone stays "everyone", a page the caller may see lists only the caller's role, a page the caller may NOT see lists a single
///      placeholder "-". The sidebar logic of the web and Android apps gives exactly the same result from this reduced list, but the caller can no longer read which OTHER roles see which page, and the
///      role-modes list holds only the caller's own entry. CorporateAdmin / SystemAdmin (the Menu Access page) get the full lists.
/// Only these two kinds of response are buffered and rewritten; everything else streams through untouched.
/// </summary>
public sealed class ResponseSanitizerMiddleware
{
    /// <summary>2026-10-31 (retest DMS-15): also whatsapp / spoc / owner / person / telephone / fax - anything that names or reaches a person at another dealer.</summary>
    private static readonly Regex ContactField = new("(e-?mail|phone|mobile|contact|whats?app|spoc|owner|person|telephone|fax)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>2026-10-31 (retest DMS-15): every route that lists or shows dealers - /api/dealers (and /api/dealers/{id}), the BAPL dealer picker /api/bapl-dms/dealers (mobile, e-mail, contactPerson of EVERY dealer)
    /// and the workshop picker /api/bapl-dms/workshops. For a non-corporate login the contact fields of every row except its own dealer are removed.</summary>
    /// <summary>2026-10-31 (retest DMS-15, evidence of 30.10.2026: GET /api/dealers answered 200 with EVERY dealer's name, address, GSTIN and rep code): on these routes a dealer login gets ONLY ITS OWN dealer -
    /// a list is cut down to the caller's dealer, and a single other dealer is refused with HTTP 403. CorporateAdmin / SystemAdmin are not touched. (/api/bapl-dms/workshops stays a picker of locations: contact fields only.)</summary>
    private static readonly Regex OwnOnlyRoutes = new(@"^/api/(dealers|bapl-dms/dealers)(/.*)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex DealerRoutes = new(@"^/api/(dealers|bapl-dms/dealers|bapl-dms/workshops)(/.*)?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly string[] Corporate = { "CorporateAdmin", "SystemAdmin" };

    /// <summary>The only routes whose JSON carries stored photo addresses: the job-card list and search, one job card, and the two photo POSTs. An explicit list, so file downloads (the invoice PDF ...) are never buffered.</summary>
    private static readonly Regex PhotoRoutes = new(
        @"^/api/jobcards(/search|/[0-9a-fA-F-]{36}|/[0-9a-fA-F-]{36}/photos(/upload)?)?/?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static bool ReturnsPhotoAddresses(string method, string path) =>
        (HttpMethods.IsGet(method) || HttpMethods.IsPost(method)) && PhotoRoutes.IsMatch(path);

    private static readonly Regex MenuRoutes = new(@"^/api/menu-access(/role-modes)?/?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly RequestDelegate _next;
    private readonly bool _isDevelopment;
    private readonly SignedMedia _media;
    private readonly SecurityOptions _opt;

    public ResponseSanitizerMiddleware(RequestDelegate next, IWebHostEnvironment env, SignedMedia media, IOptions<SecurityOptions> options)
    {
        _next = next;
        _isDevelopment = env.IsDevelopment();
        _media = media;
        _opt = options.Value;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? "";
        // DMS-12: the development shortcuts "devOtpCode" and "devResetToken" never leave the API outside Development - on every OTP route and on the sign-in / password-reset routes (dealer login, customer portal).
        var stripOtp = !_isDevelopment && !_opt.AllowDevTokens
                       && (path.Contains("otp", StringComparison.OrdinalIgnoreCase)
                           || ctx.Request.Path.StartsWithSegments("/api/dealer-auth", StringComparison.OrdinalIgnoreCase)
                           || ctx.Request.Path.StartsWithSegments("/api/portal", StringComparison.OrdinalIgnoreCase));
        var role = ctx.User.FindFirst("app_role")?.Value;
        var isDealersList = HttpMethods.IsGet(ctx.Request.Method)
                            && DealerRoutes.IsMatch(path)
                            && ctx.User.Identity?.IsAuthenticated == true
                            && role is not null
                            && !Corporate.Contains(role, StringComparer.OrdinalIgnoreCase);

        var isMenuMatrix = HttpMethods.IsGet(ctx.Request.Method)
                           && MenuRoutes.IsMatch(path)
                           && ctx.User.Identity?.IsAuthenticated == true
                           && role is not null
                           && !Corporate.Contains(role, StringComparer.OrdinalIgnoreCase);

        // DMS-14: every JSON answer of /api/jobcards/** that contains a stored photo address gets the address signed (see SignedMedia). Only answers that really contain one are rewritten.
        var signMedia = ctx.User.Identity?.IsAuthenticated == true && ReturnsPhotoAddresses(ctx.Request.Method, path);

        if (!stripOtp && !isDealersList && !signMedia && !isMenuMatrix)
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
            if (!stripOtp && !isDealersList && !isMenuMatrix && text.IndexOf(SignedMedia.Prefix, StringComparison.OrdinalIgnoreCase) < 0)
            {
                // nothing to change in this answer: send the original bytes untouched
                ctx.Response.ContentLength = buffer.Length;
                await original.WriteAsync(buffer.ToArray());
                return;
            }
            var node = JsonNode.Parse(text);
            if (signMedia) SignPhotoAddresses(node);
            if (stripOtp) { RemoveProperty(node, "devOtpCode"); RemoveProperty(node, "devResetToken"); }
            var forbidden = false;
            if (isDealersList)
            {
                var ownId = ctx.User.FindFirst("app_dealer_id")?.Value;
                if (OwnOnlyRoutes.IsMatch(path)) forbidden = !KeepOwnDealerOnly(node, ownId, (await GetStateAsync(ctx))?.DealerBaplCode);
                HideOtherDealerContacts(node, ownId);
            }
            if (isMenuMatrix) TrimMenuMatrix(node, path, await MenuIdentitiesAsync(ctx, role!));
            if (forbidden)
            {
                ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                output = Encoding.UTF8.GetBytes("{\"message\":\"You are not allowed to access another dealer's data.\"}");
            }
            else output = Encoding.UTF8.GetBytes(node?.ToJsonString() ?? "null");
        }
        catch (Exception)
        {
            // 2026-10-31: fail CLOSED for the two answers that exist to hide data - if the rewrite itself fails, the unfiltered answer must not go out. (A failed photo-address signing may still send the original.)
            if (isDealersList || isMenuMatrix)
            {
                ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
                output = Encoding.UTF8.GetBytes("{\"message\":\"The response could not be processed.\"}");
            }
            else output = buffer.ToArray();
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

    /// <summary>The role names the caller's own sidebar logic looks for: its role and its own Designation - nothing else. The designation comes from the token's "designation" claim or, when the token has none,
    /// from the user's row (the same cached look-up as the session checks). Only when the designation cannot be read at all (no look-up available, database error) the two designations Captain / ViceCaptain are
    /// kept, as before, so the sidebar of a Captain never loses a page. 2026-10-31 (retest DMS-15): until now those two names were shown to every login.</summary>
    /// <summary>The caller's row (role, dealer, designation, dealer BAPL code) through the same cached look-up the session checks use; null when it cannot be read.</summary>
    private async Task<SessionUserState?> GetStateAsync(HttpContext ctx)
    {
        if (!Guid.TryParse(ctx.User.FindFirst("app_user_id")?.Value, out var userId)) return null;
        var lookup = ctx.RequestServices.GetService<ISessionUserLookup>();
        var cache = ctx.RequestServices.GetService<IMemoryCache>();
        if (lookup is null || cache is null) return null;
        try
        {
            return await cache.GetOrCreateAsync($"sf:{userId}", async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(Math.Max(5, _opt.SessionCheckSeconds));
                return await lookup.FindAsync(userId, ctx.RequestAborted);
            });
        }
        catch (Exception) { return null; }
    }

    /// <summary>Is this dealer row the caller's own? By its id, or by a code (code / baplDmsDealerCode / dealerCode) equal to the caller's dealer BAPL code.</summary>
    private static bool IsOwnDealer(JsonObject obj, string? ownId, string? ownCode)
    {
        string? Get(string name) => obj.FirstOrDefault(kv => string.Equals(kv.Key, name, StringComparison.OrdinalIgnoreCase)).Value?.ToString()?.Trim();
        var id = Get("id");
        if (id is not null && ownId is not null && string.Equals(id, ownId, StringComparison.OrdinalIgnoreCase)) return true;
        if (!string.IsNullOrWhiteSpace(ownCode))
            foreach (var key in new[] { "code", "baplDmsDealerCode", "dealerCode" })
                if (string.Equals(Get(key), ownCode.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    /// <summary>A list is cut down to the caller's own dealer (a row that cannot be recognised as its own is removed - fail closed); a single dealer object that is not its own returns false (HTTP 403).</summary>
    private static bool KeepOwnDealerOnly(JsonNode? node, string? ownId, string? ownCode)
    {
        switch (node)
        {
            case JsonArray arr:
                for (var i = arr.Count - 1; i >= 0; i--)
                    if (arr[i] is JsonObject row && !IsOwnDealer(row, ownId, ownCode)) arr.RemoveAt(i);
                return true;
            case JsonObject single:
                return IsOwnDealer(single, ownId, ownCode);
            default:
                return true;
        }
    }

    private async Task<HashSet<string>> MenuIdentitiesAsync(HttpContext ctx, string role)
    {
        var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { role };
        var designation = ctx.User.FindFirst("designation")?.Value;
        var known = !string.IsNullOrWhiteSpace(designation);
        if (!known)
        {
            var state = await GetStateAsync(ctx);
            if (state is not null) { designation = state.Designation; known = true; }
        }
        if (!string.IsNullOrWhiteSpace(designation)) keep.Add(designation);
        else if (!known) { keep.Add("Captain"); keep.Add("ViceCaptain"); }
        return keep;
    }

    /// <summary>The page list ({ navKey, roles[] }) or the role-modes list ({ role, onlyShowChecked }) reduced to what the caller's own identity can use.</summary>
    private static void TrimMenuMatrix(JsonNode? node, string path, HashSet<string> keep)
    {
        if (node is not JsonArray arr) return;
        var isModes = path.Contains("role-modes", StringComparison.OrdinalIgnoreCase);
        if (isModes)
        {
            for (var i = arr.Count - 1; i >= 0; i--)
            {
                var name = (arr[i] as JsonObject)?.FirstOrDefault(kv => string.Equals(kv.Key, "role", StringComparison.OrdinalIgnoreCase)).Value?.ToString();
                if (name is null || !keep.Contains(name)) arr.RemoveAt(i);
            }
            return;
        }
        foreach (var item in arr)
        {
            if (item is not JsonObject obj) continue;
            var key = obj.Select(kv => kv.Key).FirstOrDefault(k => string.Equals(k, "roles", StringComparison.OrdinalIgnoreCase));
            if (key is null || obj[key] is not JsonArray roles || roles.Count == 0) continue;          // no list = "everyone": nothing to hide
            var mine = roles.Select(r => r?.ToString()).Where(r => r is not null && keep.Contains(r)).ToList();
            obj[key] = new JsonArray((mine.Count > 0 ? mine : new List<string?> { "-" }).Select(r => (JsonNode?)JsonValue.Create(r)).ToArray());
        }
    }

    private static void HideOtherDealerContacts(JsonNode? node, string? ownDealerId)
    {
        switch (node)
        {
            case JsonArray arr:
                foreach (var item in arr) HideOtherDealerContacts(item, ownDealerId);
                break;
            case JsonObject obj:
                var id = obj.FirstOrDefault(kv => string.Equals(kv.Key, "id", StringComparison.OrdinalIgnoreCase)).Value?.ToString();
                var isOwn = id is not null && ownDealerId is not null && string.Equals(id, ownDealerId, StringComparison.OrdinalIgnoreCase);
                if (!isOwn) foreach (var key in obj.Select(kv => kv.Key).Where(k => ContactField.IsMatch(k)).ToList()) obj.Remove(key);
                // a wrapper such as { items: [ ... ] } or { dealer: { ... } }: look inside it too
                foreach (var child in obj.Select(kv => kv.Value).Where(v => v is JsonArray or JsonObject).ToList()) HideOtherDealerContacts(child, ownDealerId);
                break;
        }
    }
}
