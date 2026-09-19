using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// "Labour Master" sidebar page (2026-09-19: "i want create 1 sidebar option also in that
/// Labour Master after Service History ... i want 1. Partwise 2. Without partwise ... in that
/// edit delete export in excel format ... and create table query in DMSBAPLDATA database").
/// Unlike every sibling DMSBAPLDATA controller (DmsBaplDataController etc.), this one WRITES to
/// DMSBAPLDATA - see the architecture note at the top of Services/LabourMasterImportService.cs
/// for why that's possible and what it does/doesn't change about the rest of that database.
///
/// Gated to WorkshopManagerUp for every action including plain reads - labour rates are pricing
/// data (confidential per org policy), and the NAV_ITEMS sidebar entry for this page is gated to
/// the same role floor, so a ServiceAdvisor/Technician/PartsUser/Cashier login never even sees
/// the link. Not specified in your request - flagging this as a deliberate default, tell me if
/// a wider (or narrower) audience should see this page.
/// </summary>
[ApiController]
[Route("api/labour-master")]
[Authorize(Policy = Policies.WorkshopManagerUp)]
public class LabourMasterController : ControllerBase
{
    private readonly ILabourMasterImportService _labourMaster;
    private readonly ILogger<LabourMasterController> _logger;
    private readonly ICurrentUserService _currentUser;

    public LabourMasterController(ILabourMasterImportService labourMaster, ILogger<LabourMasterController> logger, ICurrentUserService currentUser)
    {
        _labourMaster = labourMaster;
        _logger = logger;
        _currentUser = currentUser;
    }

    // ---------------- Without Partwise ----------------

    [HttpGet("without-partwise")]
    public async Task<IActionResult> GetWithoutPartwise([FromQuery] string? search)
    {
        try
        {
            return Ok(await _labourMaster.GetWithoutPartwiseAsync(search, HttpContext.RequestAborted));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "GetWithoutPartwise failed");
            return StatusCode(502, new { message = ex.Message });
        }
    }

    [HttpPost("without-partwise/import")]
    [RequestSizeLimit(50_000_000)]
    public async Task<IActionResult> ImportWithoutPartwise([FromForm] LabourMasterImportForm form)
    {
        if (form.File is null || form.File.Length == 0)
            return BadRequest(new { message = "An Excel file is required." });
        if (form.EffectiveDate == default)
            return BadRequest(new { message = "Effective Date is required." });

        try
        {
            await using var stream = form.File.OpenReadStream();
            var result = await _labourMaster.ImportWithoutPartwiseAsync(stream, DateOnly.FromDateTime(form.EffectiveDate), _currentUser.UserName, HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "ImportWithoutPartwise failed");
            return StatusCode(502, new { message = ex.Message });
        }
        catch (Exception ex) when (ex.GetType().Name.Contains("ClosedXML") || ex is IOException or InvalidDataException)
        {
            return BadRequest(new { message = $"Could not read that file - make sure it's a valid .xlsx export. ({ex.Message})" });
        }
    }

    [HttpPut("without-partwise/{id:int}")]
    public async Task<IActionResult> UpdateWithoutPartwise(int id, [FromBody] LabourMasterWithoutPartwiseUpdateRequest req)
    {
        try
        {
            var update = new LabourMasterWithoutPartwiseUpdate(
                req.JobDescription, req.Model, req.LabourRate, req.Igst, req.Cgst, req.Sgst,
                req.Tier, req.Category, req.EffectiveDate.HasValue ? DateOnly.FromDateTime(req.EffectiveDate.Value) : null, req.IsActive);
            var row = await _labourMaster.UpdateWithoutPartwiseAsync(id, update, _currentUser.UserName, HttpContext.RequestAborted);
            return row is null ? NotFound(new { message = "That row no longer exists." }) : Ok(row);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "UpdateWithoutPartwise failed");
            return StatusCode(502, new { message = ex.Message });
        }
    }

    [HttpDelete("without-partwise/{id:int}")]
    public async Task<IActionResult> DeleteWithoutPartwise(int id)
    {
        try
        {
            var deleted = await _labourMaster.DeleteWithoutPartwiseAsync(id, HttpContext.RequestAborted);
            return deleted ? NoContent() : NotFound(new { message = "That row no longer exists." });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "DeleteWithoutPartwise failed");
            return StatusCode(502, new { message = ex.Message });
        }
    }

    // ---------------- Partwise ----------------

    [HttpGet("partwise")]
    public async Task<IActionResult> GetPartwise([FromQuery] string? search)
    {
        try
        {
            return Ok(await _labourMaster.GetPartwiseAsync(search, HttpContext.RequestAborted));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "GetPartwise failed");
            return StatusCode(502, new { message = ex.Message });
        }
    }

    [HttpPost("partwise/import")]
    [RequestSizeLimit(50_000_000)]
    public async Task<IActionResult> ImportPartwise([FromForm] LabourMasterImportForm form)
    {
        if (form.File is null || form.File.Length == 0)
            return BadRequest(new { message = "An Excel file is required." });
        if (form.EffectiveDate == default)
            return BadRequest(new { message = "Effective Date is required." });

        try
        {
            await using var stream = form.File.OpenReadStream();
            var result = await _labourMaster.ImportPartwiseAsync(stream, DateOnly.FromDateTime(form.EffectiveDate), _currentUser.UserName, HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "ImportPartwise failed");
            return StatusCode(502, new { message = ex.Message });
        }
        catch (Exception ex) when (ex.GetType().Name.Contains("ClosedXML") || ex is IOException or InvalidDataException)
        {
            return BadRequest(new { message = $"Could not read that file - make sure it's a valid .xlsx export. ({ex.Message})" });
        }
    }

    [HttpPut("partwise/{id:int}")]
    public async Task<IActionResult> UpdatePartwise(int id, [FromBody] LabourMasterPartwiseUpdateRequest req)
    {
        try
        {
            var update = new LabourMasterPartwiseUpdate(
                req.PartName, req.JobDescription, req.Model, req.LabourRate, req.Igst, req.Cgst, req.Sgst,
                req.Tier, req.Category, req.EffectiveDate.HasValue ? DateOnly.FromDateTime(req.EffectiveDate.Value) : null, req.IsActive);
            var row = await _labourMaster.UpdatePartwiseAsync(id, update, _currentUser.UserName, HttpContext.RequestAborted);
            return row is null ? NotFound(new { message = "That row no longer exists." }) : Ok(row);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "UpdatePartwise failed");
            return StatusCode(502, new { message = ex.Message });
        }
    }

    [HttpDelete("partwise/{id:int}")]
    public async Task<IActionResult> DeletePartwise(int id)
    {
        try
        {
            var deleted = await _labourMaster.DeletePartwiseAsync(id, HttpContext.RequestAborted);
            return deleted ? NoContent() : NotFound(new { message = "That row no longer exists." });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "DeletePartwise failed");
            return StatusCode(502, new { message = ex.Message });
        }
    }
}
