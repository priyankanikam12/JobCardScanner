using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// See MaterialTransferDoc's own doc comment for the full history. This round's change: Create()
/// now computes each line's discounted Amount server-side from DiscountType/DiscountValue (same
/// "server is the source of truth for money" convention RepairBillDocsController.Create already
/// follows) instead of the previous plain Qty x Rate, and both List()/Combined()/Get()'s row
/// projections now include DiscountType/DiscountValue so the combined-list detail popup can show
/// them. RackNo/Bin/SerialNo/ValidDays/ItemReceived stay in every projection unchanged - the
/// create page's grid no longer collects them, but a reader can still see them on an older saved
/// row.
/// </summary>
[ApiController]
[Route("api/material-transfer-docs")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
public class MaterialTransferDocsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IJobCardNumberingService _numbering;
    private readonly IDmsBaplDataService _dmsBaplData;
    private readonly IAuditLogService _audit;
    private readonly ILogger<MaterialTransferDocsController> _logger;

    public MaterialTransferDocsController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IJobCardNumberingService numbering,
        IDmsBaplDataService dmsBaplData, IAuditLogService audit, ILogger<MaterialTransferDocsController> logger)
    {
        _db = db;
        _currentUser = currentUser;
        _numbering = numbering;
        _dmsBaplData = dmsBaplData;
        _audit = audit;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? searchTerm = null, [FromQuery] DateOnly? dateFrom = null, [FromQuery] DateOnly? dateTo = null)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null) return Forbid();

        var query = _db.MaterialTransferDocs.AsNoTracking().Where(m => m.DealerId == dealerId);

        if (!string.IsNullOrWhiteSpace(searchTerm))
            query = query.Where(m => m.TransferNumber.Contains(searchTerm)
                || m.Items.Any(i => i.ItemCode.Contains(searchTerm) || i.ItemDescription.Contains(searchTerm)));
        if (dateFrom is not null) query = query.Where(m => m.TransferDate >= dateFrom);
        if (dateTo is not null) query = query.Where(m => m.TransferDate <= dateTo);

        var docs = await query.Include(m => m.Items).OrderByDescending(m => m.CreatedAt).ToListAsync();

        return Ok(docs.Select(ToRow));
    }

    [HttpGet("combined")]
    public async Task<IActionResult> Combined([FromQuery] string? locCode)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null) return Forbid();

        var localDocs = await _db.MaterialTransferDocs.AsNoTracking()
            .Where(m => m.DealerId == dealerId)
            .Include(m => m.Items)
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync();

        var combined = new List<CombinedMaterialTransferRow>(localDocs.Select(ToCombinedRow));

        string? dmsError = null;
        if (!string.IsNullOrWhiteSpace(locCode))
        {
            try
            {
                var dmsRows = await _dmsBaplData.GetMaterialTransfersAsync(locCode, HttpContext.RequestAborted);
                combined.AddRange(dmsRows.Select(t => new CombinedMaterialTransferRow(
                    Source: "DMSBAPLDATA",
                    Id: $"dms-{t.Id}",
                    TransferNumber: t.DocNo?.ToString() ?? "—",
                    SortDate: t.DocDate ?? t.CreatedAt,
                    Location: t.Location ?? t.LocCode,
                    TransferType: t.DocType,
                    PartyName: t.TechnicianName,
                    Status: null,
                    TotalAmount: t.Items.Sum(i => i.Qty * i.Rate - i.Discount + i.SgstAmount + i.CgstAmount + i.IgstAmount),
                    ItemCount: t.Items.Count,
                    Items: t.Items.Select(i => (object)new
                    {
                        i.Id, i.ItemIdno, i.ItemName, i.ItemDescription, i.ItemType, i.Qty, i.Rate,
                        i.SgstPer, i.SgstAmount, i.CgstPer, i.CgstAmount, i.IgstPer, i.IgstAmount,
                        i.Discount, i.Mrp,
                    }).ToList())));
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Combined material-transfer view: DMSBAPLDATA unreachable (locCode: {LocCode})", locCode);
                dmsError = ex.Message;
            }
        }

        return Ok(new { rows = combined.OrderByDescending(r => r.SortDate), dmsBaplDataError = dmsError });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var doc = await _db.MaterialTransferDocs.AsNoTracking().Include(m => m.Items)
            .FirstOrDefaultAsync(m => m.Id == id && m.DealerId == dealerId);
        return doc is null ? NotFound() : Ok(ToRow(doc));
    }

    /// <summary>
    /// POST /api/material-transfer-docs - creates and saves a material transfer document into
    /// JobCardScannerDb. Live DMS PartsInventory is still NOT touched.
    ///
    /// 2026-09-21 CORRECTION: each line's Amount is now computed here, server-side, from Qty x
    /// Rate minus a discount (DiscountType "Percentage" or "Amount", capped so it can never exceed
    /// the gross) - previously this was a plain Qty x Rate with no discount concept at all
    /// (Material Transfer's reference app has none - see MaterialTransferDoc's class doc comment
    /// on why this is a deliberate deviation from that reference, added per explicit instruction).
    /// Never trusts a client-computed Amount, matching RepairBillDocsController.Create's own
    /// "server is the source of truth for money" convention.
    ///
    /// PartUploads.BalQty decrement/restore-on-delete logic (see this method's earlier doc-comment
    /// rounds) is unchanged - it still keys off Item Code/Location/Qty only, independent of
    /// discount.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create(CreateMaterialTransferRequest req)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null) return Forbid();
        if (req.Items is null || req.Items.Count == 0) return BadRequest(new { message = "Add at least one item line." });

        var partUploadCache = new Dictionary<string, PartUpload>(StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(req.Location))
        {
            foreach (var it in req.Items)
            {
                if (string.IsNullOrWhiteSpace(it.ItemCode) || partUploadCache.ContainsKey(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == req.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) partUploadCache[it.ItemCode] = pu;
            }
            foreach (var it in req.Items)
            {
                if (!partUploadCache.TryGetValue(it.ItemCode, out var pu)) continue;
                var requestedQty = (decimal)it.Qty;
                var available = pu.BalQty ?? 0;
                if (requestedQty > available)
                    return BadRequest(new { message = $"Insufficient Part Upload stock for '{it.ItemCode}' at this location: available {available}, requested {requestedQty}." });
                pu.BalQty = available - requestedQty;
            }
        }

        var doc = new MaterialTransferDoc
        {
            DealerId = dealerId.Value,
            TransferNumber = await _numbering.NextMaterialTransferNumberAsync(dealerId.Value),
            JobCardId = req.JobCardId,
            Location = req.Location,
            TransferType = req.TransferType,
            IssueType = req.IssueType,
            PartyName = req.PartyName,
            TechnicianId = req.TechnicianId,
            Remarks = req.Remarks,
            TransferDate = req.TransferDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
            CreatedById = _currentUser.UserId,
            Status = MaterialTransferDocStatus.Draft,
        };

        foreach (var it in req.Items)
        {
            var gross = (decimal)it.Qty * it.Rate;
            var discountAmt = string.Equals(it.DiscountType, "Percentage", StringComparison.OrdinalIgnoreCase)
                ? gross * it.DiscountValue / 100m
                : string.Equals(it.DiscountType, "Amount", StringComparison.OrdinalIgnoreCase) ? it.DiscountValue : 0m;
            if (discountAmt > gross) discountAmt = gross;
            var amount = gross - discountAmt;

            doc.Items.Add(new MaterialTransferDocItem
            {
                PartId = it.PartId,
                ItemCode = it.ItemCode,
                ItemDescription = it.ItemDescription,
                HsnCode = it.HsnCode,
                IssueType = it.IssueType,
                Qty = it.Qty,
                Rate = it.Rate,
                DiscountType = string.IsNullOrWhiteSpace(it.DiscountType) || it.DiscountType == "None" ? null : it.DiscountType,
                DiscountValue = it.DiscountValue,
                Amount = amount,
                RackNo = it.RackNo,
                Bin = it.Bin,
                SerialNo = it.SerialNo,
                Mrp = it.Mrp,
                ValidDays = it.ValidDays,
                ItemReceived = it.ItemReceived,
            });
        }
        doc.TotalAmount = doc.Items.Sum(i => i.Amount);

        _db.MaterialTransferDocs.Add(doc);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("MaterialTransferDoc.Create", "MaterialTransferDoc", doc.Id.ToString(), new { doc.TransferNumber, doc.TotalAmount });

        return Ok(ToRow(doc));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var doc = await _db.MaterialTransferDocs.Include(m => m.Items)
            .FirstOrDefaultAsync(m => m.Id == id && m.DealerId == dealerId);
        if (doc is null) return NotFound();

        var isSystemAdmin = _currentUser.Role == StaffRole.SystemAdmin;
        if (!isSystemAdmin && doc.JobCardId is not null)
        {
            var jobBilled = await _db.RepairBillDocs.AsNoTracking()
                .AnyAsync(r => r.JobCardId == doc.JobCardId && r.DealerId == dealerId
                    && !r.IsDeleted && r.Status == RepairBillDocStatus.Billed);
            if (jobBilled)
                return BadRequest(new { message = "This job card has already been billed and its material transfer cannot be deleted." });
        }

        if (!string.IsNullOrWhiteSpace(doc.Location))
        {
            foreach (var it in doc.Items)
            {
                if (string.IsNullOrWhiteSpace(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == doc.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) pu.BalQty = (pu.BalQty ?? 0) + (decimal)it.Qty;
            }
        }

        _db.MaterialTransferDocs.Remove(doc);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("MaterialTransferDoc.Delete", "MaterialTransferDoc", doc.Id.ToString(), new { doc.TransferNumber });

        return NoContent();
    }

    [HttpPut("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] MaterialTransferDocStatus status)
    {
        var dealerId = _currentUser.DealerId;
        var doc = await _db.MaterialTransferDocs.FirstOrDefaultAsync(m => m.Id == id && m.DealerId == dealerId);
        if (doc is null) return NotFound();
        doc.Status = status;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("MaterialTransferDoc.StatusChange", "MaterialTransferDoc", doc.Id.ToString(), new { doc.Status });
        return Ok(ToRow(doc));
    }

    private static object ToRow(MaterialTransferDoc m) => new
    {
        Source = "JobCardScanner",
        m.Id,
        m.TransferNumber,
        TransferDate = m.TransferDate,
        m.Location,
        TransferType = m.TransferType.ToString(),
        m.IssueType,
        m.PartyName,
        m.TechnicianId,
        Status = m.Status.ToString(),
        m.TotalAmount,
        ItemCount = m.Items.Count,
        Items = m.Items.Select(i => new
        {
            i.Id, i.ItemCode, i.ItemDescription, i.HsnCode, i.IssueType, i.Qty, i.Rate,
            i.DiscountType, i.DiscountValue, i.Amount,
            i.RackNo, i.Bin, i.SerialNo, i.Mrp, i.ValidDays, i.ItemReceived,
        }),
    };

    private static CombinedMaterialTransferRow ToCombinedRow(MaterialTransferDoc m) => new(
        Source: "JobCardScanner",
        Id: m.Id.ToString(),
        TransferNumber: m.TransferNumber,
        SortDate: m.TransferDate.ToDateTime(TimeOnly.MinValue),
        Location: m.Location,
        TransferType: m.TransferType.ToString(),
        PartyName: m.PartyName,
        Status: m.Status.ToString(),
        TotalAmount: m.TotalAmount,
        ItemCount: m.Items.Count,
        Items: m.Items.Select(i => (object)new
        {
            i.Id, i.ItemCode, i.ItemDescription, i.HsnCode, i.IssueType, i.Qty, i.Rate,
            i.DiscountType, i.DiscountValue, i.Amount,
            i.RackNo, i.Bin, i.SerialNo, i.Mrp, i.ValidDays, i.ItemReceived,
        }).ToList());
}
