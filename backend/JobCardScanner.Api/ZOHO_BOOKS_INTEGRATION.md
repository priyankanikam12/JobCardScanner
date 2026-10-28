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
    "0":  { "IntraStateTaxId": "3898946000000041127", "InterStateTaxId": "3898946000000041055" },
    "5":  { "IntraStateTaxId": "3898946000000041131", "InterStateTaxId": "3898946000000041056" },
    "12": { "IntraStateTaxId": "3898946000000041135", "InterStateTaxId": "3898946000000041057" },
    "18": { "IntraStateTaxId": "3898946000000041139", "InterStateTaxId": "3898946000000041059" },
    "28": { "IntraStateTaxId": "3898946000000041147", "InterStateTaxId": "3898946000000041060" },
    "40": { "IntraStateTaxId": "3898946000000041143", "InterStateTaxId": "3898946000000041058" }
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

**Update, 28.10.2026 — all six GST brackets are now confirmed by Zoho (Sathwika Thangallapally's reply email).** The table above replaces the earlier "only 18% confirmed" state; the 0/5/12/28/40% values are copied verbatim from that email / section 3 of the payloads document. `LocationIdsByDealerCode` still only has Delhi/CUS0288 confirmed — the other 20 locations are in the new Purchase Bills document (section 8 below) but need BGauss's own dealer-code mapping filled in before they can go here, same reasoning as before: a guessed id would mis-route a real transaction.

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

## 8. Update, 28.10.2026 — Zoho's full reply email: what changed

Sathwika Thangallapally (Zoho Developer) replied with the OAuth credentials (via a password-protected link — see the cover note for the separate password issue), confirmed the direct-API approach end to end, and attached two documents: a re-share of the Payloads document (unchanged) and a brand-new `BGauss_DMS_Zoho_Books_Purchase_Bills_and_Locations.docx`. Five things changed as a result:

**8.1 — Stop using the item webhook. All items must now go through the direct API.** Zoho's own words: *"Please do not send any more items through the webhook."* The 1,496 items already pushed through `iw_bgauss_item_push` were created as **sales items** (no stock tracking); Zoho tested re-pushing one (`0301-DS1-1008`) through the direct API's update call and confirmed it converts cleanly to an **inventory item** (stock tracked) with name/SKU/HSN/rate/GST unchanged. Practical effect: **switch `ZohoPush:Provider` from `"ZohoBooks"` to `"ZohoBooksDirect"` and plan a one-time re-push of every item** — both the 1,496 webhook-created ones (now converting type) and the 1,032 previously held-back ones (now mostly unblocked by 8.2/8.3 below). Do this as a deliberate, small-batch-first operation (mirror Zoho's own single-item test before the full backlog), not a silent side-effect of flipping the config flag.

**8.2 — HSN and price are no longer mandatory on an item push.** `ZohoCreateItemRequest.HsnOrSac`/`.Rate` are now nullable and omitted from the JSON when absent (was `[Required]` on both); `ZohoBooksMappers.ToCreateItemRequest` no longer holds an item back for a missing HSN or a zero/blank price — only a HSN that is *present but malformed* (not 8 digits) or a *negative* price still blocks the push, since those look like data errors rather than legitimately-unset fields. This alone should clear most of the 1,032 held-back items — re-run `load-items` after deploying this change and check the new `heldBack` count.

**8.3 — All six GST brackets are confirmed** (table in section 3 above, updated from the email). The item that failed earlier at 0% GST was **`BDBG27C001`** — include that item code when you reply to Zoho, and re-push it once the 0% tax IDs are deployed.

**8.4 — New inbound direction: Zoho Books → DMS purchase bills.** Unlike everything else in this integration, this one has Zoho calling DMS. New files:

| File | What it is |
|---|---|
| `Controllers/ZohoPurchaseBillWebhookDtos.cs` | Request/reply shapes, field-for-field against the new document's sections 3-4 |
| `Controllers/ZohoPurchaseBillWebhookController.cs` | `POST /api/zoho-purchase-bills` — `[AllowAnonymous]` + `X-API-Key` (same convention as your other Zoho controllers; **written from that documented convention, not from your actual controller source, since those files weren't shared in this conversation — check it matches before shipping**) |
| `sql/2026-10-28_ZohoPurchaseBillInbox.sql` | Three new tables: `ZohoPurchaseBillInbox` (header), `ZohoPurchaseBillInboxLine`, `ZohoPurchaseBillWebhookEvents` (idempotency log) — run once before deploying |

Handling matches the document's section 5 exactly: `bill.created`/`bill.updated` upsert the header + fully replace the lines (keyed on Zoho's own immutable `billId` — no separate match key); `bill.voided` marks it void and reverses stock once; a repeated identical event (same `billId`+`event`+content) is a no-op, replied to as `"duplicate"` rather than reprocessed.

**NOT implemented: the actual stock-receiving logic.** `ApplyStockForBillAsync` in the controller is a clearly-marked stub that logs what it would do and returns — it does not touch real stock. It is blocked on two things neither source document nor this conversation provided: (1) the location→dealer mapping in section 8.5 below, still blank, and (2) which DMS table/procedure actually owns stock-on-hand per dealer. Every bill still lands in `ZohoPurchaseBillInbox` with `StockApplied = 0` so a later implementation can find all of them with `WHERE StockApplied = 0 AND VoidedOn IS NULL`.

**What to give Zoho back (their "Needed from DMS" ask, section 6 of their document)** — propose this in your reply:
- Endpoint URL: `https://<your-deployed-host>/api/zoho-purchase-bills`
- Auth: an API key in the `X-API-Key` header (configured as `ApiKeys:ZohoPurchaseBillWebhook` — set this as a secret before go-live, same as the OAuth values)
- Reply contract: HTTP 200 with `{ "success": true, "status": "accepted"|"duplicate", "message": "...", "billId": "..." }` on success; a non-2xx status (401 for a bad key, 400 for a malformed payload, 500 for a processing error) with `{ "success": false, "status": "error", "message": "...", "billId": "..." }` otherwise.

**8.5 — The 21-location → dealer mapping still needs BGauss's own data.** The new document lists all 21 Zoho Books locations with their `location_id`, but the "DMS dealer / sub-location" column is blank — only Delhi/CUS0288 was ever confirmed. This is BGauss's own dealer-master data (which dealer code and sub-location each hub/spoke maps to), not something that can be inferred from anything shared so far — see the cover note for the full table and the request to fill it in.

**8.6 — Customer-push timing is now confirmed, not just inferred.** Zoho's email restates section 6 exactly: *"Customers are created only at invoice time... DMS looks up the customer by customerId; if found, the invoice goes to that customer; if not, DMS creates the customer first."* This resolves the open question in section 6 above in favour of the invoice-time model — `ZohoBooksDirectRunner.ProcessCustomersInThisMode` should stay `false` (proactive ledger-change pushes are still not the right model), and the invoice-time path should call `ZohoBooksApiClient.FindOrCreateCustomerAsync` once the repair-bill/invoice source is shared (still the one piece from section 6 that remains unbuilt).
