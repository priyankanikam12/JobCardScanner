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
/// JobCardScannerDb rather than DMS/DMSBAPLDATA. Gated to PartsUserUp, matching the existing
/// Parts &amp; Inventory page's own policy (PartsController's GET /api/parts) - a role that
/// already sees the Parts &amp; Inventory nav entry can also see and use this one.
/// </summary>
[ApiController]
[Route("api/part-uploads")]
[Authorize(Policy = Policies.PartsUserUp)]
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
    /// part-upload"): overrides the class-level PartsUserUp gate with PartsReadUp - a plain
    /// ServiceAdvisor can open Repair Bill/Material Transfer (ServiceAdvisorUp) and needs to read
    /// this list for the Item Code picker's merge-in, but was never granted PartsUserUp, so this
    /// GET was 403-ing for that role and the picker silently showed zero uploaded-stock rows. See
    /// Policies.PartsReadUp's doc comment.</summary>
    [HttpGet]
    [Authorize(Policy = Policies.PartsReadUp)]
    public async Task<IActionResult> Get([FromQuery] string? search, [FromQuery] string? locationCode)
    {
        if (_currentUser.DealerId is not { } dealerId)
            return BadRequest(new { message = "Your login isn't linked to a dealer - Part Upload is scoped per dealer." });

        try
        {
            return Ok(await _partUploads.GetAsync(dealerId, locationCode, search, HttpContext.RequestAborted));
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
    /// Master's own required Effective Date convention (LabourMasterController.Import).</summary>
    [HttpPost("import")]
    [RequestSizeLimit(50_000_000)]
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
    /// doc comment.</summary>
    [HttpPut("{id:guid}")]
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

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        if (_currentUser.DealerId is not { } dealerId)
            return BadRequest(new { message = "Your login isn't linked to a dealer - Part Upload is scoped per dealer." });

        var deleted = await _partUploads.DeleteAsync(id, dealerId, HttpContext.RequestAborted);
        return deleted ? NoContent() : NotFound(new { message = "That row no longer exists." });
    }
}
