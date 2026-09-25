using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// "Item Master" sidebar page (2026-09-21: "add in sidebar option in Item master page fetch data
/// from C _ItemMaster table from baplfinal databse") - a read-only browse/search over BAPL's own
/// C_ItemMaster catalog (baplfinal, via BaplConnection - the same connection BaplDealerService's
/// dealer-import already reads C_CustomerMaster from). This is the same table Material Transfer/
/// Repair Bill's Rate/MRP/CGST/SGST/IGST calculation now sources its per-item Dealer Price and GST%
/// from (see BaplItemMasterRow's doc comment in BaplDealerService.cs) - this page is the
/// human-readable view of that same data, not a separate feature. Read-only: this app never writes
/// to baplfinal, same convention as every other BAPL-sourced integration in this codebase.
/// </summary>
[ApiController]
[Route("api/item-master")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
public class ItemMasterController : ControllerBase
{
    private readonly IBaplDealerService _baplDealer;
    private readonly IPartUploadService _partUploads;
    private readonly ICurrentUserService _currentUser;
    private readonly ILogger<ItemMasterController> _logger;

    public ItemMasterController(IBaplDealerService baplDealer, IPartUploadService partUploads, ICurrentUserService currentUser, ILogger<ItemMasterController> logger)
    {
        _baplDealer = baplDealer;
        _partUploads = partUploads;
        _currentUser = currentUser;
        _logger = logger;
    }

    /// <summary>GET /api/item-master?q=... - the sidebar page's own browse/search list. q is
    /// optional (substring match on ItemCode/ItemName/DisplayName); omit for an unfiltered browse
    /// (capped at 1000 rows server-side - see SearchItemMasterAsync's doc comment).
    ///
    /// 2026-09-25 ("in item master also qty bind in this page"): C_ItemMaster (baplfinal) itself
    /// has NO quantity/stock column at all - FACT, see BaplItemMasterRow's own doc comment, this
    /// table only carries Dlr_Price/GST%, never stock. The only quantity source in this codebase
    /// that isn't the live BAPLDMSvad connection (which the rest of this app's 2026-09-24 direction
    /// is moving away from - see JobCardsController.PartsCatalog's doc comment) is this dealer's own
    /// uploaded Part Upload data (PartUploads.BalQty) - the SAME source Part Suggestion's
    /// "(avail. X)" hint now uses. Summed across every location this dealer has uploaded stock for,
    /// since this page has no per-location filter UI. INTERPRETATION: a part with no "qty" value
    /// here means nothing has been uploaded for it yet, not necessarily "zero in stock"; a
    /// multi-workshop dealer's total here can overstate what's on the shelf at any one specific
    /// location - same disclosed trade-off as PartsCatalog's fallback.</summary>
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? q)
    {
        IReadOnlyList<BaplItemMasterRow> items;
        try
        {
            items = await _baplDealer.SearchItemMasterAsync(q, HttpContext.RequestAborted);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read BAPL item master (q: {Q})", q);
            return StatusCode(502, new { message = ex.Message });
        }

        Dictionary<string, decimal> qtyByCode = new(StringComparer.OrdinalIgnoreCase);
        if (_currentUser.DealerId.HasValue)
        {
            var uploads = await _partUploads.GetAsync(_currentUser.DealerId.Value, null, null, HttpContext.RequestAborted);
            foreach (var u in uploads)
                if (!string.IsNullOrWhiteSpace(u.PartNo) && u.BalQty.HasValue)
                    qtyByCode[u.PartNo] = (qtyByCode.TryGetValue(u.PartNo, out var existing) ? existing : 0m) + u.BalQty.Value;
        }

        return Ok(items.Select(i => new
        {
            itemCode = i.ItemCode,
            itemName = i.ItemName,
            displayName = i.DisplayName,
            hsnCode = i.HsnCode,
            dlrPrice = i.DlrPrice,
            sgst = i.Sgst,
            cgst = i.Cgst,
            igst = i.Igst,
            itemType = i.ItemType,
            status = i.Status,
            qty = qtyByCode.TryGetValue(i.ItemCode, out var qty) ? (decimal?)qty : null,
        }));
    }

    /// <summary>
    /// GET /api/item-master/by-codes?codes=CODE1,CODE2,... - bulk lookup by exact ItemCode, for
    /// Material Transfer/Repair Bill's part picker to enrich whatever it already has loaded (live
    /// DMS stock rows AND Part Upload rows alike) with this table's Dlr_Price/SGST/CGST/IGST - see
    /// GetItemMasterByCodesAsync's doc comment. Always 200 (even on a connection/schema failure -
    /// this is a best-effort enrichment call, never something that should block a part picker that
    /// otherwise already works); a code with no C_ItemMaster match, or every code on a failure, is
    /// simply absent from the result array rather than erroring.
    /// </summary>
    [HttpGet("by-codes")]
    public async Task<IActionResult> ByCodes([FromQuery] string? codes)
    {
        var codeList = (codes ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var byCode = await _baplDealer.GetItemMasterByCodesAsync(codeList, HttpContext.RequestAborted);
        return Ok(byCode.Values);
    }
}
