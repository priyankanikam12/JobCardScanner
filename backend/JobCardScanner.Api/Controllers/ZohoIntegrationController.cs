using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-02 ("for this 3 api i want create new api for Zoho ... all get api wants to provide them direct all get data of all magnamite dealer excluding [3 named/coded dealers] ... simple get api with api key").
/// GET-ONLY integration for Zoho, scoped to every Dealer whose Name contains "MAGNEMITE" EXCEPT the three you coded (CUS0347 / CUS0213 / CUS0209, matched on BaplDmsDealerCode - see ResolveAllowedDealersAsync).
/// Authentication: header X-API-Key = ApiKeys:Zoho (not configured = 503 for every call, wrong / missing = 401).
///
///   GET /api/zoho/dealers                          - the dealers this key resolves to (a sanity check of the scope).
///   GET /api/zoho/jobcards                         - job card status view (no pricing). Carries customerId.
///   GET /api/zoho/repair-bills                     - the invoices: full line / tax / total detail, and the CUSTOMER with OUR unique customer id (see below).
///   GET /api/zoho/material-transfers               - material transfer documents. Carries customerId of the job card's customer.
///   GET /api/zoho/invoice-customers                - 2026-10-24: every customer who has an invoice, ONE row per customer, keyed by OUR customer id (customerId).
///   GET /api/zoho/invoice-customers/{customerId}   - 2026-10-24: one of them.
/// (the Ledger Master customers - Party / Insurance / Company - are in ZohoMasterDataController: GET / POST / PUT / DELETE /api/zoho/customers.)
///
/// 2026-10-24 (Zoho: "create customers using their unique DMS Customer ID when the invoice is pushed ... all master and transaction ids from DMS are stored in Zoho Books as unique identifiers"):
/// THE CUSTOMER ID OF A BILL. A repair bill has its own CustomerId column, but it is EMPTY on every bill (347 of 347 checked on 24.10.2026) - the repair bill page saves only the typed party name. The bill's customer is
/// therefore found through its JOB CARD (RepairBillDoc.JobCardId -> JobCard.CustomerId -> Customers). The id handed to Zoho is that Customers.Id (a GUID, unique in our database, never reused) = "customerId". Order used:
///   1. the bill's own CustomerId, when it is set and matches a Ledger Master row (source LedgerMaster: full details + customerCode = the Ledger Code LED/###) or a Customers row (source Customer);
///   2. else the job card's customer (source JobCardCustomer: name, mobile, e-mail, address, city, state);
///   3. else nothing (source None: a bill saved with neither a customer nor a job card - only the typed partyName is known, so there is NO id for Zoho to key it by; X-Bills-Without-Customer counts them).
/// Zoho should create the customer from the "customer" block of the invoice and store customerId as its unique key; later invoices and edits of the same customer carry the same customerId.
///
/// SCOPE OF DATA RETURNED: Repair Bills and Material Transfers return the same full line-item / tax / total shape as RepairBillDocsController.ToRow / MaterialTransferDocsController.ToRow (re-declared here because
/// those are private), plus the dealer. Job cards stay a status view (no pricing). The ONLY scoping rule is DealerId membership in the resolved Magnemite set - not the party on a document.
/// </summary>
[ApiController]
[Route("api/zoho")]
[AllowAnonymous]
public class ZohoIntegrationController : ControllerBase
{
    private const int MaxPageSize = 1000;
    private const int DefaultPageSize = 500;

    /// <summary>The three dealer exclusions as given (name + BaplDmsDealerCode + city). Only the code is used for matching: MAGNEMITE MOTO LLP-PUNE / -AHMEDABAD carry a "-CITY" suffix on Name but the third,
    /// MAGNEMITE MOTO LLP / CUS0209 / RAJKOT, does not - matching on the code sidesteps that inconsistency.</summary>
    private static readonly (string BaplDealerCode, string Name, string? City)[] ExcludedDealers =
    {
        ("CUS0347", "MAGNEMITE MOTO LLP-PUNE", null),
        ("CUS0213", "MAGNEMITE MOTO LLP-AHMEDABAD", "AHMEDABAD"),
        ("CUS0209", "MAGNEMITE MOTO LLP", "RAJKOT"),
    };
    private static readonly string[] ExcludedBaplDealerCodes = ExcludedDealers.Select(d => d.BaplDealerCode).ToArray();

    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<ZohoIntegrationController> _logger;

    public ZohoIntegrationController(JobCardScannerDbContext db, IConfiguration config, ILogger<ZohoIntegrationController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>X-API-Key = ApiKeys:Zoho. The comparison is constant-time (24.10.2026; it used to be a plain string compare).</summary>
    private IActionResult? CheckApiKey()
    {
        var configuredKey = _config["ApiKeys:Zoho"];
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            _logger.LogWarning("Zoho API called but ApiKeys:Zoho is not configured - refusing every request until it is set.");
            return StatusCode(503, new { message = "This integration is not yet configured." });
        }
        if (!Request.Headers.TryGetValue("X-API-Key", out var providedKey) || !SameKey(providedKey.ToString(), configuredKey))
            return Unauthorized(new { message = "Missing or invalid X-API-Key." });
        return null;
    }

    private static bool SameKey(string provided, string configured)
    {
        var a = Encoding.UTF8.GetBytes(provided);
        var b = Encoding.UTF8.GetBytes(configured);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    private static (int skip, int take) PageWindow(int pageIndex, int pageSize)
    {
        var size = pageSize <= 0 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize);
        return (Math.Max(0, pageIndex) * size, size);
    }

    /// <summary>The ONE place "all magnamite dealer excluding ..." is resolved to Dealer rows (Id, Name, BaplDmsDealerCode).</summary>
    private async Task<List<(Guid Id, string Name, string? BaplDmsDealerCode)>> ResolveAllowedDealersAsync()
    {
        var dealers = await _db.Dealers.AsNoTracking()
            .Where(d => d.Name.Contains("MAGNEMITE"))
            .Select(d => new { d.Id, d.Name, d.BaplDmsDealerCode })
            .ToListAsync();

        return dealers
            .Where(d => d.BaplDmsDealerCode == null || !ExcludedBaplDealerCodes.Contains(d.BaplDmsDealerCode))
            .Select(d => (d.Id, d.Name, d.BaplDmsDealerCode))
            .ToList();
    }

    /// <summary>The dealer ids of the scope, narrowed to one location when dealerCode is given.</summary>
    private static List<Guid> ScopeIds(List<(Guid Id, string Name, string? BaplDmsDealerCode)> allowed, string? dealerCode) =>
        string.IsNullOrWhiteSpace(dealerCode)
            ? allowed.Select(d => d.Id).ToList()
            : allowed.Where(d => d.BaplDmsDealerCode == dealerCode).Select(d => d.Id).ToList();

    /// <summary>GET /api/zoho/dealers - exactly which dealers this key resolves to (Name + BaplDmsDealerCode only).</summary>
    [HttpGet("dealers")]
    public async Task<IActionResult> Dealers()
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        return Ok(allowed
            .OrderBy(d => d.Name)
            .Select(d => new { d.Id, d.Name, BaplDealerCode = d.BaplDmsDealerCode }));
    }

    /// <summary>GET /api/zoho/jobcards?from=&amp;to=&amp;status=&amp;dealerCode=&amp;jobCardNumber= - job card status view across the in-scope dealers; from / to filter CreatedAt; capped at 500 rows, newest first.
    /// customerId (24.10.2026) is the job card's customer in OUR database - the same id the invoices and /invoice-customers use.</summary>
    [HttpGet("jobcards")]
    public async Task<IActionResult> JobCards(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] JobCardStatus? status, [FromQuery] string? dealerCode, [FromQuery] string? jobCardNumber)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var allowedIds = ScopeIds(allowed, dealerCode);
        if (allowedIds.Count == 0) return Ok(Array.Empty<object>());

        var query = _db.JobCards.AsNoTracking()
            .Include(j => j.Customer).Include(j => j.Vehicle).Include(j => j.CurrentStage)
            .Include(j => j.Dealer).Include(j => j.Complaints)
            .Where(j => allowedIds.Contains(j.DealerId));

        if (from is not null) { var f = from.Value.ToDateTime(TimeOnly.MinValue); query = query.Where(j => j.CreatedAt >= f); }
        if (to is not null) { var t = to.Value.ToDateTime(TimeOnly.MaxValue); query = query.Where(j => j.CreatedAt <= t); }
        if (status.HasValue) query = query.Where(j => j.Status == status);
        if (!string.IsNullOrWhiteSpace(jobCardNumber)) query = query.Where(j => j.JobCardNumber == jobCardNumber);

        var rows = await query.OrderByDescending(j => j.CreatedAt).Take(500).ToListAsync();

        return Ok(rows.Select(j => new
        {
            j.Id,
            j.JobCardNumber,
            Status = j.Status.ToString(),
            ServiceType = j.ServiceType.ToString(),
            Priority = j.Priority.ToString(),
            j.CreatedAt,
            j.ExpectedDeliveryAt,
            j.ActualDeliveryAt,
            j.ClosedAt,
            j.OdometerAtCheckIn,
            j.BatteryLevelAtCheckIn,
            DealerId = j.Dealer != null ? j.Dealer.Id : (Guid?)null,
            DealerName = j.Dealer != null ? j.Dealer.Name : null,
            DealerCode = j.Dealer != null ? j.Dealer.BaplDmsDealerCode : null,
            CustomerId = j.CustomerId,
            CustomerName = j.Customer != null ? j.Customer.Name : null,
            CustomerMobile = j.Customer != null ? j.Customer.Mobile : null,
            VehicleModel = j.Vehicle != null ? j.Vehicle.Model : null,
            RegNo = j.Vehicle != null ? j.Vehicle.RegNo : null,
            ChassisNo = j.Vehicle != null ? j.Vehicle.Vin : null,
            StageLabel = j.CurrentStage != null ? j.CurrentStage.Label : null,
            j.BaplJobType,
            j.BaplServiceHeadName,
            j.BaplServiceLocation,
            j.BaplServiceLocationCode,
            j.BaplManualJobNo,
            j.AssignedTechnicianName,
            Complaints = j.Complaints.Select(c => c.Description),
        }));
    }

    // ------------------------------------------------------------------ the customer of a bill (our unique customer id)

    /// <summary>The customer of a bill, with the id of OUR database. CustomerId is what Zoho stores as the unique key. CustomerCode is the Ledger Code (LED/###) only when the customer is a Ledger Master row.
    /// Source: LedgerMaster | Customer | JobCardCustomer | Unknown (the bill carries an id that matches no row) | None (no customer and no job card - only partyName is known).</summary>
    private sealed record BillCustomer(Guid? CustomerId, string? CustomerCode, string Source, string? Name, string? Type, string? Mobile, string? Email, string? Gstin, string? Pan,
        string? Address, string? Address2, string? City, string? State, string? Pin);

    private static BillCustomer FromCustomer(Customer c, string source) =>
        new(c.Id, null, source, c.Name, null, c.Mobile, c.Email, null, null, c.Address, null, c.City, c.State, null);

    private static BillCustomer FromLedger(LedgerMaster l) =>
        new(l.Id, l.LedgerCode, "LedgerMaster", l.LedgerName, l.LedgerTypeMaster?.CustomerType, l.MobileNumber, l.EMail, l.Gstno, l.Pan, l.Address, l.Address2, l.City, l.State, l.Pin);

    /// <summary>Looks the ids up as Ledger Master first, then as Customers. Used for a bill's OWN CustomerId (empty on every bill today) and for /invoice-customers.</summary>
    private async Task<Dictionary<Guid, BillCustomer>> ResolveCustomersAsync(List<Guid> ids)
    {
        var result = new Dictionary<Guid, BillCustomer>();
        if (ids.Count == 0) return result;
        foreach (var l in await _db.LedgerMasters.AsNoTracking().Include(x => x.LedgerTypeMaster).Where(x => ids.Contains(x.Id)).ToListAsync())
            result[l.Id] = FromLedger(l);
        var rest = ids.Where(i => !result.ContainsKey(i)).ToList();
        if (rest.Count > 0)
            foreach (var c in await _db.Customers.AsNoTracking().Where(x => rest.Contains(x.Id)).ToListAsync())
                result[c.Id] = FromCustomer(c, "Customer");
        return result;
    }

    /// <summary>The customer of one bill: its own CustomerId when that resolves, else the job card's customer, else none.</summary>
    private static BillCustomer BillCustomerOf(RepairBillDoc b, Dictionary<Guid, BillCustomer> own)
    {
        if (b.CustomerId is Guid id && own.TryGetValue(id, out var found)) return found;
        var viaJobCard = b.JobCard?.Customer;
        if (viaJobCard is not null) return FromCustomer(viaJobCard, "JobCardCustomer");
        return new BillCustomer(b.CustomerId, null, b.CustomerId is null ? "None" : "Unknown", b.PartyName, null, null, null, null, null, null, null, null, null, null);
    }

    // ------------------------------------------------------------------ repair bills (invoices)

    /// <summary>GET /api/zoho/repair-bills?from=&amp;to=&amp;dealerCode= - full Repair Bill detail (line items, discounts, CGST / SGST / IGST, totals) for every in-scope dealer's own JobCardScannerDb bills
    /// (IsDeleted excluded). from / to filter BillDate. Capped at 1000 rows, newest first. Every bill now carries customerId and a customer block - see this controller's doc comment. The header
    /// X-Bills-Without-Customer says how many of the returned bills have no customer at all (source None).</summary>
    [HttpGet("repair-bills")]
    public async Task<IActionResult> RepairBills(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? dealerCode)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var dealerLookup = allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode));
        var allowedIds = ScopeIds(allowed, dealerCode);
        if (allowedIds.Count == 0) return Ok(Array.Empty<object>());

        var query = _db.RepairBillDocs.AsNoTracking().Where(r => !r.IsDeleted && allowedIds.Contains(r.DealerId));
        if (from is not null) query = query.Where(r => r.BillDate >= from);
        if (to is not null) query = query.Where(r => r.BillDate <= to);

        var bills = await query.Include(r => r.Items).Include(r => r.JobCard).ThenInclude(j => j!.Customer)
            .OrderByDescending(r => r.BillDate).Take(1000).ToListAsync();

        var ownIds = bills.Where(b => b.CustomerId != null).Select(b => b.CustomerId!.Value).Distinct().ToList();
        var own = await ResolveCustomersAsync(ownIds);
        var rows = bills.Select(b => (Bill: b, Customer: BillCustomerOf(b, own))).ToList();
        Response.Headers["X-Bills-Without-Customer"] = rows.Count(r => r.Customer.CustomerId is null).ToString();

        return Ok(rows.Select(r => ToRepairBillRow(r.Bill, dealerLookup, r.Customer)));
    }

    // ------------------------------------------------------------------ customers who have an invoice (keyed by our unique customer id)

    private sealed record InvoiceCustomerRow(Guid CustomerId, string? CustomerCode, string Source, string? Name, string? Type, string? Mobile, string? Email, string? Gstin, string? Pan,
        string? Address, string? Address2, string? City, string? State, string? Pin, int BillCount, DateOnly? FirstBillDate, DateOnly? LastBillDate, string? LastDealerCode, string? LastDealerName);

    /// <summary>Who has an invoice: one entry per customer id (the bill's own id, else its job card's customer), with the number of bills, the first / last bill date and the dealer of the last bill.</summary>
    private async Task<(List<(Guid Id, int Bills, DateOnly? First, DateOnly? Last, Guid LastDealerId)> Customers, int BillsWithoutCustomer)> InvoiceCustomerIndexAsync(
        List<Guid> dealerIds, DateOnly? from, DateOnly? to)
    {
        var q = _db.RepairBillDocs.AsNoTracking().Where(r => !r.IsDeleted && dealerIds.Contains(r.DealerId));
        if (from is not null) q = q.Where(r => r.BillDate >= from);
        if (to is not null) q = q.Where(r => r.BillDate <= to);
        var links = await q.Select(r => new { r.DealerId, r.BillDate, Key = r.CustomerId ?? (r.JobCard != null ? (Guid?)r.JobCard.CustomerId : null) }).ToListAsync();

        var keyed = links.Where(l => l.Key != null).ToList();
        var index = keyed.GroupBy(l => l.Key!.Value)
            .Select(g => (Id: g.Key, Bills: g.Count(), First: (DateOnly?)g.Min(x => x.BillDate), Last: (DateOnly?)g.Max(x => x.BillDate), LastDealerId: g.OrderByDescending(x => x.BillDate).First().DealerId))
            .OrderByDescending(x => x.Last).ThenBy(x => x.Id)
            .ToList();
        return (index, links.Count - keyed.Count);
    }

    private async Task<List<InvoiceCustomerRow>> InvoiceCustomerRowsAsync(
        List<(Guid Id, int Bills, DateOnly? First, DateOnly? Last, Guid LastDealerId)> page, Dictionary<Guid, (string Name, string? BaplDmsDealerCode)> dealerLookup)
    {
        var details = await ResolveCustomersAsync(page.Select(p => p.Id).ToList());
        return page.Select(p =>
        {
            details.TryGetValue(p.Id, out var d);
            dealerLookup.TryGetValue(p.LastDealerId, out var dealer);
            // a customer id with no row any more is still reported - Zoho keeps its own copy under that id
            return new InvoiceCustomerRow(p.Id, d?.CustomerCode, d?.Source ?? "Unknown", d?.Name, d?.Type, d?.Mobile, d?.Email, d?.Gstin, d?.Pan, d?.Address, d?.Address2, d?.City, d?.State, d?.Pin,
                p.Bills, p.First, p.Last, dealer.BaplDmsDealerCode, dealer.Name);
        }).ToList();
    }

    /// <summary>GET /api/zoho/invoice-customers?from=&amp;to=&amp;dealerCode=&amp;pageIndex=&amp;pageSize= - every customer who has at least one invoice (from / to filter the BILL date), ONE row per customer, keyed by customerId =
    /// OUR unique customer id: the same id the "customer" block of /repair-bills carries. Newest invoice first, paged (pageIndex from 0, pageSize default 500, max 1000); X-Total-Count = customers, X-Bills-Without-Customer =
    /// invoices that have no customer at all (they cannot be keyed - only a typed party name exists).</summary>
    [HttpGet("invoice-customers")]
    public async Task<IActionResult> InvoiceCustomers(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? dealerCode,
        [FromQuery] int pageIndex = 0, [FromQuery] int pageSize = 0)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var dealerIds = ScopeIds(allowed, dealerCode);
        if (dealerIds.Count == 0) { Response.Headers["X-Total-Count"] = "0"; Response.Headers["X-Bills-Without-Customer"] = "0"; return Ok(Array.Empty<object>()); }

        var (index, withoutCustomer) = await InvoiceCustomerIndexAsync(dealerIds, from, to);
        Response.Headers["X-Total-Count"] = index.Count.ToString();
        Response.Headers["X-Bills-Without-Customer"] = withoutCustomer.ToString();

        var (skip, take) = PageWindow(pageIndex, pageSize);
        var rows = await InvoiceCustomerRowsAsync(index.Skip(skip).Take(take).ToList(), allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode)));
        return Ok(rows);
    }

    /// <summary>GET /api/zoho/invoice-customers/{customerId} - one customer by OUR id (404 when that customer has no invoice at an in-scope dealer).</summary>
    [HttpGet("invoice-customers/{customerId:guid}")]
    public async Task<IActionResult> InvoiceCustomer(Guid customerId)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var dealerIds = ScopeIds(allowed, null);
        var (index, _) = await InvoiceCustomerIndexAsync(dealerIds, null, null);
        var hit = index.Where(i => i.Id == customerId).ToList();
        if (hit.Count == 0) return NotFound(new { message = "That customer has no invoice at an in-scope dealer." });
        var rows = await InvoiceCustomerRowsAsync(hit, allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode)));
        return Ok(rows[0]);
    }

    // ------------------------------------------------------------------ material transfers

    /// <summary>GET /api/zoho/material-transfers?from=&amp;to=&amp;dealerCode= - same shape reasoning as RepairBills, for Material Transfer documents. from / to filter TransferDate. Capped at 1000 rows, newest first.
    /// customerId (24.10.2026) is the customer of the transfer's job card, when it has one.</summary>
    [HttpGet("material-transfers")]
    public async Task<IActionResult> MaterialTransfers(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? dealerCode)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var allowed = await ResolveAllowedDealersAsync();
        var dealerLookup = allowed.ToDictionary(d => d.Id, d => (d.Name, d.BaplDmsDealerCode));
        var allowedIds = ScopeIds(allowed, dealerCode);
        if (allowedIds.Count == 0) return Ok(Array.Empty<object>());

        var query = _db.MaterialTransferDocs.AsNoTracking().Where(m => allowedIds.Contains(m.DealerId));
        if (from is not null) query = query.Where(m => m.TransferDate >= from);
        if (to is not null) query = query.Where(m => m.TransferDate <= to);

        var docs = await query.Include(m => m.Items).Include(m => m.JobCard)
            .OrderByDescending(m => m.TransferDate).Take(1000).ToListAsync();

        return Ok(docs.Select(d => ToMaterialTransferRow(d, dealerLookup)));
    }

    /// <summary>Re-declared from RepairBillDocsController.ToRow (private there) - IDENTICAL field set, plus the dealer (DealerId / DealerName / DealerCode) so a multi-dealer caller can tell which location each
    /// bill belongs to, plus (24.10.2026) CustomerId and Customer: the customer with OUR unique id.</summary>
    private static object ToRepairBillRow(RepairBillDoc b, Dictionary<Guid, (string Name, string? BaplDmsDealerCode)> dealerLookup, BillCustomer customer)
    {
        dealerLookup.TryGetValue(b.DealerId, out var dealer);
        return new
        {
            b.Id,
            b.BillNumber,
            BillDate = b.BillDate,
            DealerId = b.DealerId,
            DealerName = dealer.Name,
            DealerCode = dealer.BaplDmsDealerCode,
            b.JobCardId,
            JobCardNumber = b.JobCard?.JobCardNumber,
            CustomerId = customer.CustomerId,
            b.PartyName,
            Customer = customer,
            b.RegNo,
            b.ChassisNo,
            b.Location,
            b.BillType,
            b.IssueType,
            Status = b.Status.ToString(),
            b.Remarks,
            b.InsuranceCompanyName,
            b.InsuranceDescription,
            b.SurveyorName,
            b.SurveyorContactNumber,
            b.PolicyNo,
            b.InsuranceValidTill,
            b.ZeroDepreciation,
            b.TotalDiscount,
            b.AmountReceived,
            b.TaxableAmount,
            b.CgstAmount,
            b.SgstAmount,
            b.IgstAmount,
            b.TotalAmount,
            ItemCount = b.Items.Count,
            Items = b.Items.Select(i => new
            {
                i.Id,
                ItemType = i.ItemType.ToString(),
                i.ItemCode,
                i.ItemDescription,
                i.HsnCode,
                i.IssueType,
                i.Qty,
                i.Rate,
                i.DiscountType,
                i.DiscountValue,
                // computed fresh from the two stored fields, same arithmetic as RepairBillDocsController.BuildAndAttachItemsAsync (see ComputeDiscountAmount)
                DiscountAmount = ComputeDiscountAmount(i.Qty, i.Rate, i.DiscountType, i.DiscountValue),
                i.CgstPct,
                i.SgstPct,
                i.IgstPct,
                i.TaxableAmount,
                i.CgstAmount,
                i.SgstAmount,
                i.IgstAmount,
                i.TotalAmount,
                i.ExtendedBatteryWarrantySchemeId,
                i.IsUnderExtendedWarranty,
            }),
        };
    }

    /// <summary>Same discount arithmetic as RepairBillDocsController.BuildAndAttachItemsAsync (gross = Qty * Rate; "Percentage" applies DiscountValue as a % of gross, anything else is a flat rupee amount; capped
    /// at gross so a line never goes negative) - re-declared because that method is private.</summary>
    private static decimal ComputeDiscountAmount(double qty, decimal rate, string? discountType, decimal discountValue)
    {
        decimal gross = (decimal)qty * rate;
        decimal discountAmt = string.Equals(discountType, "Percentage", StringComparison.OrdinalIgnoreCase)
            ? gross * discountValue / 100m
            : discountValue;
        return discountAmt > gross ? gross : discountAmt;
    }

    /// <summary>Re-declared from MaterialTransferDocsController.ToRow. Material Transfer has no discount columns at all (no discount value exists anywhere for a transfer line), so none is returned.</summary>
    private static object ToMaterialTransferRow(MaterialTransferDoc m, Dictionary<Guid, (string Name, string? BaplDmsDealerCode)> dealerLookup)
    {
        dealerLookup.TryGetValue(m.DealerId, out var dealer);
        return new
        {
            m.Id,
            m.TransferNumber,
            TransferDate = m.TransferDate,
            DealerId = m.DealerId,
            DealerName = dealer.Name,
            DealerCode = dealer.BaplDmsDealerCode,
            m.JobCardId,
            JobCardNumber = m.JobCard?.JobCardNumber,
            CustomerId = m.JobCard?.CustomerId,
            m.Location,
            TransferType = m.TransferType.ToString(),
            m.IssueType,
            m.PartyName,
            m.TechnicianId,
            m.Remarks,
            Status = m.Status.ToString(),
            m.TotalAmount,
            ItemCount = m.Items.Count,
            Items = m.Items.Select(i => new
            {
                i.Id, i.ItemCode, i.ItemDescription, i.HsnCode, i.IssueType, i.Qty, i.Rate, i.Amount,
                i.RackNo, i.Bin, i.SerialNo, i.Mrp, i.ValidDays, i.ItemReceived,
                ItemType = i.ItemType.ToString(),
            }),
        };
    }
}
