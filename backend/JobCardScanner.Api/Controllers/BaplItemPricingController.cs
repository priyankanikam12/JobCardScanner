using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Reads BAPL's C_ItemMaster (BaplConnection / baplfinal) for the Rate/GST%/HSN that drive Material
/// Transfer's and Repair Bill's MRP/Amount calculation (see gstCalc.ts's computeGstLine) and the new
/// "Item Master" sidebar page. A separate controller from BaplDmsController (BAPLDMSvadConnection)
/// and DmsBaplDataController (DMSBAPLDATAConnection) - this is a THIRD, distinct database.
///
/// GET items/{itemCode} is gated to ServiceAdvisorUp - the same floor Material Transfer/Repair Bill
/// creation already requires, since a line picker needs this for one specific item mid-create.
/// GET items (search/browse the whole catalog) is gated tighter, to WorkshopManagerUp - same
/// convention as Labour Master (pricing data is confidential per org policy; browsing every item's
/// Dlr_Price at once is more sensitive than reading one item's rate while building a document).
/// </summary>
[ApiController]
[Route("api/bapl-pricing")]
[Authorize(Policy = Policies.Staff)]
public class BaplItemPricingController : ControllerBase
{
    private readonly IBaplItemPricingService _pricing;
    private readonly ILogger<BaplItemPricingController> _logger;

    public BaplItemPricingController(IBaplItemPricingService pricing, ILogger<BaplItemPricingController> logger)
    {
        _pricing = pricing;
        _logger = logger;
    }

    /// <summary>GET /api/bapl-pricing/items/{itemCode} - single item's Rate (Dlr_Price)/GST%/HSN,
    /// used by Material Transfer/Repair Bill's item picker (pickPartForLine) the moment a part is
    /// selected. 404 means this item code isn't in C_ItemMaster at all (normal for a hand-typed or
    /// Part-Upload-only code) - the frontend falls back to a manual Rate entry in that case.</summary>
    [HttpGet("items/{itemCode}")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> GetItemPricing(string itemCode)
    {
        try
        {
            var row = await _pricing.GetItemPricingAsync(itemCode, HttpContext.RequestAborted);
            return row is null
                ? NotFound(new { message = $"No pricing found for item '{itemCode}' in C_ItemMaster." })
                : Ok(row);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "BAPL item pricing lookup failed for {ItemCode}", itemCode);
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/bapl-pricing/items?q=...&amp;take=... - the "Item Master" sidebar page's
    /// search/browse. q is optional (omit to list up to `take` items); matches ItemCode, ItemName,
    /// or HSNCode as a substring.</summary>
    [HttpGet("items")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> SearchItems([FromQuery] string? q, [FromQuery] int take = 200)
    {
        try
        {
            var rows = await _pricing.SearchItemsAsync(q, take, HttpContext.RequestAborted);
            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "BAPL item master search failed for q={Q}", q);
            return StatusCode(502, new { message = ex.Message });
        }
    }
}
