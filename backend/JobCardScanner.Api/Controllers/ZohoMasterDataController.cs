using System.Data;
using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-12 ("wants to make api this 2: 1. Customer data - add, edit and delete  2. Item master creation, only want to give them continuing items") - two more GET-only
/// APIs for Zoho, next to ZohoIntegrationController's job cards / repair bills / material transfers. Same route prefix (/api/zoho) and the SAME API key ("ApiKeys:Zoho",
/// header X-API-Key), so Zoho needs no new credential. Both are built for INCREMENTAL SYNC: Zoho calls them with updatedSince = the time of its last successful pull and
/// receives only what was added, edited or deleted since.
///
///   GET /api/zoho/customers - Ledger Master (the one customer / party master of this app; see Models/LedgerMaster.cs) of the Magnemite dealers Zoho may see.
///       * Add    : a row whose createdAt is on or after updatedSince -> changeType "Added".
///       * Edit   : a row edited since -> changeType "Edited" (updatedAt moves on every edit, including a re-activation).
///       * Delete : Ledger Master never removes a row - "delete" in the app means DEACTIVATE (isActive false). Such a row comes back with changeType "Deleted"
///                  and status "Deleted", so Zoho can deactivate / delete its own copy. A row is never physically removed, so a deletion cannot be missed.
///       Default type = Party (the customers); pass type=Insurance | Dealer | Company | all for the others. Aadhaar number is deliberately NOT returned (personal ID, no
///       accounting use); GSTIN and PAN are.
///       Dealer scope = the same as the rest of the Zoho integration: every Dealer whose name contains MAGNEMITE except BAPL dealer codes CUS0347 / CUS0213 / CUS0209.
///
///   GET /api/zoho/items - the Item Master, CONTINUING items only: spare parts (the local C_ItemMaster copy only ever holds ProductMainGroupId = 2) that are ACTIVE
///       (Status Y or NULL) and NOT discontinued (ItemName not starting A2 / B8) - the exact rule LocalItemMasterService.SearchAsync(activeOnly: true) applies for every
///       dealer-facing screen. The query is written here (not a call into that service) because that service reads the signed-in user's role, and an API-key call has none.
///       "Creation" is createdOn (set by the ERP); modifiedOn moves when an item is edited. updatedSince returns items created OR modified since. An item that stops being
///       continuing (deactivated, or renamed to A2 / B8) simply drops out of the list - Zoho should treat "not returned any more" as discontinued by comparing against a
///       periodic full pull (call without updatedSince).
///       Not returned on purpose: purchase price, cost price, ledger codes and every other internal column. dealerPrice (Dlr_Price) IS returned - remove it from ZohoItemRow
///       if Zoho should not see it.
///
/// 2026-10-12 ("add all methods - add, update, delete, post, get - for sharing them"): the CUSTOMER side is now full CRUD, so Zoho can also write customers into BGauss:
///   GET    /api/zoho/customers/{id or ledgerCode}  - one customer.
///   POST   /api/zoho/customers                     - add a customer (Party by default, or Insurance) under a Magnemite dealer: body dealerCode + ledgerName + details. The Ledger Code
///                                                    (LED/###) is generated here and returned - Zoho stores it as its key. An active customer of the same dealer with the same name and
///                                                    mobile already there answers 409 with that customer, so a retried POST never creates a duplicate.
///   PUT    /api/zoho/customers/{id or ledgerCode}  - edit: the same fields as POST (a full update - a field left out is cleared; ledgerName is required). isActive true re-activates.
///   DELETE /api/zoho/customers/{id or ledgerCode}  - delete = DEACTIVATE (isActive false), exactly what "delete" means in Ledger Master; reversible with PUT isActive true. Nothing is
///                                                    physically removed, so the GET list keeps reporting it as changeType "Deleted".
/// Only customers of the in-scope dealers (see above) can be written, and only plain ledgers (Party / Insurance): Dealer and Company ledgers are copied from the ERP and are refused (403/400). The Company ledger
/// (BGauss Auto itself) can still be READ - type=Company, or type=all - even though it is not a Magnemite dealer's.
/// Created / updated rows carry no "by" user (an API key has none) - the audit log records them as ZohoCustomer.*.
/// THE ITEM MASTER IS READ-ONLY ON PURPOSE: it is a mirror of the ERP's C_ItemMaster, owned by the ERP, and "Sync from BAPL" replaces the whole table - an item written here would be wiped by
/// the next sync and would not exist in the ERP. New items are created in the ERP and flow to Zoho through GET /api/zoho/items.
///
/// Both lists are ordered oldest-change-first and paged (pageIndex from 0, pageSize default 500, max 1000); X-Total-Count carries the number of matching rows, so a caller
/// pages until it has them all. Empty result = 200 with [].
/// </summary>
[ApiController]
[Route("api/zoho")]
[AllowAnonymous]
public class ZohoMasterDataController : ControllerBase
{
    private const int MaxPageSize = 1000;
    private const int DefaultPageSize = 500;

    /// <summary>Same three exclusions as ZohoIntegrationController (matched on the BAPL dealer code, not the name).</summary>
    private static readonly string[] ExcludedBaplDealerCodes = { "CUS0347", "CUS0213", "CUS0209" };

    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<ZohoMasterDataController> _logger;
    private readonly IAuditLogService _audit;

    public ZohoMasterDataController(JobCardScannerDbContext db, IConfiguration config, ILogger<ZohoMasterDataController> logger, IAuditLogService audit)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _audit = audit;
    }

    // ------------------------------------------------------------------ plumbing

    private IActionResult? CheckApiKey()
    {
        var configuredKey = _config["ApiKeys:Zoho"];
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            _logger.LogWarning("Zoho master-data API called but ApiKeys:Zoho is not configured - refusing every request until it is set.");
            return StatusCode(503, new { message = "This integration is not yet configured." });
        }
        if (!Request.Headers.TryGetValue("X-API-Key", out var provided) || !SameKey(provided.ToString(), configuredKey))
            return Unauthorized(new { message = "Missing or invalid X-API-Key." });
        return null;
    }

    private static bool SameKey(string provided, string configured)
    {
        var a = Encoding.UTF8.GetBytes(provided);
        var b = Encoding.UTF8.GetBytes(configured);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    /// <summary>updatedSince as UTC: a value with a Z / offset binds as Local (converted back here); one with no zone is taken as UTC already.</summary>
    private static DateTime? AsUtc(DateTime? value) =>
        value is null ? null : value.Value.Kind == DateTimeKind.Local ? value.Value.ToUniversalTime() : value.Value;

    private static (int skip, int take) PageWindow(int pageIndex, int pageSize)
    {
        var size = pageSize <= 0 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize);
        return (Math.Max(0, pageIndex) * size, size);
    }

    /// <summary>Every Magnemite dealer except the three Zoho never sees - Id, name and BAPL dealer code.</summary>
    private async Task<List<(Guid Id, string Name, string? BaplDmsDealerCode)>> ResolveAllowedDealersAsync(CancellationToken ct)
    {
        var dealers = await _db.Dealers.AsNoTracking().Select(d => new { d.Id, d.Name, d.BaplDmsDealerCode }).ToListAsync(ct);
        return dealers
            .Where(d => d.Name != null && d.Name.Contains("MAGNEMITE", StringComparison.OrdinalIgnoreCase)
                && (d.BaplDmsDealerCode == null || !ExcludedBaplDealerCodes.Contains(d.BaplDmsDealerCode, StringComparer.OrdinalIgnoreCase)))
            .Select(d => (d.Id, d.Name!, d.BaplDmsDealerCode))
            .ToList();
    }

    // ------------------------------------------------------------------ 1. customers (add / edit / delete)

    /// <summary>GET /api/zoho/customers?updatedSince=&amp;type=&amp;dealerCode=&amp;pageIndex=&amp;pageSize= - see this controller's doc comment. updatedSince is an ISO 8601 date-time in UTC
    /// (e.g. 2026-10-01T00:00:00Z); omit it for a full pull.</summary>
    [HttpGet("customers")]
    public async Task<IActionResult> Customers(
        [FromQuery] DateTime? updatedSince, [FromQuery] string? type, [FromQuery] string? dealerCode,
        [FromQuery] int pageIndex = 0, [FromQuery] int pageSize = 0, CancellationToken ct = default)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync(ct);
        var lookup = allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode));
        var ids = (string.IsNullOrWhiteSpace(dealerCode)
                ? allowed
                : allowed.Where(d => string.Equals(d.BaplDmsDealerCode, dealerCode.Trim(), StringComparison.OrdinalIgnoreCase)).ToList())
            .Select(d => d.Id).ToList();
        // Customers = Party ledgers unless another type (or all) is asked for.
        var typeName = string.IsNullOrWhiteSpace(type) ? "Party" : type.Trim();
        var wantAll = string.Equals(typeName, "all", StringComparison.OrdinalIgnoreCase);
        var typeUpper = typeName.ToUpperInvariant();

        // 2026-10-13 ("in zoho why not shown Company"): the dealer scope above is "Magnemite dealers", but the Company ledger (BGAUSS AUTO PRIVATE LIMITED) belongs to BGauss itself, not to a
        // Magnemite dealer - so the dealer filter removed it and type=Company always came back []. Company ledgers are company-level master data, so they are now returned whatever dealer they
        // sit under (or none). Not offered when one dealer is asked for (dealerCode), and the Dealer type stays limited to the in-scope dealers.
        var includeCompany = string.IsNullOrWhiteSpace(dealerCode) && (wantAll || typeUpper == "COMPANY");
        if (ids.Count == 0 && !includeCompany) { Response.Headers["X-Total-Count"] = "0"; return Ok(Array.Empty<object>()); }

        var query = _db.LedgerMasters.AsNoTracking()
            .Where(l => (l.DealerId != null && ids.Contains(l.DealerId.Value))
                || (includeCompany && l.LedgerTypeMaster != null && l.LedgerTypeMaster.CustomerType.ToUpper() == "COMPANY"));
        if (!wantAll) query = query.Where(l => l.LedgerTypeMaster != null && l.LedgerTypeMaster.CustomerType.ToUpper() == typeUpper);
        var sinceUtc = AsUtc(updatedSince);
        if (sinceUtc is { } since)
            query = query.Where(l => l.CreatedAt >= since || (l.UpdatedAt != null && l.UpdatedAt >= since));

        Response.Headers["X-Total-Count"] = (await query.CountAsync(ct)).ToString();
        var (skip, take) = PageWindow(pageIndex, pageSize);

        var rows = await query
            .OrderBy(l => l.UpdatedAt ?? l.CreatedAt).ThenBy(l => l.Id)
            .Skip(skip).Take(take)
            .Select(l => new
            {
                l.Id, l.DealerId, l.LedgerCode, l.LedgerName,
                LedgerType = l.LedgerTypeMaster != null ? l.LedgerTypeMaster.CustomerType : null,
                l.MobileNumber, l.AlternateMobileNo, l.EMail, l.Address, l.Address2, l.City, l.State, l.Pin, l.Gstno, l.Pan,
                l.IsActive, l.CreatedAt, l.UpdatedAt,
            })
            .ToListAsync(ct);

        // a Company ledger's dealer (BGauss Auto itself) is not in the Magnemite scope: look up its name / code too
        var missingDealerIds = rows.Where(r => r.DealerId is Guid g && !lookup.ContainsKey(g)).Select(r => r.DealerId!.Value).Distinct().ToList();
        if (missingDealerIds.Count > 0)
            foreach (var d in await _db.Dealers.AsNoTracking().Where(d => missingDealerIds.Contains(d.Id)).Select(d => new { d.Id, d.Name, d.BaplDmsDealerCode }).ToListAsync(ct))
                lookup[d.Id] = (d.Name, d.BaplDmsDealerCode);

        return Ok(rows.Select(r =>
        {
            var dealer = r.DealerId is Guid dg && lookup.TryGetValue(dg, out var found) ? found : default;
            // Deleted = deactivated. Otherwise Added when it was created inside the window (or never edited), else Edited.
            var changeType = !r.IsActive ? "Deleted"
                : (r.UpdatedAt is null || (sinceUtc is not null && r.CreatedAt >= sinceUtc.Value)) ? "Added"
                : "Edited";
            return new
            {
                r.Id,
                CustomerId = r.Id,            // 2026-10-24: the unique DMS customer id, named the way Zoho asked
                CustomerCode = r.LedgerCode,
                r.LedgerCode,
                r.LedgerName,
                r.LedgerType,
                MobileNumber = r.MobileNumber,
                AlternateMobileNo = r.AlternateMobileNo,
                Email = r.EMail,
                r.Address,
                r.Address2,
                r.City,
                r.State,
                r.Pin,
                Gstin = r.Gstno,
                r.Pan,
                Status = r.IsActive ? "Active" : "Deleted",
                r.IsActive,
                ChangeType = changeType,
                DealerId = r.DealerId,
                DealerName = dealer.Name,
                DealerCode = dealer.BaplDmsDealerCode,
                r.CreatedAt,
                r.UpdatedAt,
            };
        }));
    }

    // ------------------------------------------------------------------ 1b. customers - one, add, edit, delete

    /// <summary>Body of POST / PUT /api/zoho/customers. POST needs dealerCode (the BAPL dealer code of the Magnemite location, e.g. CUS0288) and ledgerName; PUT ignores dealerCode and type.</summary>
    public record ZohoCustomerRequest(
        string? DealerCode, string? Type, string? LedgerName, string? MobileNumber, string? AlternateMobileNo, string? Email,
        string? Address, string? Address2, string? City, string? State, string? Pin, string? Gstin, string? Pan, bool? IsActive);

    private const string LedgerModuleKey = "ledger-master";

    private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static string? Upper(string? s) => Trimmed(s)?.ToUpperInvariant();

    /// <summary>Checks the same limits the Ledger Master columns have, so a too-long value is a clear 400 instead of a database error. Returns the message, or null when fine.</summary>
    private static string? ValidateCustomer(ZohoCustomerRequest r)
    {
        var name = Trimmed(r.LedgerName);
        if (name is null) return "ledgerName is required.";
        if (name.Length > 200) return "ledgerName is longer than 200 characters.";
        foreach (var (label, value) in new[] { ("mobileNumber", Trimmed(r.MobileNumber)), ("alternateMobileNo", Trimmed(r.AlternateMobileNo)) })
            if (value is not null && !(value.Length == 10 && value.All(char.IsDigit)))
                return $"{label} must be exactly 10 digits.";
        if ((Trimmed(r.Email)?.Length ?? 0) > 200) return "email is longer than 200 characters.";
        if ((Trimmed(r.Address)?.Length ?? 0) > 400 || (Trimmed(r.Address2)?.Length ?? 0) > 400) return "address / address2 is longer than 400 characters.";
        if ((Trimmed(r.City)?.Length ?? 0) > 100 || (Trimmed(r.State)?.Length ?? 0) > 100) return "city / state is longer than 100 characters.";
        if ((Trimmed(r.Pin)?.Length ?? 0) > 10) return "pin is longer than 10 characters.";
        if ((Trimmed(r.Gstin)?.Length ?? 0) > 20) return "gstin is longer than 20 characters.";
        if ((Trimmed(r.Pan)?.Length ?? 0) > 10) return "pan is longer than 10 characters.";
        return null;
    }

    /// <summary>The customer exactly as GET /api/zoho/customers returns it.</summary>
    private static object CustomerView(LedgerMaster l, string? typeName, string? dealerName, string? dealerCode, string changeType) => new
    {
        l.Id,
        CustomerId = l.Id,            // 2026-10-24: the unique DMS customer id, named the way Zoho asked
        CustomerCode = l.LedgerCode,
        l.LedgerCode,
        l.LedgerName,
        LedgerType = typeName,
        MobileNumber = l.MobileNumber,
        AlternateMobileNo = l.AlternateMobileNo,
        Email = l.EMail,
        l.Address,
        l.Address2,
        l.City,
        l.State,
        l.Pin,
        Gstin = l.Gstno,
        l.Pan,
        Status = l.IsActive ? "Active" : "Deleted",
        l.IsActive,
        ChangeType = changeType,
        DealerId = l.DealerId,
        DealerName = dealerName,
        DealerCode = dealerCode,
        l.CreatedAt,
        l.UpdatedAt,
    };

    /// <summary>A customer by its Id (GUID) or its Ledger Code (e.g. LED/012, slash literal or URL-encoded), only among the in-scope dealers' ledgers.</summary>
    private async Task<LedgerMaster?> FindInScopeAsync(string reference, List<Guid> allowedIds, bool track, CancellationToken ct, bool includeCompany = false)
    {
        var key = Uri.UnescapeDataString(reference ?? "").Trim();
        if (key.Length == 0) return null;
        IQueryable<LedgerMaster> q = _db.LedgerMasters;
        if (!track) q = q.AsNoTracking();
        q = q.Where(l => (l.DealerId != null && allowedIds.Contains(l.DealerId.Value))
            || (includeCompany && l.LedgerTypeMaster != null && l.LedgerTypeMaster.CustomerType.ToUpper() == "COMPANY"));
        if (Guid.TryParse(key, out var id)) return await q.FirstOrDefaultAsync(l => l.Id == id, ct);
        var upper = key.ToUpperInvariant();
        return await q.FirstOrDefaultAsync(l => l.LedgerCode.ToUpper() == upper, ct);
    }

    private Task<LedgerTypeMaster?> TypeOfAsync(int id, CancellationToken ct) =>
        _db.Set<LedgerTypeMaster>().AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);

    /// <summary>GET /api/zoho/customers/{id or ledgerCode} - one customer (404 when it does not exist or belongs to a dealer outside this key's scope).</summary>
    [HttpGet("customers/{**reference:minlength(1)}")]
    public async Task<IActionResult> CustomerGet(string reference, CancellationToken ct)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync(ct);
        var entity = await FindInScopeAsync(reference, allowed.Select(d => d.Id).ToList(), track: false, ct, includeCompany: true);
        if (entity is null) return NotFound(new { message = "That customer does not exist." });

        var type = await TypeOfAsync(entity.LedgerTypeId, ct);
        var dealerRow = entity.DealerId is null ? null
            : await _db.Dealers.AsNoTracking().Where(d => d.Id == entity.DealerId).Select(d => new { d.Name, d.BaplDmsDealerCode }).FirstOrDefaultAsync(ct);
        var changeType = !entity.IsActive ? "Deleted" : entity.UpdatedAt is null ? "Added" : "Edited";
        return Ok(CustomerView(entity, type?.CustomerType, dealerRow?.Name, dealerRow?.BaplDmsDealerCode, changeType));
    }

    /// <summary>POST /api/zoho/customers - add a customer. 201 with the created customer (its ledgerCode is the key to keep); 409 with the existing one when the same dealer already has an
    /// active customer with this name and mobile.</summary>
    [HttpPost("customers")]
    public async Task<IActionResult> CustomerCreate([FromBody] ZohoCustomerRequest req, CancellationToken ct)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        if (string.IsNullOrWhiteSpace(req.DealerCode))
            return BadRequest(new { message = "dealerCode is required - the BAPL dealer code of the Magnemite location, e.g. CUS0288." });
        var allowed = await ResolveAllowedDealersAsync(ct);
        var dealer = allowed.FirstOrDefault(d => string.Equals(d.BaplDmsDealerCode, req.DealerCode.Trim(), StringComparison.OrdinalIgnoreCase));
        if (dealer.Id == Guid.Empty)
            return BadRequest(new { message = $"dealerCode \"{req.DealerCode.Trim()}\" is not one of the dealers this key can write to (GET /api/zoho/dealers lists them)." });

        var typeName = Trimmed(req.Type) ?? "Party";
        var typeUpper = typeName.ToUpperInvariant();
        var type = await _db.Set<LedgerTypeMaster>().AsNoTracking().FirstOrDefaultAsync(t => t.CustomerType.ToUpper() == typeUpper && t.IsActive, ct);
        if (type is null) return BadRequest(new { message = "type must be Party (default) or Insurance." });
        if (type.IsErpSourced || type.IsOrgLevel)
            return BadRequest(new { message = $"{type.CustomerType} ledgers come from the ERP and cannot be created through this API." });

        var invalid = ValidateCustomer(req);
        if (invalid is not null) return BadRequest(new { message = invalid });

        var name = Trimmed(req.LedgerName)!;
        var nameUpper = name.ToUpperInvariant();
        var mobile = Trimmed(req.MobileNumber);
        var existing = await _db.LedgerMasters.AsNoTracking().FirstOrDefaultAsync(l =>
            l.DealerId == dealer.Id && l.IsActive && l.LedgerTypeId == type.Id && l.LedgerName.ToUpper() == nameUpper && l.MobileNumber == mobile, ct);
        if (existing is not null)
            return Conflict(new
            {
                message = "This dealer already has an active customer with the same name and mobile - nothing was created.",
                customer = CustomerView(existing, type.CustomerType, dealer.Name, dealer.BaplDmsDealerCode, existing.UpdatedAt is null ? "Added" : "Edited"),
            });

        string ledgerCode;
        try { ledgerCode = await ReserveLedgerCodeAsync(ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Zoho customers: could not generate a Ledger Code.");
            return StatusCode(500, new { message = $"Could not generate the Ledger Code: {ex.GetBaseException().Message}" });
        }

        var entity = new LedgerMaster
        {
            DealerId = dealer.Id,
            LedgerTypeId = type.Id,
            LedgerCode = ledgerCode,
            LedgerName = name,
            MobileNumber = mobile,
            AlternateMobileNo = Trimmed(req.AlternateMobileNo),
            EMail = Trimmed(req.Email),
            Address = Trimmed(req.Address),
            Address2 = Trimmed(req.Address2),
            City = Trimmed(req.City),
            State = Trimmed(req.State),
            Pin = Trimmed(req.Pin),
            Gstno = Upper(req.Gstin),
            Pan = Upper(req.Pan),
            IsShared = false,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        _db.LedgerMasters.Add(entity);
        var saveError = await TrySaveAsync("save the customer", ct);
        if (saveError is not null) return saveError;

        await TryAuditAsync("ZohoCustomer.Create", entity.Id.ToString(), new { entity.DealerId, entity.LedgerCode, entity.LedgerName });
        return StatusCode(StatusCodes.Status201Created, CustomerView(entity, type.CustomerType, dealer.Name, dealer.BaplDmsDealerCode, "Added"));
    }

    /// <summary>PUT /api/zoho/customers/{id or ledgerCode} - edit a customer: a FULL update of the editable fields (a field left out is cleared); ledgerName is required. isActive true
    /// re-activates a deleted customer. ERP-sourced ledgers are refused (403).</summary>
    [HttpPut("customers/{**reference:minlength(1)}")]
    public async Task<IActionResult> CustomerUpdate(string reference, [FromBody] ZohoCustomerRequest req, CancellationToken ct)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync(ct);
        var entity = await FindInScopeAsync(reference, allowed.Select(d => d.Id).ToList(), track: true, ct, includeCompany: true);
        if (entity is null) return NotFound(new { message = "That customer does not exist." });

        var type = await TypeOfAsync(entity.LedgerTypeId, ct);
        if (type?.IsErpSourced == true || type?.IsOrgLevel == true || entity.ErpCustomerCode is not null
            || string.Equals(type?.CustomerType, "Company", StringComparison.OrdinalIgnoreCase) || string.Equals(type?.CustomerType, "Dealer", StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new { message = $"A {type?.CustomerType ?? "ERP"} ledger comes from the ERP and cannot be changed through this API." });

        var invalid = ValidateCustomer(req);
        if (invalid is not null) return BadRequest(new { message = invalid });

        entity.LedgerName = Trimmed(req.LedgerName)!;
        entity.MobileNumber = Trimmed(req.MobileNumber);
        entity.AlternateMobileNo = Trimmed(req.AlternateMobileNo);
        entity.EMail = Trimmed(req.Email);
        entity.Address = Trimmed(req.Address);
        entity.Address2 = Trimmed(req.Address2);
        entity.City = Trimmed(req.City);
        entity.State = Trimmed(req.State);
        entity.Pin = Trimmed(req.Pin);
        entity.Gstno = Upper(req.Gstin);
        entity.Pan = Upper(req.Pan);
        if (req.IsActive is { } active) entity.IsActive = active;
        entity.UpdatedAt = DateTime.UtcNow;
        var saveError = await TrySaveAsync("save the customer", ct);
        if (saveError is not null) return saveError;

        await TryAuditAsync("ZohoCustomer.Update", entity.Id.ToString(), new { entity.LedgerCode, entity.LedgerName, entity.IsActive });
        var dealer = allowed.First(d => d.Id == entity.DealerId);
        return Ok(CustomerView(entity, type?.CustomerType, dealer.Name, dealer.BaplDmsDealerCode, entity.IsActive ? "Edited" : "Deleted"));
    }

    /// <summary>DELETE /api/zoho/customers/{id or ledgerCode} - deactivates the customer (isActive false), the same "delete" as in Ledger Master; already deleted = 200 again. ERP ledgers: 403.</summary>
    [HttpDelete("customers/{**reference:minlength(1)}")]
    public async Task<IActionResult> CustomerDelete(string reference, CancellationToken ct)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync(ct);
        var entity = await FindInScopeAsync(reference, allowed.Select(d => d.Id).ToList(), track: true, ct, includeCompany: true);
        if (entity is null) return NotFound(new { message = "That customer does not exist." });

        var type = await TypeOfAsync(entity.LedgerTypeId, ct);
        if (type?.IsErpSourced == true || type?.IsOrgLevel == true || entity.ErpCustomerCode is not null
            || string.Equals(type?.CustomerType, "Company", StringComparison.OrdinalIgnoreCase) || string.Equals(type?.CustomerType, "Dealer", StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new { message = $"A {type?.CustomerType ?? "ERP"} ledger comes from the ERP and cannot be deleted through this API." });

        if (entity.IsActive)
        {
            entity.IsActive = false;
            entity.UpdatedAt = DateTime.UtcNow;
            var saveError = await TrySaveAsync("delete the customer", ct);
            if (saveError is not null) return saveError;
            await TryAuditAsync("ZohoCustomer.Delete", entity.Id.ToString(), new { entity.LedgerCode, entity.LedgerName });
        }

        var dealer = allowed.First(d => d.Id == entity.DealerId);
        return Ok(CustomerView(entity, type?.CustomerType, dealer.Name, dealer.BaplDmsDealerCode, "Deleted"));
    }

    // ---- write helpers (the same numbering and save/audit conventions as LedgerMasterController)

    /// <summary>The next "LED/###" Ledger Code, from the Prefix Master / DocNumberSequence rows of module "ledger-master" in one transaction (so two callers cannot get the same number);
    /// falls back to the highest existing LED/### + 1 if those tables cannot be used. The unique index on LedgerCode still stops a clash.</summary>
    private async Task<string> ReserveLedgerCodeAsync(CancellationToken ct)
    {
        try
        {
            var strategy = _db.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                await using var tx = await _db.Database.BeginTransactionAsync(ct);
                var prefixRow = await _db.DocPrefixMasters.FirstOrDefaultAsync(x => x.ModuleKey == LedgerModuleKey, ct);
                if (prefixRow is null)
                {
                    prefixRow = new DocPrefixMaster { ModuleKey = LedgerModuleKey, Prefix = "LED", UsesFinancialYear = false, IsActive = true, CreatedAt = DateTime.UtcNow };
                    _db.DocPrefixMasters.Add(prefixRow);
                }
                const string fyKey = "";
                var seqRow = await _db.DocNumberSequences.FirstOrDefaultAsync(x => x.ModuleKey == LedgerModuleKey && x.FinancialYear == fyKey, ct);
                if (seqRow is null)
                {
                    seqRow = new DocNumberSequence { ModuleKey = LedgerModuleKey, FinancialYear = fyKey, LastSequence = 0 };
                    _db.DocNumberSequences.Add(seqRow);
                }
                var next = seqRow.LastSequence + 1;
                seqRow.LastSequence = next;
                seqRow.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return $"{prefixRow.Prefix}/{next:000}";
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Zoho customers: Prefix Master numbering failed - numbering from the existing LED/### codes instead.");
            _db.ChangeTracker.Clear();
            var existing = await _db.LedgerMasters.AsNoTracking().Where(x => x.LedgerCode.StartsWith("LED/")).Select(x => x.LedgerCode).ToListAsync(ct);
            var max = 0;
            foreach (var code in existing)
                if (int.TryParse(code.AsSpan(4), out var n) && n > max) max = n;
            return $"LED/{max + 1:000}";
        }
    }

    private async Task<IActionResult?> TrySaveAsync(string what, CancellationToken ct)
    {
        try { await _db.SaveChangesAsync(ct); return null; }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Zoho customers: could not {What}.", what);
            _db.ChangeTracker.Clear();
            return StatusCode(500, new { message = $"Could not {what}: {ex.GetBaseException().Message}" });
        }
    }

    private async Task TryAuditAsync(string action, string entityId, object details)
    {
        try { await _audit.LogAsync(action, "LedgerMaster", entityId, details); }
        catch (Exception ex) { _logger.LogWarning(ex, "Zoho customers: the audit log entry for {Action} could not be written.", action); }
    }

    // ------------------------------------------------------------------ 2. item master (continuing items only)

    private sealed class ZohoItemRow
    {
        public string ItemCode { get; set; } = "";
        public string? ItemName { get; set; }
        public string? DisplayName { get; set; }
        public string? HsnCode { get; set; }
        public decimal? DealerPrice { get; set; }
        public decimal? Sgst { get; set; }
        public decimal? Cgst { get; set; }
        public decimal? Igst { get; set; }
        public string? ItemType { get; set; }
        public string? Status { get; set; }
        public DateTime? CreatedOn { get; set; }
        public DateTime? ModifiedOn { get; set; }
    }

    private sealed class CountRow { public int Value { get; set; } }

    /// <summary>GET /api/zoho/items?updatedSince=&amp;itemCode=&amp;pageIndex=&amp;pageSize= - continuing items only; see this controller's doc comment.</summary>
    [HttpGet("items")]
    public async Task<IActionResult> Items(
        [FromQuery] DateTime? updatedSince, [FromQuery] string? itemCode,
        [FromQuery] int pageIndex = 0, [FromQuery] int pageSize = 0, CancellationToken ct = default)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var (skip, take) = PageWindow(pageIndex, pageSize);

        // Spare parts only (the local table holds nothing else, but the group filter is kept as a guard), ACTIVE (Y or NULL) and CONTINUING (not A2 / B8).
        // Status NULL is written as IS NULL on purpose - a plain IN ('Y', NULL) would silently drop the NULLs.
        var where = new StringBuilder(@"
            WHERE m.[ProductMainGroupId] = 2
              AND (m.[Status] IS NULL OR LTRIM(RTRIM(m.[Status])) = 'Y')
              AND NOT (LTRIM(ISNULL(m.[ItemName], '')) LIKE 'A2%' OR LTRIM(ISNULL(m.[ItemName], '')) LIKE 'B8%')");
        var ps = new List<SqlParameter>();
        if (AsUtc(updatedSince) is { } since)
        {
            where.Append(" AND (m.[CreatedOn] >= @since OR m.[ModifiedOn] >= @since)");
            ps.Add(new SqlParameter("@since", SqlDbType.DateTime) { Value = since });
        }
        if (!string.IsNullOrWhiteSpace(itemCode))
        {
            where.Append(" AND m.[ItemCode] = @code");
            ps.Add(new SqlParameter("@code", SqlDbType.VarChar, 30) { Value = itemCode.Trim() });
        }

        try
        {
            var count = await _db.Database
                .SqlQueryRaw<CountRow>("SELECT COUNT(*) AS [Value] FROM [dbo].[C_ItemMaster] m" + where, ps.Select(Clone).ToArray())
                .ToListAsync(ct);
            Response.Headers["X-Total-Count"] = (count.FirstOrDefault()?.Value ?? 0).ToString();

            var sql = @"
                SELECT m.[ItemCode]    AS ItemCode,
                       m.[ItemName]    AS ItemName,
                       m.[DisplayName] AS DisplayName,
                       m.[HSNCode]     AS HsnCode,
                       m.[Dlr_Price]   AS DealerPrice,
                       m.[SGST]        AS Sgst,
                       m.[CGST]        AS Cgst,
                       m.[IGST]        AS Igst,
                       m.[Item_Type]   AS ItemType,
                       m.[Status]      AS Status,
                       m.[CreatedOn]   AS CreatedOn,
                       m.[ModifiedOn]  AS ModifiedOn
                FROM [dbo].[C_ItemMaster] m" + where + @"
                ORDER BY ISNULL(m.[ModifiedOn], m.[CreatedOn]), m.[ItemCode], m.[Id]
                OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY";
            var rowParams = ps.Select(Clone).ToList();
            rowParams.Add(new SqlParameter("@skip", SqlDbType.Int) { Value = skip });
            rowParams.Add(new SqlParameter("@take", SqlDbType.Int) { Value = take });

            var rows = await _db.Database.SqlQueryRaw<ZohoItemRow>(sql, rowParams.Cast<object>().ToArray()).ToListAsync(ct);

            return Ok(rows.Select(r => new
            {
                r.ItemCode,
                r.ItemName,
                r.DisplayName,
                r.HsnCode,
                r.DealerPrice,
                r.Sgst,
                r.Cgst,
                r.Igst,
                r.ItemType,
                Status = string.IsNullOrWhiteSpace(r.Status) ? "Y" : r.Status.Trim(),
                r.CreatedOn,
                r.ModifiedOn,
            }));
        }
        catch (Exception ex) when (ex is SqlException { Number: 208 })
        {
            _logger.LogWarning(ex, "Zoho items: dbo.C_ItemMaster does not exist in JobCardScannerDb yet.");
            return StatusCode(503, new { message = "The Item Master has not been loaded into this system yet." });
        }
    }

    // a SqlParameter can belong to one command only - the count and the page query each need their own copy
    private static object Clone(SqlParameter p) => new SqlParameter(p.ParameterName, p.SqlDbType, p.Size) { Value = p.Value };
}