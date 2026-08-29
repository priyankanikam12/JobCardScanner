using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>Global search across job cards/customers/vehicles, and Excel-exportable reports.</summary>
[ApiController]
[Route("api")]
[Authorize(Policy = Policies.Staff)]
public class ReportsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IExcelExportService _excel;

    public ReportsController(JobCardScannerDbContext db, ICurrentUserService currentUser, IExcelExportService excel)
    {
        _db = db;
        _currentUser = currentUser;
        _excel = excel;
    }

    [HttpGet("search")]
    public async Task<IActionResult> GlobalSearch([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 2) return Ok(new { jobCards = Array.Empty<object>(), customers = Array.Empty<object>(), invoices = Array.Empty<object>() });

        var isCorporate = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

        var jcQuery = _db.JobCards.AsNoTracking().Include(j => j.Customer).Include(j => j.Vehicle)
            .Where(j => j.JobCardNumber.Contains(q) || j.Customer!.Name.Contains(q) || (j.Vehicle!.RegNo != null && j.Vehicle.RegNo.Contains(q)));
        if (!isCorporate) jcQuery = jcQuery.Where(j => j.DealerId == _currentUser.DealerId);
        var jobCards = await jcQuery.Take(15).Select(j => new { j.Id, j.JobCardNumber, Status = j.Status.ToString(), CustomerName = j.Customer!.Name, VehicleRegNo = j.Vehicle!.RegNo }).ToListAsync();

        var custQuery = _db.Customers.AsNoTracking().Where(c => c.Name.Contains(q) || c.Mobile.Contains(q));
        if (!isCorporate) custQuery = custQuery.Where(c => c.DealerId == _currentUser.DealerId);
        var customers = await custQuery.Take(15).Select(c => new { c.Id, c.Name, c.Mobile }).ToListAsync();

        var invQuery = _db.Invoices.AsNoTracking().Where(i => i.InvoiceNumber.Contains(q));
        if (!isCorporate) invQuery = invQuery.Where(i => i.DealerId == _currentUser.DealerId);
        var invoices = await invQuery.Take(15).Select(i => new { i.Id, i.InvoiceNumber, i.TotalAmount, Status = i.Status.ToString() }).ToListAsync();

        return Ok(new { jobCards, customers, invoices });
    }

    [HttpGet("reports/jobcards/export")]
    public async Task<IActionResult> ExportJobCards([FromQuery] Guid? dealerId, [FromQuery] JobCardStatus? status)
    {
        var isCorporate = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var effectiveDealerId = dealerId ?? (isCorporate ? null : _currentUser.DealerId);

        var query = _db.JobCards.AsNoTracking().Include(j => j.Customer).Include(j => j.Vehicle).Include(j => j.CurrentStage).AsQueryable();
        if (effectiveDealerId.HasValue) query = query.Where(j => j.DealerId == effectiveDealerId);
        if (status.HasValue) query = query.Where(j => j.Status == status);

        var rows = await query.OrderByDescending(j => j.CreatedAt).Take(5000).ToListAsync();
        var headers = new[] { "Job Card No", "Status", "Stage", "Customer", "Mobile", "Vehicle", "Reg No", "Created", "Expected Delivery" };
        var data = rows.Select(j => (IReadOnlyList<object?>)new object?[]
        {
            j.JobCardNumber, j.Status.ToString(), j.CurrentStage?.Label, j.Customer?.Name, j.Customer?.Mobile,
            j.Vehicle?.Model, j.Vehicle?.RegNo, j.CreatedAt, j.ExpectedDeliveryAt,
        }).ToList();

        var bytes = _excel.Export("Job Cards", headers, data);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "jobcards-report.xlsx");
    }

    [HttpGet("reports/invoices/export")]
    [Authorize(Policy = Policies.CashierUp)]
    public async Task<IActionResult> ExportInvoices([FromQuery] Guid? dealerId)
    {
        var isCorporate = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var effectiveDealerId = dealerId ?? (isCorporate ? null : _currentUser.DealerId);

        var query = _db.Invoices.AsNoTracking().Include(i => i.Customer).AsQueryable();
        if (effectiveDealerId.HasValue) query = query.Where(i => i.DealerId == effectiveDealerId);

        var rows = await query.OrderByDescending(i => i.CreatedAt).Take(5000).ToListAsync();
        var headers = new[] { "Invoice No", "Customer", "Labour", "Parts", "Discount", "Tax", "Total", "Status", "Payment Mode", "Generated At" };
        var data = rows.Select(i => (IReadOnlyList<object?>)new object?[]
        {
            i.InvoiceNumber, i.Customer?.Name, i.LabourAmount, i.PartsAmount, i.DiscountAmount,
            i.CgstAmount + i.SgstAmount + i.IgstAmount, i.TotalAmount, i.Status.ToString(), i.PaymentMode.ToString(), i.GeneratedAt,
        }).ToList();

        var bytes = _excel.Export("Invoices", headers, data);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "invoices-report.xlsx");
    }
}
