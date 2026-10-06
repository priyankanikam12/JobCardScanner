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
///
/// 2026-10-05 ("i want to create this table in our Jobcard Db, fetch data from baplfinal ... and show on
/// our UI from our C_ItemMaster and also in jobcard"): the page (and Job Card Part Suggestion - see
/// JobCardsController.PartsCatalog) now reads JobCardScannerDb's OWN dbo.C_ItemMaster - a copy of BAPL's table
/// created by sql/2026-10-05_create_c_itemmaster_table.sql and filled by POST /api/item-master/sync (below) -
/// instead of querying baplfinal live on every search. The two new endpoints:
///   POST /api/item-master/sync        - CorporateAdmin/SystemAdmin only: refresh the copy from baplfinal.
///   GET  /api/item-master/sync-status - when it was last synced and how many rows it holds (any staff).
/// 2026-10-06 ("fetch only ProductMainGroupId = 2" + role-wise visibility): the local table holds ONLY spare parts
/// (ProductMainGroupId = 2, copied by the sync). CorporateAdmin / SystemAdmin see all of them; every other role sees only the
/// ACTIVE (Status Y or NULL) parts whose ItemName does NOT start with A2 / B8 (discontinued models) - the rule lives in
/// LocalItemMasterService.SearchAsync, so this list, Material Transfer's item-code picker and Job Card Part Suggestion all
/// behave the same. by-codes below is deliberately NOT filtered: it only prices lines that are already on a bill.
/// GET /api/item-master/by-codes (Material Transfer / Repair Bill pricing) reads the local copy first and falls
/// back to baplfinal (IBaplDealerService) only until the first sync has run.
/// </summary>
[ApiController]
[Route("api/item-master")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
public class ItemMasterController : ControllerBase
{
    private readonly IBaplDealerService _baplDealer;
    private readonly ILocalItemMasterService _localItemMaster;
    private readonly IPartUploadService _partUploads;
    private readonly ICurrentUserService _currentUser;
    private readonly ILogger<ItemMasterController> _logger;

    public ItemMasterController(
        IBaplDealerService baplDealer, ILocalItemMasterService localItemMaster, IPartUploadService partUploads,
        ICurrentUserService currentUser, ILogger<ItemMasterController> logger)
    {
        _baplDealer = baplDealer;
        _localItemMaster = localItemMaster;
        _partUploads = partUploads;
        _currentUser = currentUser;
        _logger = logger;
    }

    /// <summary>GET /api/item-master?q=...&amp;limit=... - the sidebar page's own browse/search list. q is
    /// optional (substring match on ItemCode/ItemName/DisplayName/HSNCode); omit for an unfiltered browse.
    ///
    /// 2026-10-05 ("why only 1000 records shown on ui" - the table holds 6,063): the fixed 1000-row cap is REMOVED.
    /// With no `limit` this returns EVERY matching row (the whole catalogue is ~6,000 rows, a few hundred KB of
    /// JSON); pass `limit=N` to cap it. Used by the Item Master page and by Material Transfer's Item Code picker
    /// (which preloads the catalogue), so both now see every item instead of just the first 1000 by name.
    ///
    /// 2026-10-06: `activeOnly=true` (sent by Material Transfer's Item Code picker) applies the "active + continuing" filter even for
    /// CorporateAdmin / SystemAdmin - those pages must never offer a deactivated or discontinued (A2 / B8) part. The Item Master page
    /// itself does not send it, so an admin still sees everything there.
    ///
    /// 2026-10-05: reads JobCardScannerDb's own C_ItemMaster copy (see this controller's doc comment), not
    /// baplfinal live. The response shape is unchanged, so the web page and the Android screen keep working
    /// as they are.
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
    public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] int? limit = null, [FromQuery] bool activeOnly = false)
    {
        IReadOnlyList<LocalItemMasterRow> items;
        try
        {
            items = await _localItemMaster.SearchAsync(q, limit ?? 0, HttpContext.RequestAborted, activeOnly: activeOnly);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read the local Item Master (q: {Q})", q);
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

    /// <summary>GET /api/item-master/sync-status - whether the local C_ItemMaster table exists, how many rows it
    /// holds and when it was last copied from baplfinal (UTC). The Item Master page shows this under its title.</summary>
    [HttpGet("sync-status")]
    public async Task<IActionResult> SyncStatus()
    {
        var status = await _localItemMaster.GetStatusAsync(HttpContext.RequestAborted);
        return Ok(new { tableExists = status.TableExists, rows = status.Rows, lastSyncedAt = status.LastSyncedAt });
    }

    /// <summary>
    /// POST /api/item-master/sync - copies BAPL's C_ItemMaster (baplfinal) into JobCardScannerDb's own
    /// dbo.C_ItemMaster, replacing what was there (all-or-nothing - see LocalItemMasterService.SyncFromBaplAsync).
    /// CorporateAdmin / SystemAdmin only: it replaces a catalogue every dealer searches, and it is a long-ish
    /// call (a few seconds to a minute depending on the row count). 409 if a sync is already running, 502 if
    /// baplfinal or the local table can't be reached (the message says which).
    /// </summary>
    [HttpPost("sync")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Sync()
    {
        try
        {
            var result = await _localItemMaster.SyncFromBaplAsync(HttpContext.RequestAborted);
            return Ok(new { rows = result.Rows, seconds = result.Seconds, syncedAt = result.SyncedAt });
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("already running", StringComparison.OrdinalIgnoreCase))
        {
            return Conflict(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Item Master sync failed.");
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
    ///
    /// 2026-10-05 (now that BaplDealerService.cs is in front of me): reads JobCardScannerDb's own C_ItemMaster copy
    /// first - the JSON is identical (LocalItemMasterRow has the same property names as BaplItemMasterRow). Only
    /// when the local table is missing / has never been synced does it fall back to the old live read of baplfinal,
    /// so Material Transfer / Repair Bill keep pricing correctly before the first sync.
    /// </summary>
    [HttpGet("by-codes")]
    public async Task<IActionResult> ByCodes([FromQuery] string? codes)
    {
        var codeList = (codes ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        try
        {
            var local = await _localItemMaster.GetByCodesAsync(codeList, HttpContext.RequestAborted);
            if (local is not null) return Ok(local.Values);
        }
        catch (Exception ex)
        {
            // Best-effort enrichment (see above): a problem with the local copy must never break the part picker.
            _logger.LogWarning(ex, "Local Item Master by-codes lookup failed - falling back to baplfinal.");
        }
        var byCode = await _baplDealer.GetItemMasterByCodesAsync(codeList, HttpContext.RequestAborted);
        return Ok(byCode.Values);
    }
}
