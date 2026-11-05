using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-11-04 (Learnall, "BGauss DMS - Zoho Books: Purchase Bills and Location IDs"): the endpoint that receives purchase bills from Zoho Books.
///   POST /api/zoho-purchase-bills   body = the payload of the document (event bill.created / bill.updated / bill.voided, billId, lines ...)
/// Auth: X-API-Key = ApiKeys:ZohoPurchase (503 until configured; 401 for a missing or wrong key). The location comes from dbo.ZohoLocationMap (Zoho location_id -> DMS dealer code + sub-location); only CONFIRMED rows are used.
/// Answers (all successes are HTTP 200 with a status): RECEIVED (a new bill), UPDATED (an edited bill: only the difference reaches stock), VOIDED (the bill's stock is reversed), DUPLICATE (the same bill again: already processed).
/// Errors: 400 {message, errors[]} not a valid bill or dealerCode does not match the location; 401; 404 {message, locationId} the Zoho location is not mapped (or confirmed) to a DMS location; 409 an edit of a bill that is already void;
/// 500 {message} not saved - Zoho should retry; 503 not configured. All rules are in PurchaseBillRules; the stock is the Part Upload balance (PartUploads.BalQty) that repair bills and material transfers already reduce.
/// A part with no Part Upload row at the location is not added to stock; it is listed in stock.notInStock of the answer and kept on the stored line.
/// </summary>
[ApiController]
[Route("api/zoho-purchase-bills")]
[AllowAnonymous]
public class ZohoPurchaseBillsController : ControllerBase
{
    private const string ApiKeyConfigName = "ApiKeys:ZohoPurchase";
    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<ZohoPurchaseBillsController> _logger;

    public ZohoPurchaseBillsController(JobCardScannerDbContext db, IConfiguration config, ILogger<ZohoPurchaseBillsController> logger)
    {
        _db = db; _config = config; _logger = logger;
    }

    private IActionResult? CheckApiKey()
    {
        var configured = _config[ApiKeyConfigName];
        if (string.IsNullOrWhiteSpace(configured)) return StatusCode(503, new { message = "This integration is not yet configured." });
        if (!Request.Headers.TryGetValue("X-API-Key", out var provided) || !SameKey(provided.ToString(), configured))
            return Unauthorized(new { message = "Missing or invalid X-API-Key." });
        return null;
    }

    private static bool SameKey(string provided, string configured)
    {
        var a = Encoding.UTF8.GetBytes(provided); var b = Encoding.UTF8.GetBytes(configured);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    public sealed class LocationRow { public string ZohoLocationId { get; set; } = ""; public string DealerCode { get; set; } = ""; public string SubLocation { get; set; } = ""; }
    public sealed class ExistingRow { public string PayloadHash { get; set; } = ""; public bool IsVoided { get; set; } }
    public sealed class OldLineRow { public string ItemCode { get; set; } = ""; public decimal AppliedQty { get; set; } }
    public sealed class PartRow { public string PartNo { get; set; } = ""; public decimal? BalQty { get; set; } }

    private static bool IsUniqueViolation(Exception ex) => ex.GetBaseException() is SqlException { Number: 2627 or 2601 };

    private static object Reply(string status, PurchaseBillIn b, IEnumerable<string>? notInStock = null, IEnumerable<string>? warnings = null) => new
    {
        status, purchaseBillId = b.BillId!.Trim(), billNumber = b.BillNumber?.Trim(), receivedAt = DateTime.UtcNow,
        stock = new { notInStock = (notInStock ?? Array.Empty<string>()).ToArray() }, warnings = (warnings ?? Array.Empty<string>()).ToArray(),
    };

    [HttpPost]
    public async Task<IActionResult> Receive([FromBody] PurchaseBillIn body, CancellationToken ct)
    {
        var authFail = CheckApiKey(); if (authFail is not null) return authFail;
        if (body is null) return BadRequest(new { message = "Invalid purchase bill.", errors = new[] { "the body is empty or is not JSON." } });
        var errors = PurchaseBillRules.Validate(body);
        if (errors.Count > 0) return BadRequest(new { message = "Invalid purchase bill.", errors });

        var billId = body.BillId!.Trim();
        var loc = (await _db.Database.SqlQueryRaw<LocationRow>(
            "SELECT [ZohoLocationId] AS ZohoLocationId, [DealerCode] AS DealerCode, [SubLocation] AS SubLocation FROM [dbo].[ZohoLocationMap] WHERE [ZohoLocationId] = {0} AND [Confirmed] = 1 AND [DealerCode] IS NOT NULL AND [SubLocation] IS NOT NULL",
            body.LocationId!.Trim()).ToListAsync(ct)).FirstOrDefault();
        if (loc is null) return NotFound(new { message = "This Zoho location is not mapped to a DMS location (or the mapping is not confirmed yet).", locationId = body.LocationId!.Trim() });
        if (!string.Equals(loc.DealerCode, body.DealerCode!.Trim(), StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Invalid purchase bill.", errors = new[] { $"dealerCode {body.DealerCode} does not match the DMS dealer of this location ({loc.DealerCode})." } });
        var dealerId = await _db.Dealers.AsNoTracking().Where(d => d.BaplDmsDealerCode == loc.DealerCode).Select(d => (Guid?)d.Id).FirstOrDefaultAsync(ct);
        if (dealerId is null) return NotFound(new { message = "The DMS dealer of this location was not found.", dealerCode = loc.DealerCode });

        var hash = PurchaseBillRules.Hash(body);
        var existing = (await _db.Database.SqlQueryRaw<ExistingRow>("SELECT [PayloadHash] AS PayloadHash, [IsVoided] AS IsVoided FROM [dbo].[ZohoPurchaseBills] WHERE [BillId] = {0}", billId).ToListAsync(ct)).FirstOrDefault();
        var action = PurchaseBillRules.Decide(body.Event!, existing is null ? null : new ExistingPurchaseBill(existing.PayloadHash, existing.IsVoided), hash);
        if (action == PurchaseBillAction.Duplicate) return Ok(Reply("DUPLICATE", body));
        if (action == PurchaseBillAction.VoidAgain) return Ok(Reply("VOIDED", body));
        if (action == PurchaseBillAction.RejectEditOfVoided) return Conflict(new { message = "This bill is already void in the DMS; a voided bill cannot be edited.", purchaseBillId = billId });

        // what an earlier version of this bill added to stock
        var oldByPart = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        if (existing is not null)
            foreach (var l in await _db.Database.SqlQueryRaw<OldLineRow>("SELECT [ItemCode] AS ItemCode, [AppliedQty] AS AppliedQty FROM [dbo].[ZohoPurchaseBillLines] WHERE [BillId] = {0}", billId).ToListAsync(ct))
                oldByPart[l.ItemCode.Trim()] = oldByPart.GetValueOrDefault(l.ItemCode.Trim()) + l.AppliedQty;

        Dictionary<string, decimal> delta; Dictionary<string, decimal>? lineApplied = null; var notInStock = new List<string>();
        var codes = (body.Lines ?? new()).Select(l => l.ItemCode!.Trim()).Concat(oldByPart.Keys).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var balances = new Dictionary<string, decimal?>(StringComparer.OrdinalIgnoreCase);
        if (codes.Count > 0)
        {
            var sql = "SELECT [PartNo] AS PartNo, [BalQty] AS BalQty FROM [dbo].[PartUploads] WHERE [DealerId] = @d AND [LocationCode] = @l AND [PartNo] IN (" + string.Join(",", codes.Select((_, i) => "@c" + i)) + ")";
            var ps = new List<object> { new SqlParameter("@d", dealerId.Value), new SqlParameter("@l", loc.SubLocation) };
            ps.AddRange(codes.Select((c, i) => (object)new SqlParameter("@c" + i, c)));
            foreach (var r in await _db.Database.SqlQueryRaw<PartRow>(sql, ps.ToArray()).ToListAsync(ct)) balances[r.PartNo.Trim()] = r.BalQty;
        }
        if (action == PurchaseBillAction.Void) delta = PurchaseBillRules.PlanVoid(oldByPart);
        else
        {
            var plan = PurchaseBillRules.Plan(body.Lines!.Select(l => (l.LineItemId!.Trim(), l.ItemCode!.Trim(), l.Quantity!.Value)), new HashSet<string>(balances.Keys, StringComparer.OrdinalIgnoreCase), oldByPart);
            delta = plan.DeltaByPart; lineApplied = plan.LineApplied; notInStock = plan.NotApplied;
        }
        var warnings = delta.Where(kv => balances.TryGetValue(kv.Key, out var bal) && (bal ?? 0m) + kv.Value < 0m).Select(kv => $"stock of {kv.Key} goes below 0 at {loc.SubLocation}.").ToList();

        try
        {
            var (sqlBatch, parameters) = PurchaseBillSql.Build(action, body, dealerId.Value, loc.SubLocation, hash, delta, lineApplied);
            await _db.Database.ExecuteSqlRawAsync(sqlBatch, parameters.Select(x => (object)new SqlParameter(x.Name, x.Value ?? DBNull.Value)).ToList(), ct);
        }
        catch (Exception ex) when (IsUniqueViolation(ex)) { return Ok(Reply("DUPLICATE", body)); }   // the same bill arrived twice at the same moment: the other request stored it
        catch (Exception ex)
        {
            _logger.LogError(ex, "Zoho purchase bill {BillId} ({Event}) could not be saved.", billId, body.Event);
            return StatusCode(500, new { message = "The purchase bill could not be saved. Please send it again.", purchaseBillId = billId });
        }

        _logger.LogInformation("Zoho purchase bill {BillId} {Event} -> {Action} at {Location}; not in stock: {NotInStock}", billId, body.Event, action, loc.SubLocation, string.Join(",", notInStock));
        var status = action switch { PurchaseBillAction.Void => "VOIDED", PurchaseBillAction.Update => "UPDATED", _ => "RECEIVED" };
        return Ok(Reply(status, body, notInStock, warnings));
    }
}
