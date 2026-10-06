using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using JobCardScanner.Api.Services.Integrations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

[ApiController]
[Route("api")]
[Authorize(Policy = Policies.Staff)]
public class PartsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IDmsClient _dms;
    private readonly IBaplDmsService _baplDms;
    private readonly IBaplItemPricingService _baplPricing;
    private readonly IAuditLogService _audit;
    private readonly ILogger<PartsController> _logger;
    private readonly ILocalItemMasterService _localItemMaster;

    public PartsController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IDmsClient dms, IBaplDmsService baplDms,
        IBaplItemPricingService baplPricing, IAuditLogService audit, ILogger<PartsController> logger, ILocalItemMasterService localItemMaster)
    {
        _db = db;
        _currentUser = currentUser;
        _dms = dms;
        _baplDms = baplDms;
        _baplPricing = baplPricing;
        _audit = audit;
        _logger = logger;
        _localItemMaster = localItemMaster;
    }

    /// <summary>
    /// GET /api/parts?q=...&amp;locationCode=... - the Parts &amp; Inventory catalog page. Always
    /// searches JobCardScanner's own local PartMaster catalog (unchanged); searches DMS's own
    /// PartsInventory (BAPLDMSvad - see BaplDmsService.GetPartsInventoryAsync) whenever a DMS
    /// workshop location code is supplied, exactly as before.
    ///
    /// 2026-09-21 ("still in PartsPage.tsx not fetched data from baplfinal"): ADDITIONALLY, once
    /// dmsParts is known, batch-enriches with real Rate (Dlr_Price)/GST%/HSN from BAPL's own
    /// C_ItemMaster (baplfinal, via BaplItemPricingService - the SAME source Material Transfer
    /// Bill/Repair Bill/Item Master already use) - a DIFFERENT item master than BAPLDMSvad's own
    /// ItemMaster, whose "Mrp" here is only that database's CustPrice with no per-item GST split.
    /// Returned as its own `baplPricing` array (keyed by ItemCode, joined client-side) rather than
    /// merged into dmsParts server-side, so a BAPL pricing failure never has to reshape the
    /// already-working dmsParts response - same "never let an enrichment break the main list"
    /// convention this action already followed for the dmsWarning branch. Best-effort: a failure
    /// here is logged and swallowed, dmsParts/localParts are returned regardless.
    /// </summary>
    [HttpGet("parts")]
    public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] string? locationCode)
    {
        var query = _db.PartMasters.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(q))
            query = query.Where(p => p.Name.Contains(q) || p.PartNumber.Contains(q) || (p.Category != null && p.Category.Contains(q)));
        var localParts = await query.OrderBy(p => p.Name).Take(100).ToListAsync();

        IReadOnlyList<BaplDmsPartStockRow> dmsParts = Array.Empty<BaplDmsPartStockRow>();
        string? dmsWarning = null;
        IReadOnlyList<BaplItemPricingRow> baplPricing = Array.Empty<BaplItemPricingRow>();

        if (!string.IsNullOrWhiteSpace(locationCode))
        {
            try
            {
                var rows = await _baplDms.GetPartsInventoryAsync(locationCode.Trim(), HttpContext.RequestAborted);
                dmsParts = string.IsNullOrWhiteSpace(q)
                    ? rows
                    : rows.Where(r => r.ItemCode.Contains(q.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Could not read DMS parts inventory for location {LocationCode}", locationCode);
                dmsWarning = "Could not reach DMS's parts inventory right now - showing JobCardScanner's own catalog only.";
            }

            if (dmsParts.Count > 0)
            {
                try
                {
                    var priceCodes = dmsParts.Select(p => p.ItemCode).ToList();
                    baplPricing = await _localItemMaster.GetPricingByCodesAsync(priceCodes, HttpContext.RequestAborted)
                        ?? await _baplPricing.GetItemsPricingAsync(priceCodes, HttpContext.RequestAborted);
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogWarning(ex, "Could not read BAPL item pricing (C_ItemMaster) for location {LocationCode}", locationCode);
                }
            }
        }

        return Ok(new { localParts, dmsParts, dmsWarning, baplPricing });
    }

    [HttpGet("parts/{partNumber}/network-availability")]
    public async Task<IActionResult> NetworkAvailability(string partNumber) =>
        Ok(await _dms.CheckNetworkAvailabilityAsync(partNumber));

    [HttpPost("jobcards/{jobCardId:guid}/parts")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> RequestPart(Guid jobCardId, RequestPartRequest req)
    {
        var part = await _db.PartMasters.FirstOrDefaultAsync(p => p.Id == req.PartId);
        if (part is null) return NotFound(new { message = "Part not found." });
        if (!await _db.JobCards.AnyAsync(j => j.Id == jobCardId)) return NotFound(new { message = "Job card not found." });

        var jcPart = new JobCardPart
        {
            JobCardId = jobCardId,
            PartId = req.PartId,
            Quantity = req.Quantity,
            UnitPrice = part.UnitPrice,
            Amount = part.UnitPrice * (decimal)req.Quantity,
            Status = JobCardPartStatus.Requested,
            RequestedById = _currentUser.UserId,
        };
        _db.JobCardParts.Add(jcPart);
        await _db.SaveChangesAsync();
        return Ok(jcPart);
    }

    [HttpPost("jobcard-parts/{id:guid}/issue")]
    [Authorize(Policy = Policies.PartsUserUp)]
    public async Task<IActionResult> Issue(Guid id)
    {
        var jcPart = await _db.JobCardParts.Include(p => p.Part).FirstOrDefaultAsync(p => p.Id == id);
        if (jcPart is null) return NotFound();
        if (jcPart.Part is null) return BadRequest();
        if (jcPart.Part.StockQty < jcPart.Quantity)
            return BadRequest(new { message = "Insufficient stock to issue this quantity." });

        jcPart.Part.StockQty -= (int)jcPart.Quantity;
        jcPart.Status = JobCardPartStatus.Issued;
        jcPart.IssuedById = _currentUser.UserId;
        jcPart.IssuedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("JobCardPart.Issue", "JobCardPart", jcPart.Id.ToString());
        return Ok(jcPart);
    }

    [HttpPost("jobcard-parts/{id:guid}/return")]
    [Authorize(Policy = Policies.PartsUserUp)]
    public async Task<IActionResult> Return(Guid id)
    {
        var jcPart = await _db.JobCardParts.Include(p => p.Part).FirstOrDefaultAsync(p => p.Id == id);
        if (jcPart is null) return NotFound();
        if (jcPart.Status == JobCardPartStatus.Issued && jcPart.Part is not null)
            jcPart.Part.StockQty += (int)jcPart.Quantity;
        jcPart.Status = JobCardPartStatus.Returned;
        await _db.SaveChangesAsync();
        return Ok(jcPart);
    }
}
