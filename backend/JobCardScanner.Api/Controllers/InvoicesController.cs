using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using JobCardScanner.Api.Services.Integrations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

[ApiController]
[Route("api")]
public class InvoicesController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IJobCardNumberingService _numbering;
    private readonly IInvoicePdfService _pdf;
    private readonly IErpClient _erp;
    private readonly INotificationClient _notifications;
    private readonly IAuditLogService _audit;

    public InvoicesController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IJobCardNumberingService numbering,
        IInvoicePdfService pdf, IErpClient erp, INotificationClient notifications, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _numbering = numbering;
        _pdf = pdf;
        _erp = erp;
        _notifications = notifications;
        _audit = audit;
    }

    [HttpPost("jobcards/{jobCardId:guid}/invoice")]
    [Authorize(Policy = Policies.CashierUp)]
    public async Task<IActionResult> Generate(Guid jobCardId, GenerateInvoiceRequest req)
    {
        var jc = await _db.JobCards.Include(j => j.Parts).Include(j => j.Worklogs).Include(j => j.Customer)
            .FirstOrDefaultAsync(j => j.Id == jobCardId);
        if (jc is null) return NotFound();
        if (await _db.Invoices.AnyAsync(i => i.JobCardId == jobCardId))
            return Conflict(new { message = "An invoice already exists for this job card." });

        var partsAmount = jc.Parts.Where(p => p.Status == JobCardPartStatus.Issued).Sum(p => p.Amount);
        // Labour: a flat estimate derived from logged technician minutes (prototype rate: Rs.10/min), or a base charge.
        var labourMinutes = jc.Worklogs.Where(w => w.DurationMinutes.HasValue).Sum(w => w.DurationMinutes!.Value);
        var labourAmount = labourMinutes > 0 ? labourMinutes * 10m : 300m;

        var subtotal = partsAmount + labourAmount - req.DiscountAmount;
        var total = subtotal + req.CgstAmount + req.SgstAmount + req.IgstAmount;

        var invoice = new Invoice
        {
            JobCardId = jc.Id,
            InvoiceNumber = await _numbering.NextInvoiceNumberAsync(jc.DealerId),
            DealerId = jc.DealerId,
            CustomerId = jc.CustomerId,
            LabourAmount = labourAmount,
            PartsAmount = partsAmount,
            DiscountAmount = req.DiscountAmount,
            CgstAmount = req.CgstAmount,
            SgstAmount = req.SgstAmount,
            IgstAmount = req.IgstAmount,
            TotalAmount = total,
            Status = InvoiceStatus.Generated,
            GeneratedById = _currentUser.UserId,
            GeneratedAt = DateTime.UtcNow,
        };
        _db.Invoices.Add(invoice);
        jc.Status = JobCardStatus.PendingClosure;
        await _db.SaveChangesAsync();

        await _erp.PushInvoiceAsync(invoice);
        await _audit.LogAsync("Invoice.Generate", "Invoice", invoice.Id.ToString(), new { invoice.InvoiceNumber, invoice.TotalAmount });

        if (jc.Customer is not null)
            await _notifications.SendAsync(NotificationChannel.Sms, jc.Customer.Mobile,
                $"Invoice {invoice.InvoiceNumber} of Rs.{invoice.TotalAmount:N2} generated for job card {jc.JobCardNumber}. Download from your tracking portal.",
                templateKey: "InvoiceGenerated", jobCardId: jc.Id, customerId: jc.CustomerId);

        return Ok(invoice);
    }

    [HttpPost("invoices/{id:guid}/payment")]
    [Authorize(Policy = Policies.CashierUp)]
    public async Task<IActionResult> RecordPayment(Guid id, RecordPaymentRequest req)
    {
        var invoice = await _db.Invoices.FirstOrDefaultAsync(i => i.Id == id);
        if (invoice is null) return NotFound();
        invoice.PaymentMode = req.PaymentMode;
        invoice.PaymentReference = req.PaymentReference;
        invoice.Status = InvoiceStatus.Paid;
        invoice.PaidAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Invoice.Payment", "Invoice", invoice.Id.ToString(), req);
        return Ok(invoice);
    }

    [HttpGet("invoices/{id:guid}")]
    [Authorize(AuthenticationSchemes = AuthSchemes.AzureAd + "," + AuthSchemes.CustomerPortal)]
    public async Task<IActionResult> Get(Guid id)
    {
        var invoice = await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id);
        return invoice is null ? NotFound() : Ok(invoice);
    }

    [HttpGet("invoices/{id:guid}/pdf")]
    [Authorize(AuthenticationSchemes = AuthSchemes.AzureAd + "," + AuthSchemes.CustomerPortal)]
    public async Task<IActionResult> DownloadPdf(Guid id)
    {
        var invoice = await _db.Invoices.AsNoTracking()
            .Include(i => i.Dealer).Include(i => i.Customer)
            .FirstOrDefaultAsync(i => i.Id == id);
        if (invoice is null) return NotFound();

        var jc = await _db.JobCards.AsNoTracking().Include(j => j.Vehicle).FirstOrDefaultAsync(j => j.Id == invoice.JobCardId);
        if (jc is null) return NotFound();

        // Authorize: either staff of the invoicing dealer, or the customer this invoice belongs to.
        if (_currentUser.IsCustomer && _currentUser.CustomerId != invoice.CustomerId) return Forbid();
        if (!_currentUser.IsCustomer && !_currentUser.IsStaff) return Forbid();

        var parts = await _db.JobCardParts.AsNoTracking().Include(p => p.Part)
            .Where(p => p.JobCardId == jc.Id && p.Status == JobCardPartStatus.Issued).ToListAsync();

        var bytes = _pdf.Generate(invoice, jc, parts);
        return File(bytes, "application/pdf", $"{invoice.InvoiceNumber}.pdf");
    }
}
