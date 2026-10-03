using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// "Part Upload" sidebar tab (2026-09-21: "new tab add Part Upload using this excel create table
/// and functionality to upload using this excel file for upload") - see Models/PartUploads.cs's
/// doc comment for the confirmed source spreadsheet columns and why this writes to
/// JobCardScannerDb rather than DMS/DMSBAPLDATA. Import/Update/Delete are gated to PartsUserUp,
/// matching the existing Parts &amp; Inventory page's own policy (PartsController's GET
/// /api/parts) - a role that already sees the Parts &amp; Inventory nav entry can also use this
/// one to upload/edit/delete. Get() (the read/list) is gated far wider - see its own doc comment
/// below (2026-10-03) for why it was just widened all the way to Policies.Staff.
///
/// 2026-09-29 (SECTION 158, "still parts-upload in that that location data not shown ... no
/// worries to upload from that login if any login uploaded data shown that linked location"):
/// Get() below also scopes by the signed-in user's own Work Area (WorkLocationCodes), the
/// same "empty = unrestricted" convention JobCardsController.List already uses. Confirmed real,
/// not a guess: before this, Get() only ever filtered by DealerId + whatever `locationCode` the
/// page's own dropdown happened to pass - a Supervisor/Technician whose login is meant to be
/// restricted to one workshop location could clear that dropdown (or a caller could omit it) and
/// see every location's uploaded stock for the whole dealer.
///
/// 2026-09-29 (SECTION 161, real 403 reported on Stock Report for a Supervisor login whose
/// Network tab showed GET /api/part-uploads -&gt; 403, JWT decoded and confirmed app_role=
/// "Supervisor", a role PartsReadUp's own role list DOES include): the CLASS-LEVEL
/// [Authorize(Policy = Policies.PartsUserUp)] that used to sit here is REMOVED. ASP.NET Core does
/// NOT let a method-level [Authorize] "override" a class-level one on the same controller - when
/// both are present, the framework combines them and requires the request to satisfy BOTH
/// policies' requirements simultaneously (AuthorizationPolicy.Combine ANDs every [Authorize]
/// attribute in scope, class and method together). PartsUserUp's role list is {PartsUser,
/// WorkshopManager, DealerAdmin, CorporateAdmin, SystemAdmin} - it does NOT include Supervisor or
/// ServiceAdvisor. So even though Get()'s own [Authorize(Policy = Policies.PartsReadUp)] DOES
/// allow Supervisor/ServiceAdvisor, the class-level PartsUserUp gate was ALSO still being enforced
/// underneath it and rejected them anyway - the combined effective policy on Get() was really just
/// PartsUserUp's own (narrower) role list the whole time. Import/Update/Delete below did NOT have
/// their own [Authorize] before this - they relied purely on the (now-removed) class-level gate -
/// so each of them gets its own explicit [Authorize(Policy = Policies.PartsUserUp)] now, to keep
/// their access exactly as it was.
///
/// 2026-10-03 ("in partsupload already uploaded stock for uttamnager but in login of another role
/// not showing on captain page fix this for all role it will show stock"): FACT, confirmed from
/// your screenshot - a "Captain" login got the exact generic fallback text
/// PartUploadPage.tsx's load() shows ONLY when the GET itself errors with no message body
/// ("Could not load uploaded part data.", not the separate "No uploaded parts yet" empty-state
/// text a real zero-row result would show) - that is what a bare 403 from [Authorize] looks like
/// client-side, not a scoping/empty-result case. Root cause: Get() was still gated to
/// Policies.PartsReadUp, whose role list was fixed before Captain/ViceCaptain/Technician existed
/// (those three were added later) - so any login under one of those three roles got silently
/// 403'd here specifically, even though every other page they use works fine. Since the ask is
/// "for all role it will show stock" (not just Captain), Get() is widened all the way to
/// Policies.Staff - this app's own broadest baseline policy, already used as the class-level gate
/// on several other read endpoints (e.g. JobCardsController) - rather than to a hand-maintained
/// role list that would need updating again every time a new role is added. Import/Update/Delete
/// below are UNCHANGED and stay restricted to Policies.PartsUserUp - only the read was widened.
/// </summary>
[ApiController]
[Route("api/part-uploads")]
public class PartUploadController : ControllerBase
{
    private readonly IPartUploadService _partUploads;
    private readonly ICurrentUserService _currentUser;
    private readonly ILogger<PartUploadController> _logger;

    public PartUploadController(IPartUploadService partUploads, ICurrentUserService currentUser, ILogger<PartUploadController> logger)
    {
        _partUploads = partUploads;
        _currentUser = currentUser;
        _logger = logger;
    }

    /// <summary>2026-09-21 ("why stock not shown in material and repair bill page from
    /// part-upload"): a plain ServiceAdvisor can open Repair Bill/Material Transfer
    /// (ServiceAdvisorUp) and needs to read this list for the Item Code picker's merge-in. See
    /// Policies.PartsReadUp's doc comment (historical - this action no longer uses that policy,
    /// see the 2026-10-03 note below and the class's own doc comment for the full history).
    ///
    /// 2026-09-29 (SECTION 158) - see this controller's own class doc comment above for the full
    /// fix: `allowedLocations` (this login's own WorkLocationCodes) is passed into GetAsync
    /// alongside the existing `locationCode` dropdown filter, so a Work Area-restricted login
    /// can no longer see another location's uploaded stock, on top of (not instead of) the
    /// existing DealerId scope.
    ///
    /// 2026-10-03 ("in part upload also add date filter"): optional `dateFrom`/`dateTo`, filtering
    /// on PartUpload.ReportDate (the "as of" date picked on the upload form - see Models/
    /// PartUpload.cs's doc comment) - this grid had NO date filter of any kind before this; the
    /// only Date field on the page was the required upload-form Date, a separate concept. Named
    /// arguments used for the same reason the existing allowedLocations call already does - see
    /// GetAsync's own doc comment for the CS1503 this avoided once before.
    ///
    /// 2026-10-03 ("fix this for all role it will show stock") - WIDENED from
    /// Policies.PartsReadUp to Policies.Staff: see the class's own doc comment above for the full
    /// diagnosis (a Captain login was getting a silent 403 here because PartsReadUp's role list
    /// predates the Captain/ViceCaptain/Technician roles). Staff is this app's own broadest
    /// authenticated-user policy - viewing stock figures isn't a sensitive action the way
    /// uploading/editing/deleting them is (those three stay on PartsUserUp below, unchanged), so
    /// there's no real access-control reason to keep this narrower than "any signed-in staff
    /// member at this dealer" - and widening it here means a FUTURE new role never needs this same
    /// fix repeated.</summary>
    [HttpGet]
    [Authorize(Policy = Policies.Staff)]
    public async Task<IActionResult> Get([FromQuery] string? search, [FromQuery] string? locationCode, [FromQuery] DateOnly? dateFrom = null, [FromQuery] DateOnly? dateTo = null)
    {
        if (_currentUser.DealerId is not { } dealerId)
            return BadRequest(new { message = "Your login isn't linked to a dealer - Part Upload is scoped per dealer." });

        try
        {
            // 2026-09-29 CORRECTED: named argument for allowedLocations (rather than relying on
            // position) after the parameter order changed - see PartUploadService.GetAsync's own
            // doc comment for why (a real CS1503 compile error in a different, pre-existing caller
            // in JobCardsController.cs, caused by inserting this parameter in the wrong place the
            // first time). Named here so a future signature change can't silently miswire this
            // call the same way again.
            var allowedLocations = _currentUser.WorkLocationCodes;
            return Ok(await _partUploads.GetAsync(dealerId, locationCode, search, HttpContext.RequestAborted, allowedLocations: allowedLocations, dateFrom: dateFrom, dateTo: dateTo));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "PartUploads.Get failed");
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>2026-09-21 correction: Location and Date are now REQUIRED form fields, checked
    /// BEFORE the file is even opened - "before that 4 feild need to select Date, Location ...
    /// otherwise dont take the file need to select this feild then upload", matching Labour
    /// Master's own required Effective Date convention (LabourMasterController.Import).
    ///
    /// 2026-09-29 (SECTION 161): explicit [Authorize] added here - this used to rely solely on the
    /// class-level [Authorize(Policy = Policies.PartsUserUp)], which was removed (see the class's
    /// own doc comment for why). Same policy as before, just declared on the action directly now
    /// so this endpoint's access is unchanged by the 2026-10-03 Get()-only widening above.</summary>
    [HttpPost("import")]
    [RequestSizeLimit(50_000_000)]
    [Authorize(Policy = Policies.PartsUserUp)]
    public async Task<IActionResult> Import([FromForm] PartUploadImportForm form)
    {
        if (_currentUser.DealerId is not { } dealerId)
            return BadRequest(new { message = "Your login isn't linked to a dealer - Part Upload is scoped per dealer." });
        if (string.IsNullOrWhiteSpace(form.LocationCode))
            return BadRequest(new { message = "Location is required - pick it before uploading." });
        if (form.ReportDate is null)
            return BadRequest(new { message = "Date is required - pick it before uploading." });
        if (form.File is null || form.File.Length == 0)
            return BadRequest(new { message = "An Excel file is required." });

        try
        {
            await using var stream = form.File.OpenReadStream();
            var result = await _partUploads.ImportAsync(stream, dealerId, form.LocationCode, form.ReportDate.Value, form.File.FileName, _currentUser.UserName, HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "PartUploads.Import failed");
            return StatusCode(502, new { message = ex.Message });
        }
        catch (Exception ex) when (ex.GetType().Name.Contains("ClosedXML") || ex is IOException or InvalidDataException)
        {
            return BadRequest(new { message = $"Could not read that file - make sure it's a valid .xlsx export. ({ex.Message})" });
        }
    }

    /// <summary>The grid's own Edit button (2026-09-21: "...and this below grid...edit button").
    /// Part No/Location/Report Date/upload metadata are not editable - see PartUploadUpdateRequest's
    /// doc comment.
    ///
    /// 2026-09-29 (SECTION 161): explicit [Authorize] added - see Import's own note above for why
    /// (class-level gate removed, access unchanged by the 2026-10-03 Get()-only widening above).</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.PartsUserUp)]
    public async Task<IActionResult> Update(Guid id, [FromBody] PartUploadUpdateRequest request)
    {
        if (_currentUser.DealerId is not { } dealerId)
            return BadRequest(new { message = "Your login isn't linked to a dealer - Part Upload is scoped per dealer." });

        var update = new PartUploadUpdate(
            request.Description, request.BalQty, request.BalAmnt, request.BillPrice,
            request.QtyReqd, request.MinOrder, request.HsnSacCode, request.GroupName, request.ItemType);
        var row = await _partUploads.UpdateAsync(id, dealerId, update, HttpContext.RequestAborted);
        return row is null ? NotFound(new { message = "That row no longer exists." }) : Ok(row);
    }

    /// <summary>2026-09-29 (SECTION 161): explicit [Authorize] added - see Import's own note above
    /// for why (class-level gate removed, access unchanged by the 2026-10-03 Get()-only widening
    /// above).</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.PartsUserUp)]
    public async Task<IActionResult> Delete(Guid id)
    {
        if (_currentUser.DealerId is not { } dealerId)
            return BadRequest(new { message = "Your login isn't linked to a dealer - Part Upload is scoped per dealer." });

        var deleted = await _partUploads.DeleteAsync(id, dealerId, HttpContext.RequestAborted);
        return deleted ? NoContent() : NotFound(new { message = "That row no longer exists." });
    }
}
