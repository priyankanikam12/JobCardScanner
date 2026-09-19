using System.Text.RegularExpressions;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Backs the "Repair Bill" sidebar page (2026-09-17: "add 2 sidebar option in our jobscanner
/// Material Transfer and Repair bill ... for only this repair bill create this take reference all
/// of this and from DMSBAPLDATA databse fetch all data") - a read-only view of the Zomato-fleet
/// repair bill data AutoGeniusSync syncs from BAPL DMS's live RepairBill documents into DMSBAPLDATA
/// (a separate database on the same AWS RDS server as JobCardScannerDb itself - see
/// DMSBAPLDATAConnection's comment in appsettings.json). This app never writes to DMSBAPLDATA,
/// same read-only convention as BaplDmsController/BaplDmsService for the live BAPLDMSvad database.
/// </summary>
[ApiController]
[Route("api/dms-bapl-data")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
public class DmsBaplDataController : ControllerBase
{
    private readonly IDmsBaplDataService _dmsBaplData;
    private readonly ILogger<DmsBaplDataController> _logger;
    private readonly ICurrentUserService _currentUser;

    // A workshop LocCode is always {DealerCode}W{n} (e.g. "CUS0435W1" - see BaplDmsService's own
    // WorkshopLocCodeRegex/doc comment, confirmed against real LocationMaster rows), so stripping
    // the trailing "W<digits>" recovers the OWNING dealer's real DealerCode exactly - not a guess
    // or a fuzzy match, just undoing that concatenation. Used below because DMS_RepairBill has no
    // LocCode column of its own to scope by directly, only DealerCode.
    private static readonly Regex WorkshopSuffix = new(@"W\d+$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public DmsBaplDataController(IDmsBaplDataService dmsBaplData, ILogger<DmsBaplDataController> logger, ICurrentUserService currentUser)
    {
        _dmsBaplData = dmsBaplData;
        _logger = logger;
        _currentUser = currentUser;
    }

    /// <summary>
    /// GET /api/dms-bapl-data/repair-bills?party=Zomato - defaults to "Zomato" (the fleet this
    /// page was built for); pass party= empty/omit-with-blank to see every party (not surfaced in
    /// the UI yet, kept here for flexibility). 502 with the real error message on a genuine
    /// DMSBAPLDATA connection/schema problem - an empty result set (no matching bills yet) is a
    /// normal 200, not an error.
    /// </summary>
    [HttpGet("repair-bills")]
    public async Task<IActionResult> RepairBills([FromQuery] string? party = "Zomato")
    {
        try
        {
            var rows = await _dmsBaplData.GetRepairBillsAsync(party, HttpContext.RequestAborted);

            // 2026-09-18 "Work Area" location scoping, closing the gap flagged when Repair Bill
            // first shipped (see section 29's delivery notes): DMS_RepairBill carries a DealerCode
            // but no LocCode, so a scoped caller can only be narrowed to the DEALER their assigned
            // location(s) belong to - not the individual W1 vs W2 workshop the way Job Card and
            // Material Transfer are. A caller scoped to just one of a multi-workshop dealer's
            // locations will therefore still see ALL of that dealer's repair bills, not only that
            // one workshop's. This is disclosed, not silently approximated further (e.g. by
            // fuzzy-matching the free-text Location column against a workshop name) - a wrong
            // fuzzy match could leak another dealer's data, which is worse than the coarser-than-
            // ideal but exact dealer-level cut applied here.
            var allowedLocations = _currentUser.WorkLocationCodes;
            if (allowedLocations.Count > 0)
            {
                var allowedDealerCodes = allowedLocations
                    .Select(loc => WorkshopSuffix.Replace(loc, ""))
                    .Where(code => code.Length > 0)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                rows = rows.Where(r => r.DealerCode is not null && allowedDealerCodes.Contains(r.DealerCode)).ToList();
            }

            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMSBAPLDATA repair bills (party filter: {Party})", party);
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/dms-bapl-data/material-transfers?locCode=CUS0288W5 - backs the "Material Transfer"
    /// sidebar page (2026-09-17: "material transfer using location wise which dealer login that
    /// location wise which already we done w1..wn series for") - scoped to ONE dealer's own DMS
    /// workshop location, the same W1..Wn LocCode the Parts & Inventory page's "DMS Parts Inventory"
    /// panel already resolves via /api/bapl-dms/workshops. No locCode -> empty array, not every
    /// dealer's data (same convention as /api/bapl-dms/parts). 502 with the real error message on a
    /// genuine DMSBAPLDATA connection/schema problem.
    /// </summary>
    [HttpGet("material-transfers")]
    public async Task<IActionResult> MaterialTransfers([FromQuery] string? locCode)
    {
        // 2026-09-17 "Employees" page - Work Area location scoping (see User.WorkLocationCodes's
        // doc comment). A user WITH assigned locations can only ever see their own, regardless of
        // what locCode the client sent - the client-passed value is honored only when it's inside
        // that allow-list, so this can narrow to one of the user's own locations but never widen
        // past them. A user with no assigned locations (unrestricted) is unaffected.
        var allowedLocations = _currentUser.WorkLocationCodes;
        if (allowedLocations.Count > 0)
        {
            if (string.IsNullOrWhiteSpace(locCode))
                return StatusCode(403, new { message = "Select one of your assigned Work Area locations to view its material transfers." });
            if (!allowedLocations.Contains(locCode, StringComparer.OrdinalIgnoreCase))
                return StatusCode(403, new { message = "You're not assigned to this location. Ask your admin to add it under your Work Area on Admin -> Users." });
        }
        if (string.IsNullOrWhiteSpace(locCode)) return Ok(Array.Empty<DmsBaplDataMaterialTransferRow>());
        try
        {
            var rows = await _dmsBaplData.GetMaterialTransfersAsync(locCode, HttpContext.RequestAborted);
            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMSBAPLDATA material transfers (locCode: {LocCode})", locCode);
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/dms-bapl-data/vehicle-sales?soldTo=Zomato - backs the "Vehicle Sale" sidebar page
    /// (2026-09-18: "i want 1 option in sidebar that was Vehicle sale from DMSBAPLDATA select *
    /// from DMS_VehicleSales where SoldTo like '%Zomato%'"). Defaults to "Zomato"; pass soldTo=
    /// empty/blank to see every buyer (not surfaced in the UI yet, kept for flexibility). 502 with
    /// the real error message on a genuine DMSBAPLDATA connection/schema problem - an empty result
    /// set (no matching sales yet) is a normal 200, not an error.
    /// </summary>
    [HttpGet("vehicle-sales")]
    public async Task<IActionResult> VehicleSales([FromQuery] string? soldTo = "Zomato")
    {
        try
        {
            var rows = await _dmsBaplData.GetVehicleSalesAsync(soldTo, HttpContext.RequestAborted);

            // Same dealer-level Work Area scoping as RepairBills above. DMS_VehicleSales' DealerCode
            // column (2026-09-18: corrected from an earlier DealerId guess - see
            // DmsBaplDataVehicleSaleRow's doc comment) already holds a plain dealer code (e.g.
            // "CUS0435"), not a workshop-suffixed LocCode, so stripping the trailing W<digits> off
            // the user's own assigned WorkLocationCodes (always {DealerCode}W{n}) recovers the same
            // dealer code to compare against directly - same exact-dealer-level cut as RepairBills,
            // for the same reason (no attempt to fuzzy-match this table's own LocCode suffix style
            // against a workshop LocCode - a wrong fuzzy match could leak another dealer's data,
            // worse than the coarser-than-ideal but exact cut applied here).
            var allowedLocations = _currentUser.WorkLocationCodes;
            if (allowedLocations.Count > 0)
            {
                var allowedDealerCodes = allowedLocations
                    .Select(loc => WorkshopSuffix.Replace(loc, ""))
                    .Where(code => code.Length > 0)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                rows = rows.Where(r => r.DealerCode is not null && allowedDealerCodes.Contains(r.DealerCode)).ToList();
            }

            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMSBAPLDATA vehicle sales (soldTo filter: {SoldTo})", soldTo);
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/dms-bapl-data/service-history?search=... - backs the "Service History" sidebar page
    /// (2026-09-18: "here i want after Jobcards this table Servive History From DMSBAPLDATA databse
    /// and like screen shot when search chasis or reg in 1 input box dont add filter by in 1 input
    /// box we can search chassis no. or reg no and search"). ONE search box, matched against BOTH
    /// ChassisNo and RegNo server-side - deliberately no separate Chasis/RegNo "Filter By" dropdown
    /// the way the legacy mydmsconnect.com report page has. A blank search returns 400 - there's no
    /// sensible default listing for a chassis/reg lookup table (unlike Repair Bill/Vehicle Sale's
    /// "Zomato" party default), same reasoning as MaterialTransfers requiring a locCode. 502 with the
    /// real error message on a genuine DMSBAPLDATA connection/schema problem - an empty result set
    /// (no service history for this vehicle yet) is a normal 200, not an error.
    /// </summary>
    [HttpGet("service-history")]
    public async Task<IActionResult> ServiceHistory([FromQuery] string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
            return BadRequest(new { message = "Enter a Chassis No. or Reg No. to search." });

        try
        {
            var rows = await _dmsBaplData.GetServiceHistoryAsync(search, HttpContext.RequestAborted);

            // Same dealer-level Work Area scoping as RepairBills/VehicleSales above.
            var allowedLocations = _currentUser.WorkLocationCodes;
            if (allowedLocations.Count > 0)
            {
                var allowedDealerCodes = allowedLocations
                    .Select(loc => WorkshopSuffix.Replace(loc, ""))
                    .Where(code => code.Length > 0)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                rows = rows.Where(r => r.DealerCode is not null && allowedDealerCodes.Contains(r.DealerCode)).ToList();
            }

            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMSBAPLDATA service history (search: {Search})", search);
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/dms-bapl-data/service-history/suggestions?q=... - the Service History page's
    /// typeahead dropdown (2026-09-18: "its taken from jobcard i want fetch data in service history
    /// from [DMS_ServiceHistory query]" - deliberately NOT /api/bapl-dms/vehicle-suggestions, which
    /// searches a different database/table; see DmsBaplDataServiceHistorySuggestion's doc comment).
    /// Fewer than 2 characters or a connection problem both just return an empty array (200) - a
    /// typeahead shouldn't surface an error banner for "keep typing" or a transient hiccup.
    /// </summary>
    [HttpGet("service-history/suggestions")]
    public async Task<IActionResult> ServiceHistorySuggestions([FromQuery] string? q, [FromQuery] int? take)
    {
        try
        {
            var rows = await _dmsBaplData.SearchServiceHistoryVehiclesAsync(q, take ?? 20, HttpContext.RequestAborted);
            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMSBAPLDATA service history suggestions (q: {Q})", q);
            return Ok(Array.Empty<DmsBaplDataServiceHistorySuggestion>());
        }
    }
}
