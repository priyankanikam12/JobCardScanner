using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using JobCardScanner.Api.Options;

namespace JobCardScanner.Api.Services.Zoho;

/// <summary>
/// 2026-10-28 - calls Zoho Books' own REST API directly, exactly as "BGauss_DMS_Zoho_Books_API_Payloads.docx" documents it (tested by Learnall against Magnemite's real org on
/// 26.10.2026): OAuth2 via ZohoOAuthTokenService, every endpoint from sections 4-7, and the error handling from section 8's table. This is the NEW path - see the note at the top
/// of ZohoBooksOptions.cs for how it differs from the existing "ZohoPush:Provider = ZohoBooks" webhook mode already in ZohoPushDispatcher.
///
/// Every public method returns ZohoBooksResult&lt;T&gt; - Success/Data on a 0-code reply, or a classified failure (Retryable true for the cases section 8 says to retry: HTTP
/// 429, 408, 5xx, a network error, or an access token that was still rejected after one refresh; false for everything else, matching "Do not retry automatically; report the
/// message to Learnall"). Callers (ZohoPushDispatcher, controllers) never need to inspect an HTTP status or parse a Zoho reply themselves.
///
/// Registered in Program.cs as a true singleton (see ZohoOAuthTokenService.cs's doc comment and ZOHO_BOOKS_INTEGRATION.md section 4 for why AddHttpClient&lt;T&gt;() +
/// AddSingleton&lt;T&gt;() is the wrong pattern here):
///   builder.Services.Configure&lt;ZohoBooksOptions&gt;(builder.Configuration.GetSection(ZohoBooksOptions.SectionName));
///   builder.Services.AddHttpClient("ZohoOAuth");
///   builder.Services.AddHttpClient("ZohoBooksApi", c => c.Timeout = TimeSpan.FromSeconds(30));
///   builder.Services.AddSingleton&lt;ZohoOAuthTokenService&gt;(sp => new ZohoOAuthTokenService(
///       sp.GetRequiredService&lt;IHttpClientFactory&gt;().CreateClient("ZohoOAuth"),
///       sp.GetRequiredService&lt;IOptions&lt;ZohoBooksOptions&gt;&gt;(),
///       sp.GetRequiredService&lt;ILogger&lt;ZohoOAuthTokenService&gt;&gt;()));
///   builder.Services.AddSingleton&lt;ZohoBooksApiClient&gt;(sp => new ZohoBooksApiClient(
///       sp.GetRequiredService&lt;IHttpClientFactory&gt;().CreateClient("ZohoBooksApi"),
///       sp.GetRequiredService&lt;IOptions&lt;ZohoBooksOptions&gt;&gt;(),
///       sp.GetRequiredService&lt;ZohoOAuthTokenService&gt;(),
///       sp.GetRequiredService&lt;ILogger&lt;ZohoBooksApiClient&gt;&gt;()));
/// </summary>
public sealed class ZohoBooksApiClient
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,   // ZohoUpdateItemRequest etc.: "send only the fields that changed" (section 4.3)
    };

    private readonly HttpClient _http;
    private readonly ZohoBooksOptions _options;
    private readonly ZohoOAuthTokenService _tokens;
    private readonly ILogger<ZohoBooksApiClient> _logger;

    // Section 3 / RateLimitPerMinute (document: "100 API calls a minute" for this org) - a simple fixed-interval throttle, not a true token bucket: good enough to keep a
    // backlog drain or a bulk sync under the limit without hammering Zoho into its own HTTP 429 (section 8).
    private readonly SemaphoreSlim _throttleLock = new(1, 1);
    private DateTime _lastCallUtc = DateTime.MinValue;

    public ZohoBooksApiClient(HttpClient http, IOptions<ZohoBooksOptions> options, ZohoOAuthTokenService tokens, ILogger<ZohoBooksApiClient> logger)
    {
        _http = http;
        _options = options.Value;
        _tokens = tokens;
        _logger = logger;
    }

    // ============================================================================================================ 4. Items

    /// <summary>Section 4.1: "Every item push starts with a lookup by item code... No result means create; one result means use its item_id for update, discontinue or
    /// re-activate." Returns Data = null (Success = true) when the item is not in Zoho yet - that is not a failure.</summary>
    public async Task<ZohoBooksResult<ZohoItem?>> FindItemBySkuAsync(string itemCode, CancellationToken ct)
    {
        var r = await CallAsync<ZohoItemListResponse>(HttpMethod.Get, $"/items?sku={Uri.EscapeDataString(itemCode)}", null, ct);
        if (!r.Success) return Carry<ZohoItemListResponse, ZohoItem?>(r);
        return ZohoBooksResult<ZohoItem?>.Ok(r.Data!.Items.FirstOrDefault(), r.HttpStatus ?? 200, r.ZohoCode ?? 0, r.Message);
    }

    /// <summary>Section 4.2. Runs the DataAnnotations on the request plus the igst/cgst/sgst cross-field check (ZohoBooksValidation) before sending - "Zoho does not check
    /// these and accepts wrong values" (section 8). Item-name/SKU UNIQUENESS is not checkable on this one object; call FindItemBySkuAsync first (section 4.1's own
    /// instruction) - if Zoho still answers code 1001 ("This SKU ... already exists" / "Item ... already exists", section 4.5), that is returned as a non-retryable failure
    /// so the caller can fall back to find-then-update instead of retrying a create that will never succeed.</summary>
    public async Task<ZohoBooksResult<ZohoItem>> CreateItemAsync(ZohoCreateItemRequest request, CancellationToken ct)
    {
        var errors = ZohoBooksValidation.ValidateDataAnnotations(request);
        if (errors.Count > 0) return ZohoBooksResult<ZohoItem>.Fail(null, null, string.Join(" ", errors), retryable: false);

        var r = await CallAsync<ZohoItemResponse>(HttpMethod.Post, "/items", request, ct);
        if (!r.Success) return Carry<ZohoItemResponse, ZohoItem>(r);
        return ZohoBooksResult<ZohoItem>.Ok(r.Data!.Item!, r.HttpStatus ?? 201, r.ZohoCode ?? 0, r.Message);
    }

    /// <summary>Section 4.3: "Send only the fields that changed. Fields not sent stay as they are." - null properties on the request are left out of the JSON body
    /// (JsonOpts.DefaultIgnoreCondition above), not sent as explicit nulls.</summary>
    public async Task<ZohoBooksResult<ZohoItem>> UpdateItemAsync(string itemId, ZohoUpdateItemRequest request, CancellationToken ct)
    {
        var errors = ZohoBooksValidation.ValidateDataAnnotations(request);
        if (errors.Count > 0) return ZohoBooksResult<ZohoItem>.Fail(null, null, string.Join(" ", errors), retryable: false);

        var r = await CallAsync<ZohoItemResponse>(HttpMethod.Put, $"/items/{Uri.EscapeDataString(itemId)}", request, ct);
        if (!r.Success) return Carry<ZohoItemResponse, ZohoItem>(r);
        return ZohoBooksResult<ZohoItem>.Ok(r.Data!.Item!, r.HttpStatus ?? 200, r.ZohoCode ?? 0, r.Message);
    }

    /// <summary>Section 4.1 + 4.4 combined, matching the document's own flow exactly: look the item up by code; no result = create it; a result = update whatever changed
    /// (and, if active/inactive no longer matches the DMS status, flip it). This is the single call ZohoPushDispatcher should use instead of calling Find/Create/Update
    /// itself - see the integration note in ZOHO_BOOKS_INTEGRATION.md.</summary>
    public async Task<ZohoBooksResult<ZohoItem>> UpsertItemAsync(ZohoCreateItemRequest createRequest, bool shouldBeActive, CancellationToken ct)
    {
        var found = await FindItemBySkuAsync(createRequest.Sku, ct);
        if (!found.Success) return ZohoBooksResult<ZohoItem>.Fail(found.HttpStatus, found.ZohoCode, found.Message, found.Retryable, found.ConflictingId);

        if (found.Data is null)
        {
            var created = await CreateItemAsync(createRequest, ct);
            if (created.Success || created.ZohoCode != 1001) return created;
            // code 1001 racing with another create (section 4.5): look it up again and fall through to update instead of failing
            found = await FindItemBySkuAsync(createRequest.Sku, ct);
            if (!found.Success || found.Data is null)
                return ZohoBooksResult<ZohoItem>.Fail(created.HttpStatus, created.ZohoCode, created.Message, retryable: false);
        }

        var itemId = found.Data!.ItemId;
        var update = new ZohoUpdateItemRequest
        {
            Name = createRequest.Name,
            ItemType = createRequest.ItemType,
            Unit = createRequest.Unit,
            HsnOrSac = createRequest.HsnOrSac,
            Rate = createRequest.Rate,
            AccountId = createRequest.AccountId,
            PurchaseRate = createRequest.PurchaseRate,
            PurchaseAccountId = createRequest.PurchaseAccountId,
            InventoryAccountId = createRequest.InventoryAccountId,
            ItemTaxPreferences = createRequest.ItemTaxPreferences,
        };
        var updated = await UpdateItemAsync(itemId, update, ct);
        if (!updated.Success) return updated;

        var currentlyActive = !string.Equals(found.Data.Status, "inactive", StringComparison.OrdinalIgnoreCase);
        if (currentlyActive != shouldBeActive)
        {
            var toggled = await SetItemActiveAsync(itemId, shouldBeActive, ct);
            if (!toggled.Success) return ZohoBooksResult<ZohoItem>.Fail(toggled.HttpStatus, toggled.ZohoCode, toggled.Message, toggled.Retryable);
        }
        return updated;
    }

    /// <summary>Section 4.4: POST /items/{id}/active or /items/{id}/inactive, no body. Zoho calls the item a "variant" in this one reply ("The variant has been marked as
    /// inactive/active") - it is the same item; this method still returns through the normal item-style envelope check (code/message only - there is no item body to parse).</summary>
    public async Task<ZohoBooksResult<string>> SetItemActiveAsync(string itemId, bool active, CancellationToken ct)
    {
        var path = $"/items/{Uri.EscapeDataString(itemId)}/{(active ? "active" : "inactive")}";
        var r = await CallAsync<ZohoApiEnvelope>(HttpMethod.Post, path, null, ct);
        return r.Success
            ? ZohoBooksResult<string>.Ok(r.Data!.Message ?? "", r.HttpStatus ?? 200, r.ZohoCode ?? 0, r.Message)
            : ZohoBooksResult<string>.Fail(r.HttpStatus, r.ZohoCode, r.Message, r.Retryable, r.ConflictingId);
    }

    // ============================================================================================================ 5. Inventory adjustments

    /// <summary>Section 5. ReferenceNumber must be unique in the DMS (section 8); Zoho itself does not enforce that, so a duplicate adjustment number is not caught by this
    /// call - the DMS caller is responsible for not re-sending the same adjustment twice (the same "unique outbox key" discipline ZohoPushStore already uses for
    /// customer/item events).</summary>
    public async Task<ZohoBooksResult<ZohoInventoryAdjustment>> CreateInventoryAdjustmentAsync(ZohoCreateInventoryAdjustmentRequest request, CancellationToken ct)
    {
        var errors = ZohoBooksValidation.ValidateDataAnnotations(request);
        if (errors.Count > 0) return ZohoBooksResult<ZohoInventoryAdjustment>.Fail(null, null, string.Join(" ", errors), retryable: false);

        var r = await CallAsync<ZohoInventoryAdjustmentResponse>(HttpMethod.Post, "/inventoryadjustments", request, ct);
        if (!r.Success) return Carry<ZohoInventoryAdjustmentResponse, ZohoInventoryAdjustment>(r);
        return ZohoBooksResult<ZohoInventoryAdjustment>.Ok(r.Data!.InventoryAdjustment!, r.HttpStatus ?? 201, r.ZohoCode ?? 0, r.Message);
    }

    // ============================================================================================================ 6. Customers

    /// <summary>Section 6.1: "Customers are created and found only by the DMS customer ID ... Never by name." Returns Data = null (Success = true) when the customer is not
    /// in Zoho yet.</summary>
    public async Task<ZohoBooksResult<ZohoContact?>> FindCustomerByDmsIdAsync(string dmsCustomerId, CancellationToken ct)
    {
        var r = await CallAsync<ZohoContactListResponse>(HttpMethod.Get, $"/contacts?cf_bgauss_dms_customer_id={Uri.EscapeDataString(dmsCustomerId)}", null, ct);
        if (!r.Success) return Carry<ZohoContactListResponse, ZohoContact?>(r);
        return ZohoBooksResult<ZohoContact?>.Ok(r.Data!.Contacts.FirstOrDefault(), r.HttpStatus ?? 200, r.ZohoCode ?? 0, r.Message);
    }

    /// <summary>Section 6.2. Zoho refuses a second customer with the same DMS customer ID with code 120303 ("The value ... in the Bgauss DMS Customer ID field has been
    /// added already") and returns the existing contact_id in error_info - that id is surfaced on the result as ConflictingId so the caller can use it directly instead of
    /// treating this as a plain failure.</summary>
    public async Task<ZohoBooksResult<ZohoContact>> CreateCustomerAsync(ZohoCreateContactRequest request, CancellationToken ct)
    {
        var errors = ZohoBooksValidation.ValidateDataAnnotations(request);
        errors.AddRange(ZohoBooksValidation.ValidateCustomerGstConsistency(request));
        if (errors.Count > 0) return ZohoBooksResult<ZohoContact>.Fail(null, null, string.Join(" ", errors), retryable: false);

        var r = await CallAsync<ZohoContactResponse>(HttpMethod.Post, "/contacts", request, ct);
        if (!r.Success) return Carry<ZohoContactResponse, ZohoContact>(r);
        return ZohoBooksResult<ZohoContact>.Ok(r.Data!.Contact!, r.HttpStatus ?? 201, r.ZohoCode ?? 0, r.Message);
    }

    /// <summary>Section 6's exact flow: "For each repair bill, the DMS looks up the customer by the DMS customer ID (6.1). If a customer with that ID exists, the invoice
    /// is created for that customer. If it does not exist, the customer is created first (6.2)." This is the method ZohoPushDispatcher's invoice path should call - see the
    /// open question in ZOHO_BOOKS_INTEGRATION.md about this versus the existing ledger-change customer push.</summary>
    public async Task<ZohoBooksResult<ZohoContact>> FindOrCreateCustomerAsync(string dmsCustomerId, ZohoCreateContactRequest createRequest, CancellationToken ct)
    {
        var found = await FindCustomerByDmsIdAsync(dmsCustomerId, ct);
        if (!found.Success) return ZohoBooksResult<ZohoContact>.Fail(found.HttpStatus, found.ZohoCode, found.Message, found.Retryable, found.ConflictingId);
        if (found.Data is not null) return ZohoBooksResult<ZohoContact>.Ok(found.Data!, found.HttpStatus ?? 200, found.ZohoCode ?? 0, found.Message);

        var created = await CreateCustomerAsync(createRequest, ct);
        if (created.Success || created.ZohoCode != 120303 || created.ConflictingId is null) return created;
        // code 120303 racing with another create: the existing contact_id is already in error_info (Carry puts it on ConflictingId) - look it up by the id Zoho gave back
        var retry = await FindCustomerByDmsIdAsync(dmsCustomerId, ct);
        return retry.Success && retry.Data is not null
            ? ZohoBooksResult<ZohoContact>.Ok(retry.Data!, retry.HttpStatus ?? 200, retry.ZohoCode ?? 0, retry.Message)
            : ZohoBooksResult<ZohoContact>.Fail(created.HttpStatus, created.ZohoCode, created.Message, retryable: false, created.ConflictingId);
    }

    // ============================================================================================================ 7. Invoices

    /// <summary>Section 7.1. The query string ALREADY carries ignore_auto_number_generation=true - CallAsync appends organization_id with '&amp;' because the path already
    /// has a '?' in it, matching the document's "must be sent exactly like this" instruction. Code 1001 ("Invoice ... already exists" - section 7, "Rules Zoho enforces")
    /// is returned as a non-retryable failure; per the document the caller should treat that as already-delivered, not as an error to fix and resend.</summary>
    public async Task<ZohoBooksResult<ZohoInvoice>> CreateInvoiceAsync(ZohoCreateInvoiceRequest request, CancellationToken ct)
    {
        var errors = ZohoBooksValidation.ValidateDataAnnotations(request);
        if (errors.Count > 0) return ZohoBooksResult<ZohoInvoice>.Fail(null, null, string.Join(" ", errors), retryable: false);

        var r = await CallAsync<ZohoInvoiceResponse>(HttpMethod.Post, "/invoices?ignore_auto_number_generation=true", request, ct);
        if (!r.Success) return Carry<ZohoInvoiceResponse, ZohoInvoice>(r);
        return ZohoBooksResult<ZohoInvoice>.Ok(r.Data!.Invoice!, r.HttpStatus ?? 201, r.ZohoCode ?? 0, r.Message);
    }

    /// <summary>Section 7.2: "Stock at the invoice's location goes down by every line's quantity" only once this is called - creating the invoice (draft) does not move
    /// stock. Code 4023 ("Marking a void invoice as sent") is returned as a non-retryable failure (section 8: "Do not retry").</summary>
    public async Task<ZohoBooksResult<string>> MarkInvoiceSentAsync(string invoiceId, CancellationToken ct)
    {
        var r = await CallAsync<ZohoApiEnvelope>(HttpMethod.Post, $"/invoices/{Uri.EscapeDataString(invoiceId)}/status/sent", null, ct);
        return r.Success
            ? ZohoBooksResult<string>.Ok(r.Data!.Message ?? "", r.HttpStatus ?? 200, r.ZohoCode ?? 0, r.Message)
            : ZohoBooksResult<string>.Fail(r.HttpStatus, r.ZohoCode, r.Message, r.Retryable, r.ConflictingId);
    }

    /// <summary>Section 7.4: "Bill cancelled in the DMS: void" - "the stock comes back."</summary>
    public async Task<ZohoBooksResult<string>> VoidInvoiceAsync(string invoiceId, CancellationToken ct)
    {
        var r = await CallAsync<ZohoApiEnvelope>(HttpMethod.Post, $"/invoices/{Uri.EscapeDataString(invoiceId)}/status/void", null, ct);
        return r.Success
            ? ZohoBooksResult<string>.Ok(r.Data!.Message ?? "", r.HttpStatus ?? 200, r.ZohoCode ?? 0, r.Message)
            : ZohoBooksResult<string>.Fail(r.HttpStatus, r.ZohoCode, r.Message, r.Retryable, r.ConflictingId);
    }

    /// <summary>Section 7.3, by the DMS bill number. "void invoices are included."</summary>
    public async Task<ZohoBooksResult<ZohoInvoice?>> FindInvoiceByNumberAsync(string billNumber, CancellationToken ct)
    {
        var r = await CallAsync<ZohoInvoiceListResponse>(HttpMethod.Get, $"/invoices?invoice_number={Uri.EscapeDataString(billNumber)}", null, ct);
        if (!r.Success) return Carry<ZohoInvoiceListResponse, ZohoInvoice?>(r);
        return ZohoBooksResult<ZohoInvoice?>.Ok(r.Data!.Invoices.FirstOrDefault(), r.HttpStatus ?? 200, r.ZohoCode ?? 0, r.Message);
    }

    /// <summary>Section 7.3, by the DMS repair bill id (also exact, tested) - useful when the DMS bill number scheme ever changes but the internal id does not.</summary>
    public async Task<ZohoBooksResult<ZohoInvoice?>> FindInvoiceByDmsIdAsync(string dmsRepairBillId, CancellationToken ct)
    {
        var r = await CallAsync<ZohoInvoiceListResponse>(HttpMethod.Get, $"/invoices?cf_bgauss_dms_invoice_id={Uri.EscapeDataString(dmsRepairBillId)}", null, ct);
        if (!r.Success) return Carry<ZohoInvoiceListResponse, ZohoInvoice?>(r);
        return ZohoBooksResult<ZohoInvoice?>.Ok(r.Data!.Invoices.FirstOrDefault(), r.HttpStatus ?? 200, r.ZohoCode ?? 0, r.Message);
    }

    // ============================================================================================================ plumbing

    /// <summary>Re-wraps a failed ZohoBooksResult&lt;TFrom&gt; as ZohoBooksResult&lt;TTo&gt; without losing HttpStatus/ZohoCode/Message/Retryable/ConflictingId - used after
    /// every CallAsync that failed, since the envelope type (e.g. ZohoItemListResponse) is never the type the public method actually returns (e.g. ZohoItem?).</summary>
    private static ZohoBooksResult<TTo> Carry<TFrom, TTo>(ZohoBooksResult<TFrom> from) =>
        ZohoBooksResult<TTo>.Fail(from.HttpStatus, from.ZohoCode, from.Message, from.Retryable, from.ConflictingId);

    private async Task ThrottleAsync(CancellationToken ct)
    {
        await _throttleLock.WaitAsync(ct);
        try
        {
            var perMinute = Math.Max(1, _options.RateLimitPerMinute);
            var minIntervalMs = (int)Math.Ceiling(60_000.0 / perMinute);
            var wait = TimeSpan.FromMilliseconds(minIntervalMs) - (DateTime.UtcNow - _lastCallUtc);
            if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
            _lastCallUtc = DateTime.UtcNow;
        }
        finally { _throttleLock.Release(); }
    }

    private async Task<(int? HttpStatus, string? Body, Exception? NetworkError)> SendRawAsync(HttpMethod method, string pathAndQuery, object? body, string accessToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_options.OrganizationId))
            return (null, null, new InvalidOperationException("ZohoBooksApi:OrganizationId is not configured (Payloads doc section 3: 60074559380 for Magnemite, in testing)."));

        var separator = pathAndQuery.Contains('?') ? "&" : "?";
        var url = $"{_options.ApiBaseUrl.TrimEnd('/')}{pathAndQuery}{separator}organization_id={Uri.EscapeDataString(_options.OrganizationId)}";
        try
        {
            using var req = new HttpRequestMessage(method, url);
            // "Zoho-oauthtoken <token>" - "no brackets, quotes or the word Bearer" (section 2)
            req.Headers.TryAddWithoutValidation("Authorization", $"Zoho-oauthtoken {accessToken}");
            if (body is not null)
            {
                var json = JsonSerializer.Serialize(body, body.GetType(), JsonOpts);
                req.Content = new StringContent(json, Encoding.UTF8, "application/json");
            }
            using var resp = await _http.SendAsync(req, ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            return ((int)resp.StatusCode, text, null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { return (null, null, ex); }
    }

    /// <summary>The one place every endpoint goes through: throttles, attaches the OAuth token, sends, retries ONCE on HTTP 401 (section 8: "57 / HTTP 401 ... Refresh the
    /// token, retry once"), then classifies the reply against section 8's table. TEnvelope must derive from ZohoApiEnvelope (every Zoho Books reply has at least code +
    /// message).</summary>
    private async Task<ZohoBooksResult<TEnvelope>> CallAsync<TEnvelope>(HttpMethod method, string pathAndQuery, object? body, CancellationToken ct) where TEnvelope : ZohoApiEnvelope
    {
        await ThrottleAsync(ct);
        string token;
        try { token = await _tokens.GetAccessTokenAsync(ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            // 2026-10-28 fix: a missing/misconfigured ClientId/ClientSecret/RefreshToken/AccountsBaseUrl used to throw straight out of here, uncaught - the exception then
            // propagated out of ZohoBooksDirectRunner's loop with NO outbox row ever marked Sent or Failed, so items looked like they were being pushed (ops endpoint
            // returned 200, logs just showed a generic "a dispatcher cycle failed" warning once per cycle) while nothing ever actually reached Zoho. Now it is a normal,
            // non-retryable failure the caller can see and act on.
            _logger.LogError(ex, "Zoho Books: could not obtain an OAuth access token - check ZohoBooksApi:ClientId/ClientSecret/RefreshToken (user secrets/env vars) and ZohoBooksApi:AccountsBaseUrl.");
            return ZohoBooksResult<TEnvelope>.Fail(null, null, $"OAuth token error: {ex.Message}", retryable: false);
        }
        var (status, text, netError) = await SendRawAsync(method, pathAndQuery, body, token, ct);

        if (status == 401)
        {
            _logger.LogInformation("Zoho Books call got HTTP 401 - refreshing the access token and retrying once (section 8).");
            try { token = await _tokens.ForceRefreshAsync(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Zoho Books: token refresh after a 401 also failed.");
                return ZohoBooksResult<TEnvelope>.Fail(401, null, $"OAuth token refresh error: {ex.Message}", retryable: false);
            }
            await ThrottleAsync(ct);
            (status, text, netError) = await SendRawAsync(method, pathAndQuery, body, token, ct);
        }

        if (netError is not null)
            return ZohoBooksResult<TEnvelope>.Fail(null, null, $"{netError.GetType().Name}: {netError.Message}", retryable: true);   // timeout / DNS / connection refused

        if (status is 408 or 429 or >= 500)
            return ZohoBooksResult<TEnvelope>.Fail(status, null, $"HTTP {status}: {Snip(text)}", retryable: true);   // section 8: "HTTP 429 ... Wait one minute, retry"

        if (status == 401)   // still 401 after one refresh - the document's retry-once policy is exhausted; this needs a human, not another automatic retry
            return ZohoBooksResult<TEnvelope>.Fail(status, 57, "HTTP 401 after refreshing the access token once: " + Snip(text), retryable: false);

        if (status is < 200 or >= 300)
            return ZohoBooksResult<TEnvelope>.Fail(status, null, $"HTTP {status}: {Snip(text)}", retryable: false);

        TEnvelope? parsed;
        try { parsed = string.IsNullOrWhiteSpace(text) ? null : JsonSerializer.Deserialize<TEnvelope>(text!); }
        catch (JsonException) { return ZohoBooksResult<TEnvelope>.Fail(status, null, "Unreadable reply (not JSON): " + Snip(text), retryable: true); }
        if (parsed is null) return ZohoBooksResult<TEnvelope>.Fail(status, null, "Empty reply body.", retryable: true);

        if (parsed.Code != 0)
        {
            var conflictingId = TryReadErrorInfoId(text);
            // section 8's table: 1001 (already exists), 4023 (void->sent), 2 (bad parameter), 2006 (inactive item), 120303 (duplicate DMS id) are all "do not retry
            // automatically"; only 57 (should already have been handled by the 401 branch above) is retryable here.
            var retryable = parsed.Code == 57;
            if (parsed.Code is not (0 or 57 or 1001 or 4023 or 2 or 2006 or 120303))
                _logger.LogWarning("Zoho Books returned an unrecognised code {Code}: {Message} - report this to Learnall (section 8, 'Any other').", parsed.Code, parsed.Message);
            return ZohoBooksResult<TEnvelope>.Fail(status, parsed.Code, parsed.Message, retryable, conflictingId);
        }

        return ZohoBooksResult<TEnvelope>.Ok(parsed, status ?? 200, parsed.Code, parsed.Message);
    }

    private static string? TryReadErrorInfoId(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("error_info", out var ei) || ei.ValueKind != JsonValueKind.Object) return null;
            if (ei.TryGetProperty("item_id", out var itemId) && itemId.ValueKind == JsonValueKind.String) return itemId.GetString();
            if (ei.TryGetProperty("contact_id", out var contactId) && contactId.ValueKind == JsonValueKind.String) return contactId.GetString();
            return null;
        }
        catch (JsonException) { return null; }
    }

    private static string Snip(string? s) => string.IsNullOrEmpty(s) ? "" : (s.Length > 300 ? s[..300] : s);
}
