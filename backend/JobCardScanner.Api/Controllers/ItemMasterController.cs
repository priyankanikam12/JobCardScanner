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
    private readonly ILogger<ItemMasterController> _logger;

    public ItemMasterController(IBaplDealerService baplDealer, ILogger<ItemMasterController> logger)
    {
        _baplDealer = baplDealer;
        _logger = logger;
    }

    /// <summary>GET /api/item-master?q=... - the sidebar page's own browse/search list. q is
    /// optional (substring match on ItemCode/ItemName/DisplayName); omit for an unfiltered browse
    /// (capped at 1000 rows server-side - see SearchItemMasterAsync's doc comment).</summary>
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? q)
    {
        try
        {
            return Ok(await _baplDealer.SearchItemMasterAsync(q, HttpContext.RequestAborted));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read BAPL item master (q: {Q})", q);
            return StatusCode(502, new { message = ex.Message });
        }
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
