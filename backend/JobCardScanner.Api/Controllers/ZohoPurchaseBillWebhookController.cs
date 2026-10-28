using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Data;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-28 - receives the Zoho Books -> DMS purchase-bill push ("BGauss_DMS_Zoho_Books_Purchase_Bills_and_Locations.docx",
/// sections 1-6). This is the one new inbound endpoint in the whole integration - everywhere else DMS calls Zoho
/// (ZohoBooksApiClient); here Zoho calls DMS.
///
/// AUTH: follows the same [AllowAnonymous] + X-API-Key convention already used by the other Zoho controllers in this
/// codebase (ZohoPushSinkController, ZohoPushOpsController) - checked against a new config key, ApiKeys:ZohoPurchaseBillWebhook.
/// *** IMPORTANT - CONFIRM BEFORE SHIPPING ***: this file was written from the documented convention, not from the actual
/// existing controller source (those files were not shared in this conversation) - if the real ApiKeys check, route
/// prefix, or envelope shape differs even slightly, match this controller to the real one rather than the other way round.
///
/// PERSISTENCE: raw SQL via Database.ExecuteSqlRawAsync / SqlQueryRaw, matching ZohoPushStore.cs's established convention
/// for this codebase rather than adding new EF Core model types. Run sql/2026-10-28_ZohoPurchaseBillInbox.sql once before
/// deploying this.
///
/// STOCK UPDATE: genuinely NOT implemented. Section 5 says bill.created should "add the line quantities to stock at the
/// dealer" and bill.voided should "reverse it, including the stock" - but doing that needs (a) the location_id -> DMS
/// dealer/sub-location mapping from section 7, which is not yet filled in (BGauss's own data, 21 rows, blank - see the
/// cover note), and (b) knowing which DMS stock table/procedure actually owns stock-on-hand per dealer, which was not
/// part of anything shared in this conversation. ApplyStockForBillAsync below is a clearly-marked stub that logs and does
/// nothing else; wire in the real stock call once both of those are known. Everything else (storing the bill, dedup,
/// replying to Zoho) is fully functional without it.
/// </summary>
[ApiController]
[Route("api/zoho-purchase-bills")]
[AllowAnonymous]
public sealed class ZohoPurchaseBillWebhookController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<ZohoPurchaseBillWebhookController> _logger;

    public ZohoPurchaseBillWebhookController(JobCardScannerDbContext db, IConfiguration config, ILogger<ZohoPurchaseBillWebhookController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult<ZohoPurchaseBillWebhookReply>> ReceiveAsync([FromBody] ZohoPurchaseBillWebhookPayload payload, CancellationToken ct)
    {
        var expectedKey = _config["ApiKeys:ZohoPurchaseBillWebhook"];
        if (string.IsNullOrWhiteSpace(expectedKey))
        {
            _logger.LogError("ApiKeys:ZohoPurchaseBillWebhook is not configured - refusing every call until it is set.");
            return StatusCode(500, new ZohoPurchaseBillWebhookReply { Success = false, Status = "error", Message = "Server is not configured to accept purchase bills yet." });
        }
        if (!Request.Headers.TryGetValue("X-API-Key", out var providedKey) || providedKey != expectedKey)
            return Unauthorized(new ZohoPurchaseBillWebhookReply { Success = false, Status = "error", Message = "Missing or invalid X-API-Key." });

        if (!ModelState.IsValid)
        {
            var errors = string.Join(" ", ModelState.Values.SelectMany(v => v.Errors).Select(e => e.ErrorMessage));
            _logger.LogWarning("Zoho purchase bill webhook: rejected a malformed payload for billId {BillId}: {Errors}", payload?.BillId, errors);
            return BadRequest(new ZohoPurchaseBillWebhookReply { Success = false, Status = "error", Message = errors, BillId = payload?.BillId });
        }
        if (payload.Event is not ("bill.created" or "bill.updated" or "bill.voided"))
            return BadRequest(new ZohoPurchaseBillWebhookReply { Success = false, Status = "error", Message = $"Unrecognised event '{payload.Event}'.", BillId = payload.BillId });

        // idempotency (section 5: "If the same event for the same billId is received twice, DMS should treat the second
        // one as already processed.") - keyed on (billId, event, hash of the payload) since this payload carries no
        // separate top-level eventId of its own (unlike the generic Push API envelope the DMS->Zoho direction uses).
        // Hashed from the already-bound `payload` object (re-serialized deterministically) rather than the raw request
        // body: by the time this action runs, MVC's input formatter has already fully consumed Request.Body to produce
        // `payload`, and re-enabling buffering this late would not recover what was already read - re-serializing the
        // bound object is simpler and exactly as sound for this purpose (same billId+event+content in -> same hash out).
        var canonicalJson = JsonSerializer.Serialize(payload);
        var payloadHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalJson))).ToLowerInvariant();

        var alreadyProcessed = await _db.Database.SqlQueryRaw<int>(
            "SELECT COUNT(1) AS Value FROM dbo.ZohoPurchaseBillWebhookEvents WHERE BillId = {0} AND Event = {1} AND PayloadHash = {2}",
            payload.BillId, payload.Event, payloadHash).FirstAsync(ct);
        if (alreadyProcessed > 0)
        {
            _logger.LogInformation("Zoho purchase bill webhook: duplicate {Event} for billId {BillId} - already processed, replying 200 without re-applying it.", payload.Event, payload.BillId);
            return Ok(new ZohoPurchaseBillWebhookReply { Success = true, Status = "duplicate", Message = "Already processed.", BillId = payload.BillId });
        }

        try
        {
            if (payload.Event == "bill.voided")
                await VoidBillAsync(payload, ct);
            else
                await UpsertBillAsync(payload, ct); // bill.created and bill.updated are the same operation here - "all lines are sent each time" (section 5)

            await _db.Database.ExecuteSqlRawAsync(
                "INSERT INTO dbo.ZohoPurchaseBillWebhookEvents (BillId, Event, PayloadHash) VALUES ({0}, {1}, {2})",
                new object[] { payload.BillId, payload.Event, payloadHash }, ct);

            _logger.LogInformation("Zoho purchase bill webhook: {Event} for billId {BillId} ({BillNumber}) processed - {LineCount} line(s), total {Total}.",
                payload.Event, payload.BillId, payload.BillNumber, payload.Lines.Count, payload.Total);
            return Ok(new ZohoPurchaseBillWebhookReply { Success = true, Status = "accepted", Message = "Processed.", BillId = payload.BillId });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Zoho purchase bill webhook: failed to process {Event} for billId {BillId}.", payload.Event, payload.BillId);
            return StatusCode(500, new ZohoPurchaseBillWebhookReply { Success = false, Status = "error", Message = "Internal error while processing the bill - please retry later.", BillId = payload.BillId });
        }
    }

    /// <summary>bill.created and bill.updated both land here - "all lines are sent each time" (section 5), so an update is
    /// a full replace of the header + lines, same as the document describes. Adds stock only when this is a genuinely new
    /// bill (StockApplied = 0); an update that merely corrects figures after stock was already applied does NOT re-apply
    /// stock a second time - that would double-count receipts. (If Learnall ever needs a quantity correction to also
    /// adjust stock, that needs its own explicit rule - flagged here rather than guessed at.)</summary>
    private async Task UpsertBillAsync(ZohoPurchaseBillWebhookPayload p, CancellationToken ct)
    {
        var billDate = DateOnly.Parse(p.BillDate);
        var isNewBill = await _db.Database.SqlQueryRaw<int>(
            "SELECT COUNT(1) AS Value FROM dbo.ZohoPurchaseBillInbox WHERE BillId = {0}", p.BillId).FirstAsync(ct) == 0;

        await _db.Database.ExecuteSqlRawAsync(@"
            MERGE dbo.ZohoPurchaseBillInbox AS target
            USING (SELECT {0} AS BillId) AS src ON target.BillId = src.BillId
            WHEN MATCHED THEN UPDATE SET
                BillNumber = {1}, BillDate = {2}, Status = {3}, ReferenceNumber = {4}, VendorId = {5}, VendorName = {6},
                VendorGstin = {7}, SourceOfSupply = {8}, DestinationOfSupply = {9}, LocationId = {10}, LocationName = {11},
                DealerCode = {12}, SubTotal = {13}, TaxTotal = {14}, Total = {15}, LastEventId = {16}, LastEvent = {17},
                ModifiedUtc = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT
                (BillId, BillNumber, BillDate, Status, ReferenceNumber, VendorId, VendorName, VendorGstin, SourceOfSupply,
                 DestinationOfSupply, LocationId, LocationName, DealerCode, SubTotal, TaxTotal, Total, LastEventId, LastEvent)
                VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9}, {10}, {11}, {12}, {13}, {14}, {15}, {16}, {17});",
            new object[]
            {
                p.BillId, p.BillNumber, billDate, p.Status, (object?)p.ReferenceNumber ?? DBNull.Value, p.VendorId, p.VendorName,
                (object?)p.VendorGstin ?? DBNull.Value, p.SourceOfSupply, p.DestinationOfSupply, p.LocationId, p.LocationName,
                p.DealerCode, p.SubTotal, p.TaxTotal, p.Total, p.BillId + ":" + p.Event, p.Event,
            }, ct);

        // lines: delete-and-reinsert is simplest and matches "all lines are sent each time" - there is no partial-line
        // update case to preserve.
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM dbo.ZohoPurchaseBillInboxLine WHERE BillId = {0}", new object[] { p.BillId }, ct);
        foreach (var line in p.Lines)
        {
            await _db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO dbo.ZohoPurchaseBillInboxLine
                    (BillId, LineItemId, ItemCode, ItemName, HsnCode, Quantity, Unit, Rate, Discount, TaxName, TaxPercentage, TaxAmount, LineTotal)
                VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9}, {10}, {11}, {12});",
                new object[]
                {
                    p.BillId, line.LineItemId, line.ItemCode, line.ItemName, (object?)line.HsnCode ?? DBNull.Value,
                    line.Quantity, line.Unit, line.Rate, line.Discount, line.TaxName, line.TaxPercentage, line.TaxAmount, line.LineTotal,
                }, ct);
        }

        if (isNewBill)
            await ApplyStockForBillAsync(p, reverse: false, ct);
    }

    /// <summary>bill.voided - "find the bill by billId and reverse it, including the stock" (section 5). Only reverses
    /// stock once (VoidedOn IS NULL guard) so a repeated bill.voided for an already-voided bill - which the dedup check
    /// above should normally catch anyway via the payload hash - never double-reverses.</summary>
    private async Task VoidBillAsync(ZohoPurchaseBillWebhookPayload p, CancellationToken ct)
    {
        var wasAlreadyVoided = await _db.Database.SqlQueryRaw<int>(
            "SELECT COUNT(1) AS Value FROM dbo.ZohoPurchaseBillInbox WHERE BillId = {0} AND VoidedOn IS NOT NULL", p.BillId).FirstAsync(ct) > 0;

        await _db.Database.ExecuteSqlRawAsync(
            "UPDATE dbo.ZohoPurchaseBillInbox SET Status = 'void', VoidedOn = SYSUTCDATETIME(), LastEventId = {1}, LastEvent = 'bill.voided', ModifiedUtc = SYSUTCDATETIME() WHERE BillId = {0}",
            new object[] { p.BillId, p.BillId + ":bill.voided" }, ct);

        if (!wasAlreadyVoided)
            await ApplyStockForBillAsync(p, reverse: true, ct);
    }

    /// <summary>*** STUB - NOT IMPLEMENTED ***. See the class-level doc comment: this needs (1) the confirmed
    /// location_id -> DMS dealer/sub-location mapping (section 7, currently blank) and (2) the real DMS stock table or
    /// stored procedure to call, neither of which was shared in this conversation. For now this only logs what WOULD
    /// happen, and marks nothing as stock-applied, so a later real implementation can find every bill that still needs
    /// its stock effect applied with: SELECT * FROM ZohoPurchaseBillInbox WHERE StockApplied = 0 AND VoidedOn IS NULL.</summary>
    private Task ApplyStockForBillAsync(ZohoPurchaseBillWebhookPayload p, bool reverse, CancellationToken ct)
    {
        _logger.LogWarning(
            "Zoho purchase bill webhook: STOCK UPDATE NOT YET IMPLEMENTED - billId {BillId} ({BillNumber}) at dealer {DealerCode} ({LocationName}) would " +
            "{Action} stock for {LineCount} line(s) now. Wire in the real stock call once the dealer/location mapping (section 7) and the DMS stock table are confirmed.",
            p.BillId, p.BillNumber, p.DealerCode, p.LocationName, reverse ? "REVERSE" : "ADD", p.Lines.Count);
        return Task.CompletedTask;
    }
}
