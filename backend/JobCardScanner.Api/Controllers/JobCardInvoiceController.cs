using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// GET /api/jobcards/{id}/billed-bill - the Billed ("saved as Invoice") Repair Bill of ONE job card, for the Job Card page's Print -> Invoice option (2026-10-07,
/// "why in Print button Invoice not download for all role?").
///
/// WHY THIS EXISTS: Print -> Invoice used to read GET /api/repair-bill-docs?jobCardId=..., i.e. the whole Repair Bill module's list endpoint. That module is gated by role
/// (a role without Repair Bill access - e.g. a Supervisor after the SECTION 162 lock, or a Technician / Parts / Cashier login - gets HTTP 403), so the invoice could not be
/// printed from a job card the same user could open. This endpoint is gated by Policies.Staff only (any signed-in staff role) and is scoped by the JOB CARD instead: you can
/// print the invoice of a job card you are allowed to see - same dealer, same Work Area location - and nothing else. It is read-only, returns only the one Billed bill, and
/// does not open the Repair Bill list / create / edit screens to anyone.
///
/// Scoping: CorporateAdmin / SystemAdmin any job card; every other role only its own dealer's, and - when the login has a Work Area (WorkLocationCodes) - only a job card at one of
/// its locations. A job card outside that scope answers 404, same as JobCardsController.Get (it does not reveal that the job card exists). 404 also means "no Billed bill yet".
/// The response has the same shape as RepairBillDocsController's rows, so the existing invoice print builder takes it unchanged.
/// </summary>
[ApiController]
[Route("api/jobcards")]
[Authorize(Policy = Policies.Staff)]
public class JobCardInvoiceController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;

    public JobCardInvoiceController(JobCardScannerDbContext db, ICurrentUserService currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    [HttpGet("{id:guid}/billed-bill")]
    public async Task<IActionResult> BilledBill(Guid id, CancellationToken ct)
    {
        var jc = await _db.JobCards.AsNoTracking().Where(j => j.Id == id)
            .Select(j => new { j.DealerId, j.BaplServiceLocationCode })
            .FirstOrDefaultAsync(ct);
        if (jc is null) return NotFound(new { message = "That job card no longer exists." });

        var isOrgWide = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        if (!isOrgWide)
        {
            if (_currentUser.DealerId is null || jc.DealerId != _currentUser.DealerId)
                return NotFound(new { message = "That job card no longer exists." });

            var allowed = _currentUser.WorkLocationCodes;
            if (allowed.Count > 0 && (jc.BaplServiceLocationCode is null || !allowed.Contains(jc.BaplServiceLocationCode, StringComparer.OrdinalIgnoreCase)))
                return NotFound(new { message = "That job card no longer exists." });
        }

        var bill = await _db.RepairBillDocs.AsNoTracking()
            .Include(r => r.Items).Include(r => r.JobCard)
            .Where(r => !r.IsDeleted && r.JobCardId == id && r.Status == RepairBillDocStatus.Billed)
            .OrderByDescending(r => r.CreatedAt)
            .FirstOrDefaultAsync(ct);
        if (bill is null) return NotFound(new { message = "No Repair Bill has been saved as Invoice for this job card yet." });

        return Ok(ToRow(bill));
    }

    /// <summary>Same projection as RepairBillDocsController.ToRow - kept identical so the invoice print builder reads it unchanged.</summary>
    private static object ToRow(RepairBillDoc b) => new
    {
        Source = "JobCardScanner",
        b.Id,
        b.BillNumber,
        BillDate = b.BillDate,
        b.JobCardId,
        JobCardNumber = b.JobCard?.JobCardNumber,
        b.PartyName,
        b.RegNo,
        b.ChassisNo,
        b.Location,
        b.BillType,
        b.IssueType,
        Status = b.Status.ToString(),
        b.Remarks,
        b.InsuranceCompanyName,
        b.InsuranceDescription,
        b.SurveyorName,
        b.SurveyorContactNumber,
        b.PolicyNo,
        b.InsuranceValidTill,
        b.ZeroDepreciation,
        b.TotalDiscount,
        b.AmountReceived,
        b.TaxableAmount,
        b.CgstAmount,
        b.SgstAmount,
        b.IgstAmount,
        b.TotalAmount,
        ItemCount = b.Items.Count,
        Items = b.Items.Select(i => new
        {
            i.Id,
            ItemType = i.ItemType.ToString(),
            i.ItemCode,
            i.ItemDescription,
            i.HsnCode,
            i.IssueType,
            i.Qty,
            i.Rate,
            i.DiscountType,
            i.DiscountValue,
            i.CgstPct,
            i.SgstPct,
            i.IgstPct,
            i.TaxableAmount,
            i.CgstAmount,
            i.SgstAmount,
            i.IgstAmount,
            i.TotalAmount,
            i.ExtendedBatteryWarrantySchemeId,
            i.IsUnderExtendedWarranty,
        }),
    };
}