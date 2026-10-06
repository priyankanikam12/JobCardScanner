using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-06 ("when SystemAdmin and CorporateAdmin open Vehicle Sale it needs to show all the data but it does not load"):
/// a PAGED, server-searched replacement for the Vehicle Sale page's old "download every sale bill, filter in the browser" call
/// (GET /api/dms-bapl-data/vehicle-sales - left exactly as it was for any other caller, e.g. the Android screen).
///
/// WHY: with no filter that call returns the WHOLE DMS_SaleBill (tens of thousands of rows x ~65 fields) in one response - the
/// 30-second SQL command timeout, the response size and the per-row Reg No lookups all grow with it, which is what stopped the
/// page loading for the two roles that see every dealer. This returns ONE page, and resolves Reg Nos only for that page.
///
/// WHO SEES WHAT: CorporateAdmin / SystemAdmin see every dealer's sales. Every other role sees only its OWN dealer's sales (matched on
/// the dealer's BAPL DMS dealer code - the same dealer_code scoping the Job Card wizard's vehicle lookup already uses); a login with no
/// dealer or no DMS dealer code gets a plain 403 message instead of someone else's data.
///
/// GET /api/vehicle-sales?search=&amp;page=1&amp;pageSize=10  ->  { total, page, pageSize, rows }   (pageSize 1..5000; the page's Excel/PDF
/// export asks for up to 5000).
/// </summary>
[ApiController]
[Route("api/vehicle-sales")]
[Authorize(Policy = Policies.Staff)]
public class VehicleSalesController : ControllerBase
{
    private readonly IDmsBaplDataService _vehicleSales;
    private readonly ICurrentUserService _currentUser;
    private readonly JobCardScannerDbContext _db;
    private readonly ILogger<VehicleSalesController> _logger;

    public VehicleSalesController(IDmsBaplDataService vehicleSales, ICurrentUserService currentUser, JobCardScannerDbContext db, ILogger<VehicleSalesController> logger)
    {
        _vehicleSales = vehicleSales;
        _currentUser = currentUser;
        _db = db;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        var orgWide = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        string? dealerCode = null; // null = every dealer
        if (!orgWide)
        {
            var dealerId = _currentUser.DealerId;
            if (dealerId is null)
                return StatusCode(403, new { message = "This login is not linked to a dealer, so it has no vehicle sales of its own." });
            dealerCode = await _db.Dealers.AsNoTracking().Where(d => d.Id == dealerId).Select(d => d.BaplDmsDealerCode).FirstOrDefaultAsync(HttpContext.RequestAborted);
            if (string.IsNullOrWhiteSpace(dealerCode))
                return StatusCode(403, new { message = "Your dealer has no BAPL DMS dealer code set, so its vehicle sales cannot be matched." });
        }

        try
        {
            var (rows, total) = await _vehicleSales.GetVehicleSalesPageAsync(search, dealerCode, page, pageSize, HttpContext.RequestAborted);
            return Ok(new { total, page = Math.Max(1, page), pageSize, rows });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Vehicle sale page failed (search: {Search}, page {Page}).", search, page);
            return StatusCode(502, new { message = ex.Message });
        }
    }
}