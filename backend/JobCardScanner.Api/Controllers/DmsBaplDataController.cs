using System.Text.RegularExpressions;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Backs the "Repair Bill" sidebar page (2026-09-17: "add 2 sidebar option in our jobscanner
/// Material Transfer and Repair bill ... for only this repair bill create this take reference all
/// of this and from DMSBAPLDATA databse fetch all data") - a read-only view of the Zomato-fleet
/// repair bill data AutoGeniusSync syncs from DMS's live RepairBill documents into DMSBAPLDATA
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
    // 2026-10-02 ADDED ("still fetched only zomato data remove this and login dealer data sown and
    // systemadmin show all data"): needed to resolve the signed-in user's own Dealer.BaplDmsDealerCode
    // server-side (see ResolveOwnDealerCodeAsync below) - same DbContext dependency/lookup pattern
    // already used by JobCardsController.VehicleLookupForWizard (`_db.Dealers... .Select(d =>
    // d.BaplDmsDealerCode)`), reused here rather than inventing a new one. This app never WRITES
    // through this DbContext in this controller, only reads the Dealer row - same read-only posture
    // as everything else in this file.
    private readonly JobCardScannerDbContext _db;

    // A workshop LocCode is always {DealerCode}W{n} (e.g. "CUS0435W1" - see BaplDmsService's own
    // WorkshopLocCodeRegex/doc comment, confirmed against real LocationMaster rows), so stripping
    // the trailing "W<digits>" recovers the OWNING dealer's real DealerCode exactly - not a guess
    // or a fuzzy match, just undoing that concatenation. Used below because DMS_RepairBill has no
    // LocCode column of its own to scope by directly, only DealerCode.
    private static readonly Regex WorkshopSuffix = new(@"W\d+$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public DmsBaplDataController(IDmsBaplDataService dmsBaplData, ILogger<DmsBaplDataController> logger, ICurrentUserService currentUser, JobCardScannerDbContext db)
    {
        _dmsBaplData = dmsBaplData;
        _logger = logger;
        _currentUser = currentUser;
        _db = db;
    }

    // 2026-10-02 ADDED: same "isOrgWideRole" convention as LedgerMasterController/JobCardsController -
    // CorporateAdmin/SystemAdmin see every dealer's data (dealerCode stays null, no SQL-level
    // filter), everyone else is always forced to their OWN dealer, resolved server-side below -
    // never from a client-supplied value, same security posture LedgerMasterController's class doc
    // comment states explicitly ("a client-supplied DealerId is never trusted for these roles").
    private bool IsOrgWideRole => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    /// <summary>
    /// Resolves the signed-in user's own dealer's BaplDmsDealerCode (the DMS dealer-code space
    /// DMS_RepairBill.DealerCode/DMS_SaleBill.dealer_code live in - NOT this app's local Dealer.Code,
    /// a different code space, see JobCardsController.Detail's own BaplDealerCode doc comment) for
    /// use as the dealerCode SQL-level scope on GetRepairBillsAsync/GetVehicleSalesAsync's dealer-
    /// aware overloads. Returns null for an org-wide role (no scoping - see every dealer) or a user
    /// with no DealerId/no matching Dealer row (nothing to scope to - callers should treat this the
    /// same as "show nothing" rather than silently falling through to unscoped, matching the
    /// existing safety convention already used on RepairBillPage.tsx's own non-org-wide guard).
    /// </summary>
    private async Task<string?> ResolveOwnDealerCodeAsync()
    {
        if (IsOrgWideRole) return null;
        if (_currentUser.DealerId is null) return null;
        return await _db.Dealers.AsNoTracking()
            .Where(d => d.Id == _currentUser.DealerId)
            .Select(d => d.BaplDmsDealerCode)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// GET /api/dms-bapl-data/repair-bills?party=&amp;dealerCode= - SECTION 190 (2026-10-02, "still
    /// fetched only zomato data remove this and login dealer data sown and systemadmin show all
    /// data"): REPLACES the old hardcoded `party = "Zomato"` default, which was ALSO the only real
    /// scoping this endpoint ever had. FACT (confirmed by reading this exact file before this fix):
    /// because RepairBillPage.tsx's party box is blank by default, axios omits the `party` query key
    /// entirely when nothing is typed, and ASP.NET Core's model binder then fell back to this
    /// parameter's OWN C# default - so even after the frontend's SECTION 190 fix stopped defaulting
    /// its search box to "Zomato", every blank search here was STILL silently asking DMSBAPLDATA for
    /// "Zomato" only, because the default lived here too, not just in the removed frontend code.
    /// `party` is now a real optional filter with no default (null = every party).
    ///
    /// Real dealer scoping is now applied SQL-side via GetRepairBillsAsync's dealer-aware overload,
    /// using a dealerCode resolved SERVER-SIDE from the signed-in user's own DealerId
    /// (ResolveOwnDealerCodeAsync) - never a client-supplied value, same "never trust the client for
    /// this" posture LedgerMasterController's class doc comment states. CorporateAdmin/SystemAdmin
    /// (IsOrgWideRole) get dealerCode: null and see every dealer, exactly as RepairBillPage.tsx's
    /// own isOrgWide branch expects. A non-org-wide user with no resolvable dealer code (no DealerId,
    /// or that Dealer has no BaplDmsDealerCode on file) gets an empty result rather than an unscoped
    /// fetch - same "show nothing rather than silently show everything" default RepairBillPage.tsx's
    /// own frontend guard already uses for this exact case.
    ///
    /// This CLOSES the cross-dealer data gap the WorkLocationCodes post-filter below never fully
    /// covered: that filter only narrows anything when the caller has WorkLocationCodes assigned at
    /// all (empty = unrestricted, a normal/majority case for most dealer logins), so before this fix
    /// a typical dealer-staff login with no Work Area restriction could see every OTHER dealer's
    /// "Zomato" repair bills (or every party's, by just clearing the box) - there was no dealer
    /// boundary underneath it. The WorkLocationCodes filter is left in place below, unchanged, as a
    /// narrower, supplementary cut for a user restricted to specific Work Areas within their own
    /// dealer - it is now redundant-but-harmless for everyone else.
    ///
    /// 502 with the real error message on a genuine DMSBAPLDATA connection/schema problem - an empty
    /// result set (no matching bills yet, or no resolvable dealer scope) is a normal 200, not an
    /// error.
    /// </summary>
    [HttpGet("repair-bills")]
    public async Task<IActionResult> RepairBills([FromQuery] string? party)
    {
        var dealerCode = await ResolveOwnDealerCodeAsync();
        if (!IsOrgWideRole && dealerCode is null)
            return Ok(Array.Empty<DmsBaplDataRepairBillRow>());

        try
        {
            var rows = await _dmsBaplData.GetRepairBillsAsync(party, dealerCode, HttpContext.RequestAborted);

            // 2026-09-18 "Work Area" location scoping - see this action's own doc comment above for
            // why this is kept as a SUPPLEMENTARY, narrower cut now that real dealer-level SQL
            // scoping is applied above, not the only scoping mechanism any more. DMS_RepairBill
            // carries a DealerCode but no LocCode, so a scoped caller can only be narrowed to the
            // DEALER their assigned location(s) belong to - not the individual W1 vs W2 workshop the
            // way Job Card and Material Transfer are. A caller scoped to just one of a
            // multi-workshop dealer's locations will therefore still see ALL of that dealer's repair
            // bills, not only that one workshop's. This is disclosed, not silently approximated
            // further (e.g. by fuzzy-matching the free-text Location column against a workshop
            // name) - a wrong fuzzy match could leak another dealer's data, which is worse than the
            // coarser-than-ideal but exact dealer-level cut applied here.
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
            _logger.LogWarning(ex, "Could not read DMSBAPLDATA repair bills (party filter: {Party}, dealerCode: {DealerCode})", party, dealerCode);
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
    /// GET /api/dms-bapl-data/vehicle-sales?soldTo= - backs the "Vehicle Sale" sidebar page.
    /// SECTION 190 (2026-10-02, "i want all so thats why i removed zomato why u added"): REMOVES the
    /// last hardcoded `soldTo = "Zomato"` default in this controller. FACT, same mechanism as
    /// RepairBills above: VehicleSalePage.tsx's 2026-09-30 fix ("remove condition soldto = zomato
    /// all data show") made the frontend stop asking for Zomato specifically, but that page's fetch
    /// sends NO `soldTo` query key at all - so ASP.NET Core's model binder was still falling back to
    /// THIS parameter's own C# default on every single request, silently re-locking Vehicle Sale to
    /// Zomato-only in production the entire time, exactly the same gap RepairBills had. `soldTo` is
    /// now a real optional filter with no default (null = every buyer).
    ///
    /// Real dealer scoping is now applied SQL-side via GetVehicleSalesAsync's dealer-aware overload,
    /// using the same server-resolved ResolveOwnDealerCodeAsync() as RepairBills above - never a
    /// client-supplied value. CorporateAdmin/SystemAdmin (IsOrgWideRole) get dealerCode: null and
    /// see every dealer; everyone else is forced to their own, or an empty result if none resolves.
    /// The WorkLocationCodes post-filter below is kept as a supplementary, narrower cut, same
    /// reasoning as RepairBills' own doc comment.
    ///
    /// 502 with the real error message on a genuine DMSBAPLDATA connection/schema problem - an empty
    /// result set (no matching sales yet, or no resolvable dealer scope) is a normal 200, not an
    /// error.
    /// </summary>
    [HttpGet("vehicle-sales")]
    public async Task<IActionResult> VehicleSales([FromQuery] string? soldTo)
    {
        var dealerCode = await ResolveOwnDealerCodeAsync();
        if (!IsOrgWideRole && dealerCode is null)
            return Ok(Array.Empty<DmsBaplDataVehicleSaleRow>());

        try
        {
            var rows = await _dmsBaplData.GetVehicleSalesAsync(soldTo, dealerCode, HttpContext.RequestAborted);

            // Same dealer-level Work Area scoping as RepairBills above - kept as a supplementary,
            // narrower cut now that real dealer-level SQL scoping is applied above. DMS_VehicleSales'
            // DealerCode column (2026-09-18: corrected from an earlier DealerId guess - see
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
            _logger.LogWarning(ex, "Could not read DMSBAPLDATA vehicle sales (soldTo filter: {SoldTo}, dealerCode: {DealerCode})", soldTo, dealerCode);
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
