# Zoho Books direct-API integration - what's new and how to wire it in

Prepared by: Claude (for Priyanka Nikam / Vijay Maurya, BGauss Auto) — 28.10.2026
Based on: `BGauss_DMS_Zoho_Books_API_Payloads.docx` (Learnall, tested against Magnemite's Zoho Books org 26.10.2026) and `BGauss_DMS_Zoho_Books_Fields_List.xlsx`, cross-checked against your actual `ZohoPushStore.cs` and `ZohoPushDispatcher.cs`.

## 1. Why this is a new code path, not an edit to the existing one

Your `ZohoPushDispatcher.RunZohoBooksAsync` (built 16.10.2026) already has a mode called `ZohoPush:Provider = "ZohoBooks"`. That mode posts to a Learnall-hosted **webhook URL** (`ZohoPush:ItemsUrl`, the key embedded in the URL), with no OAuth, and reads a custom reply shape: `{ code, response: { code, message, version, failed: [] } }`.

The document you just shared (`BGauss_DMS_Zoho_Books_API_Payloads.docx`) describes something different: calling **Zoho Books' own REST API directly** — `https://www.zohoapis.in/books/v3`, OAuth2 (`Authorization: Zoho-oauthtoken ...`), Zoho's own field names (`sku`, `rate`, `hsn_or_sac`, ...) and Zoho's own reply shape (`{ code, message, item: {...} }`). It is a different document from the one the webhook mode was built against ("Zoho Books Item Push - Details for BGauss"), and the two do not interoperate — this is not a bug in the existing code, it was simply built from an earlier, different Learnall document.

So the files below are **additive**: a third provider mode, `ZohoPush:Provider = "ZohoBooksDirect"`, sitting next to your two existing modes. Nothing in `ZohoPushStore.cs` or `ZohoPushDispatcher.cs` needs to be deleted, and the existing webhook mode keeps working exactly as it does today if you ever need to fall back to it.

## 2. Files delivered

| File | What it is |
|---|---|
| `Options/ZohoBooksOptions.cs` | Config class: OAuth credentials, base URLs, org id, tax/account/location ID tables |
| `Services/Zoho/ZohoBooksDtos.cs` | Request/response DTOs, `[JsonPropertyName]` matched to Zoho's exact field names, `[Required]`/`[Range]`/`[RegularExpression]`/`[StringLength]`/`[MinLength]` implementing section 8's pre-send checks |
| `Services/Zoho/ZohoBooksValidation.cs` | Runs those DataAnnotations (recursively, into nested lists/objects) plus the one cross-field rule attributes can't express: `cgst + sgst = igst` |
| `Services/Zoho/ZohoOAuthTokenService.cs` | Gets/caches the OAuth2 access token, refreshes at ~50 minutes, force-refreshes once on HTTP 401 |
| `Services/Zoho/ZohoBooksApiClient.cs` | The actual HTTP client — every endpoint in sections 4-7 (items, inventory adjustments, customers, invoices), returning a uniform `ZohoBooksResult<T>` with section 8's error classification already applied |
| `Services/Zoho/ZohoBooksMappers.cs` | Turns your DMS field names (`ItemCode`, `DealerPrice`, `LedgerName`, ...) into the Zoho DTOs above, per the Fields List spreadsheet |
| `Services/Zoho/ZohoBooksDirectRunner.cs` | Drains `dbo.ZohoPushOutbox` **Item** events into `ZohoBooksApiClient` — the new `ZohoPush:Provider = "ZohoBooksDirect"` mode |

## 3. appsettings.json — new `ZohoBooksApi` section

```json
"ZohoBooksApi": {
  "AccountsBaseUrl": "https://accounts.zoho.in",
  "ApiBaseUrl": "https://www.zohoapis.in/books/v3",
  "OrganizationId": "60074559380",
  "RateLimitPerMinute": 100,
  "DefaultUnitName": "pcs",
  "Accounts": {
    "SalesAccountId": "3898946000000000486",
    "PurchaseAccountId": "3898946000000000567",
    "InventoryAccountId": "3898946000000000626"
  },
  "TaxIdsByGstPercent": {
    "0":  { "IntraStateTaxId": "<fill in>", "InterStateTaxId": "<fill in>" },
    "5":  { "IntraStateTaxId": "<fill in>", "InterStateTaxId": "<fill in>" },
    "12": { "IntraStateTaxId": "<fill in>", "InterStateTaxId": "<fill in>" },
    "18": { "IntraStateTaxId": "3898946000000041139", "InterStateTaxId": "3898946000000041059" },
    "28": { "IntraStateTaxId": "<fill in>", "InterStateTaxId": "<fill in>" },
    "40": { "IntraStateTaxId": "<fill in>", "InterStateTaxId": "<fill in>" }
  },
  "LocationIdsByDealerCode": {
    "CUS0288": "3898946000000032107"
  }
}
```

**Do not put `ClientId`, `ClientSecret` or `RefreshToken` in `appsettings.json`.** Set them as user secrets or environment variables, the same convention your `ZohoPush:ItemsUrl` already uses:

```
ZohoBooksApi__ClientId=...
ZohoBooksApi__ClientSecret=...
ZohoBooksApi__RefreshToken=...
```

**Important — only GST 18% has a confirmed tax ID.** The Payloads document only tested an 18% item. The 0/5/12/28/40% tax IDs and every location besides Delhi/CUS0288 are **not in the document** — `ZohoBooksMappers.ToCreateItemRequest` deliberately refuses to push an item whose GST % has no entry here rather than guessing, so fill these in (ask Learnall) before any non-18% item can go through. The three account IDs above are flagged **in the source document itself** as "Zoho defaults used in testing; Magnemite finance will confirm them before go-live" — treat them as provisional, not final.

## 4. Program.cs — register the new services

**Do not use `AddHttpClient<T>()` followed by `AddSingleton<T>()` for these two** — that combination registers `T` twice; the second (`AddSingleton`) registration wins and tries to resolve a bare `HttpClient` from the container, which isn't registered that way, so it throws at startup. It would also be wrong for a different reason: `ZohoOAuthTokenService` caches the access token across every caller, so it must be a genuine singleton, not the transient lifetime `AddHttpClient<T>()` gives by default.

Use named clients plus an explicit singleton factory instead — this is the officially documented pattern for a singleton service that needs `IHttpClientFactory`'s pooling:

```csharp
builder.Services.Configure<ZohoBooksOptions>(builder.Configuration.GetSection(ZohoBooksOptions.SectionName));

builder.Services.AddHttpClient("ZohoOAuth");
builder.Services.AddHttpClient("ZohoBooksApi", c => c.Timeout = TimeSpan.FromSeconds(30));

builder.Services.AddSingleton<ZohoOAuthTokenService>(sp => new ZohoOAuthTokenService(
    sp.GetRequiredService<IHttpClientFactory>().CreateClient("ZohoOAuth"),
    sp.GetRequiredService<IOptions<ZohoBooksOptions>>(),
    sp.GetRequiredService<ILogger<ZohoOAuthTokenService>>()));

builder.Services.AddSingleton<ZohoBooksApiClient>(sp => new ZohoBooksApiClient(
    sp.GetRequiredService<IHttpClientFactory>().CreateClient("ZohoBooksApi"),
    sp.GetRequiredService<IOptions<ZohoBooksOptions>>(),
    sp.GetRequiredService<ZohoOAuthTokenService>(),
    sp.GetRequiredService<ILogger<ZohoBooksApiClient>>()));
```
(Your existing `builder.Services.AddHostedService<ZohoPushDispatcher>();` line is unchanged — see the constructor patch below for how it picks up the new client. Place all of the above *before* that line, or anywhere before `builder.Build()` — registration order doesn't matter as long as everything is registered before the host is built.)

## 5. The only two edits to your real files

### 5a. `ZohoPushDispatcher.cs` — constructor (add two parameters)

```diff
     public ZohoPushDispatcher(IServiceScopeFactory scopes, IConfiguration config, ILogger<ZohoPushDispatcher> logger)
+    public ZohoPushDispatcher(IServiceScopeFactory scopes, IConfiguration config, ILogger<ZohoPushDispatcher> logger,
+        ZohoBooksApiClient zohoBooksClient, Microsoft.Extensions.Options.IOptions<ZohoBooksOptions> zohoBooksOptions)
     {
         _scopes = scopes;
         _config = config;
         _logger = logger;
         ZohoPushStore.Configure(config);
+        ConfigureZohoBooksDirect(zohoBooksClient, zohoBooksOptions);
     }
+
+    // 2026-10-28: static handoff (same pattern as ZohoPushStore.Configure) so the static RunOnceAsync - already called directly by ZohoPushController /
+    // ZohoPushOpsController without an instance - can reach the new direct-API client too.
+    private static ZohoBooksApiClient? _zohoBooksClient;
+    private static Microsoft.Extensions.Options.IOptions<ZohoBooksOptions>? _zohoBooksOptions;
+    public static void ConfigureZohoBooksDirect(ZohoBooksApiClient client, Microsoft.Extensions.Options.IOptions<ZohoBooksOptions> options)
+    {
+        _zohoBooksClient = client;
+        _zohoBooksOptions = options;
+    }
```
Add `using JobCardScanner.Api.Services.Zoho;` and `using JobCardScanner.Api.Options;` to the top of the file.

### 5b. `ZohoPushDispatcher.cs` — `RunOnceAsync` (one new branch, one `IsConfigured` clause)

```diff
     public static bool IsConfigured(IConfiguration config) =>
         config.GetValue("ZohoPush:Enabled", false)
-        && (IsZohoBooks(config)
+        && (IsZohoBooksDirect(config)
+            ? _zohoBooksClient is not null && !string.IsNullOrWhiteSpace(_zohoBooksOptions?.Value.OrganizationId)
+            : IsZohoBooks(config)
             ? !string.IsNullOrWhiteSpace(config["ZohoPush:ItemsUrl"]) || !string.IsNullOrWhiteSpace(config["ZohoPush:CustomersUrl"])
             : !string.IsNullOrWhiteSpace(config["ZohoPush:BaseUrl"]));

+    public static bool IsZohoBooksDirect(IConfiguration config) => string.Equals(config["ZohoPush:Provider"], "ZohoBooksDirect", StringComparison.OrdinalIgnoreCase);
+
     public static async Task<(int Sent, int Failed)> RunOnceAsync(JobCardScannerDbContext db, IConfiguration config, ILogger logger, CancellationToken ct)
     {
         if (!IsConfigured(config)) return (0, 0);
+        if (IsZohoBooksDirect(config))
+        {
+            if (_zohoBooksClient is null || _zohoBooksOptions is null)
+            {
+                logger.LogError("ZohoPush:Provider is ZohoBooksDirect but ZohoBooksApiClient was never configured (DI registration missing - see ZOHO_BOOKS_INTEGRATION.md section 4).");
+                return (0, 0);
+            }
+            return await ZohoBooksDirectRunner.RunAsync(db, _zohoBooksClient, _zohoBooksOptions, logger, ct);
+        }
         if (IsZohoBooks(config)) return await RunZohoBooksAsync(db, config, logger, ct);   // Learnall's Zoho Books webhook: its own URL / reply rules
```

That's the whole integration. `ZohoPushStore.cs` needs **no changes at all** for this — items already flow through its existing `EnqueueItemsAsync`/`TryEnqueueItemChangesAsync`/outbox machinery exactly as they do today; `ZohoBooksDirectRunner` just reads the same `dbo.ZohoPushOutbox` rows and sends them to Zoho's real API instead of the webhook.

## 6. What is deliberately NOT wired yet, and why

**Customers are not pushed in this mode (`ZohoBooksDirectRunner.ProcessCustomersInThisMode = false`).** This is the one open question that needs your/Vijay's and Learnall's decision before it can be turned on, not something I decided quietly:

- Your existing code (`ZohoPushStore.TryEnqueueCustomerAsync`) pushes a customer **proactively**, every time a Ledger Master record is saved (created/edited/deleted), the same model as items.
- The Payloads document describes something different for the direct API: **"customers are added only when an invoice is created"** (section 6) — the DMS looks up the customer by DMS customer ID at invoice time, creates it only if missing, and explicitly states *"Customers are not updated, deactivated or re-activated through the integration."*

Those two models don't reconcile on their own — proactively pushing every ledger edit as a `customer.updated` event has no matching Zoho endpoint in the tested document (there's no "update a contact" call described), and wiring it in anyway would mean either silently dropping those update events or inventing behaviour the document doesn't test. I've left it off rather than guess. Once Vijay/Learnall confirm which model to use, the customer side is a smaller piece of work: `ZohoBooksMappers.ToCreateContactRequest` and `ZohoBooksApiClient.FindOrCreateCustomerAsync` are already written for the invoice-time model described in the document.

**Invoices and inventory adjustments are not wired at all.** `ZohoBooksApiClient` has full `CreateInvoiceAsync`/`MarkInvoiceSentAsync`/`VoidInvoiceAsync`/`FindInvoiceByNumberAsync` and `CreateInventoryAdjustmentAsync` methods, matching sections 5 and 7 exactly — but building the DTOs for a real repair bill needs the actual repair-bill source (whatever table backs `GET /api/zoho/repair-bills` in `ZohoIntegrationController` — `RepairBillDoc`/line items or equivalent), which wasn't part of what was shared in this conversation. Share that source and I'll write the mapper and the dispatcher wiring the same way.

**State-code mapping is incomplete.** `ZohoBooksMappers.MapStateToTwoLetterCode` only has the six states the document mentions (DL, TN, MH, KA, TS, GJ) and deliberately returns null (blocking the push) for anything else, rather than guessing a code — add states as Magnemite's dealer footprint grows.

**Business-vs-individual customer classification is inferred, not confirmed.** The mapper treats a customer as "individual" only when it's a Party ledger with no GSTIN and no company name override; everything else is "business". This matches the document's wording but wasn't something either of your source documents stated as a rule to apply to existing DMS data — confirm it holds for your actual customer base before relying on it.

## 7. Suggested rollout

1. Fill in the `TaxIdsByGstPercent` and `LocationIdsByDealerCode` gaps with Learnall (only 18%/Delhi are confirmed).
2. Set the three OAuth secrets as user secrets/environment variables (never in `appsettings.json`).
3. Apply the two `ZohoPushDispatcher.cs` edits in section 5 and register the services in `Program.cs` (section 4).
4. Test with `ZohoPush:Provider = "ZohoBooksDirect"` against **one or two known-18%-GST items** first (matching what Learnall actually tested), via `POST /api/zoho-push-ops/load-items?confirm=true&codes=<a couple of item codes>` — your existing Ops controller endpoint — and check the item lands correctly in Zoho Books before letting the full continuing-items backlog through.
5. Get Vijay's and Learnall's decision on the customer-push model (section 6 above) before enabling customer events in this mode.
6. Share the repair-bill/invoice source so the invoice side can be completed.
