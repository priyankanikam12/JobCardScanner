using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace JobCardScanner.Api.Services;

/// <summary>Builds the customer-facing invoice PDF with QuestPDF (Community license, see Program.cs).</summary>
public class InvoicePdfService : IInvoicePdfService
{
    private readonly JobCardScannerDbContext _db;
    private readonly IBaplDmsService _baplDms;
    private readonly ILogger<InvoicePdfService> _logger;

    public InvoicePdfService(JobCardScannerDbContext db, IBaplDmsService baplDms, ILogger<InvoicePdfService> logger)
    {
        _db = db;
        _baplDms = baplDms;
        _logger = logger;
    }

    public byte[] Generate(Invoice invoice, JobCard jobCard, IReadOnlyList<JobCardPart> parts)
    {
        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(10));

                page.Header().Column(col =>
                {
                    col.Item().Text(invoice.Dealer?.Name ?? "Dealer").FontSize(16).Bold();
                    col.Item().Text(invoice.Dealer?.Address ?? "");
                    if (!string.IsNullOrWhiteSpace(invoice.Dealer?.Gstin))
                        col.Item().Text($"GSTIN: {invoice.Dealer.Gstin}");
                    col.Item().PaddingTop(8).LineHorizontal(1);
                    col.Item().PaddingTop(4).Row(row =>
                    {
                        row.RelativeItem().Text($"Invoice No: {invoice.InvoiceNumber}").Bold();
                        row.RelativeItem().AlignRight().Text($"Date: {invoice.GeneratedAt ?? invoice.CreatedAt:dd-MMM-yyyy}");
                    });
                    col.Item().Text($"Job Card No: {jobCard.JobCardNumber}");
                });

                page.Content().PaddingTop(15).Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Bill To").Bold();
                            c.Item().Text(invoice.Customer?.Name ?? "");
                            c.Item().Text(invoice.Customer?.Mobile ?? "");
                            c.Item().Text(invoice.Customer?.Address ?? "");
                        });
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Vehicle").Bold();
                            c.Item().Text($"{jobCard.Vehicle?.Model} {jobCard.Vehicle?.Variant}");
                            c.Item().Text($"Reg No: {jobCard.Vehicle?.RegNo}");
                            c.Item().Text($"Odometer: {jobCard.OdometerAtCheckIn} km");
                        });
                    });

                    col.Item().PaddingTop(15).Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn(4);
                            c.RelativeColumn(1);
                            c.RelativeColumn(2);
                            c.RelativeColumn(2);
                        });

                        table.Header(h =>
                        {
                            h.Cell().Text("Description").Bold();
                            h.Cell().Text("Qty").Bold();
                            h.Cell().AlignRight().Text("Unit Price").Bold();
                            h.Cell().AlignRight().Text("Amount").Bold();
                            h.Cell().ColumnSpan(4).PaddingTop(3).BorderBottom(1);
                        });

                        table.Cell().Text("Labour Charges");
                        table.Cell().Text("1");
                        table.Cell().AlignRight().Text(invoice.LabourAmount.ToString("N2"));
                        table.Cell().AlignRight().Text(invoice.LabourAmount.ToString("N2"));

                        foreach (var p in parts)
                        {
                            table.Cell().Text(p.Part?.Name ?? "Part");
                            table.Cell().Text(p.Quantity.ToString("0.##"));
                            table.Cell().AlignRight().Text(p.UnitPrice.ToString("N2"));
                            table.Cell().AlignRight().Text(p.Amount.ToString("N2"));
                        }
                    });

                    col.Item().PaddingTop(15).AlignRight().Column(c =>
                    {
                        void Line(string label, decimal amount) =>
                            c.Item().Row(r =>
                            {
                                r.RelativeItem().AlignRight().Text(label);
                                r.ConstantItem(90).AlignRight().Text(amount.ToString("N2"));
                            });

                        Line("Labour", invoice.LabourAmount);
                        Line("Parts", invoice.PartsAmount);
                        if (invoice.DiscountAmount > 0) Line("Discount", -invoice.DiscountAmount);
                        if (invoice.CgstAmount > 0) Line("CGST", invoice.CgstAmount);
                        if (invoice.SgstAmount > 0) Line("SGST", invoice.SgstAmount);
                        if (invoice.IgstAmount > 0) Line("IGST", invoice.IgstAmount);
                        c.Item().PaddingTop(4).LineHorizontal(1);
                        c.Item().Row(r =>
                        {
                            r.RelativeItem().AlignRight().Text("Total").Bold();
                            r.ConstantItem(90).AlignRight().Text(invoice.TotalAmount.ToString("N2")).Bold();
                        });
                        c.Item().Text($"Payment Mode: {invoice.PaymentMode}");
                        c.Item().Text($"Status: {invoice.Status}");
                    });
                });

                page.Footer().AlignCenter().Text("Generated by JobCardScanner - thank you for servicing with us.").FontSize(8).Italic();
            });
        });

        return doc.GeneratePdf();
    }

    // =====================================================================================
    // "Download Invoice from DMS" - renders DMS's own repair bill as a PDF matching BAPL
    // DMS's own GST tax invoice layout. See IInvoicePdfService.BuildInvoicePdfAsync's doc comment.
    // =====================================================================================

    /// <summary>One rendered line-item row - built from one BaplDmsRepairBillDetailRow, resolved to
    /// either its Part* or Labour* columns (see <see cref="ClassifyLine"/>). Code/Description/Hsn
    /// have NO confirmed source in DMS's schema (no part/labour master table with those columns
    /// was ever confirmed against a live SELECT * - see BaplDmsRepairBillDetailRow's doc comment),
    /// so per this project's discipline they're best-effort labels/placeholders, never a guessed
    /// table join.</summary>
    private sealed record LineItem(
        string Code, string Description, string Hsn, decimal Qty, decimal Rate,
        decimal Discount, decimal Taxable, decimal Igst, decimal Cgst, decimal Sgst, decimal NetAmount, bool IsPart);

    public async Task<byte[]?> BuildInvoicePdfAsync(Guid jobCardId, CancellationToken ct = default)
    {
        var jobCard = await _db.JobCards.AsNoTracking()
            .Include(j => j.Customer).Include(j => j.Vehicle).Include(j => j.Dealer)
            .Include(j => j.AssignedTechnician)
            .FirstOrDefaultAsync(j => j.Id == jobCardId, ct);
        if (jobCard is null) return null;
        if (!jobCard.BaplJobCardHeaderId.HasValue) return null; // never synced to DMS - nothing to invoice

        BaplDmsRepairBillHeaderDetail? header;
        try
        {
            header = await _baplDms.GetRepairBillHeaderDetailAsync(jobCard.BaplJobCardHeaderId.Value, ct);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMS repair bill header for job card {JobCardId} (BAPL job {BaplJobId})", jobCardId, jobCard.BaplJobCardHeaderId);
            throw; // real DMS problem - let the controller surface it distinctly from "no bill yet"
        }
        if (header is null) return null; // no repair bill raised for this job yet - normal, not an error

        IReadOnlyList<BaplDmsRepairBillDetailRow> lines;
        try
        {
            lines = await _baplDms.GetRepairBillDetailLinesAsync(header.Id, ct);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMS repair bill lines for bill {RepairBillId}", header.Id);
            throw;
        }

        BaplDmsCustomerLedgerDetail? ledger = null;
        if (header.CustomerLedgerId.HasValue)
        {
            try { ledger = await _baplDms.GetCustomerLedgerDetailAsync(header.CustomerLedgerId.Value, ct); }
            catch (InvalidOperationException ex)
            {
                // Never fatal - the invoice still renders using the local Customer as a fallback.
                _logger.LogInformation(ex, "DMS customer ledger lookup skipped for invoice (ledger {LedgerId})", header.CustomerLedgerId);
            }
        }

        var items = lines.Select(ClassifyLine).ToList();
        var partTotal = items.Where(i => i.IsPart).Sum(i => i.NetAmount);
        var labourTotal = items.Where(i => !i.IsPart).Sum(i => i.NetAmount);
        var invoiceTotal = header.TotalNetAmount ?? (partTotal + labourTotal);

        var hsnGroups = items
            .GroupBy(i => string.IsNullOrWhiteSpace(i.Hsn) ? "-" : i.Hsn)
            .Select(g => new
            {
                Hsn = g.Key,
                Taxable = g.Sum(x => x.Taxable),
                Sgst = g.Sum(x => x.Sgst),
                Cgst = g.Sum(x => x.Cgst),
                Igst = g.Sum(x => x.Igst),
            })
            .OrderBy(g => g.Hsn)
            .ToList();

        var dealer = jobCard.Dealer;
        var customerName = ledger?.Name ?? jobCard.Customer?.Name ?? "-";
        var customerMobile = ledger?.Mobile ?? jobCard.Customer?.Mobile ?? "-";
        var customerAddress = !string.IsNullOrWhiteSpace(ledger?.Address) ? ledger!.Address : jobCard.Customer?.Address;
        var customerCity = !string.IsNullOrWhiteSpace(ledger?.City) ? ledger!.City : jobCard.Customer?.City;
        var customerState = ledger?.State; // no confirmed local fallback either - prints "-" if unknown
        var customerGstin = ledger?.Gstin; // no confirmed source anywhere - prints "-" if unknown

        var invoiceNo = header.BillNo.HasValue ? $"{header.Prefix}{header.BillNo}" : "-";

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(28);
                page.DefaultTextStyle(x => x.FontSize(9));

                page.Header().Column(col =>
                {
                    col.Item().Text(dealer?.Name ?? "-").FontSize(15).Bold();
                    if (!string.IsNullOrWhiteSpace(dealer?.Address)) col.Item().Text(dealer!.Address!);
                    var cityLine = string.Join(", ", new[] { dealer?.City, dealer?.State }
                        .Where(s => !string.IsNullOrWhiteSpace(s)));
                    if (!string.IsNullOrWhiteSpace(cityLine)) col.Item().Text(cityLine!);
                    col.Item().Text($"Phone : {(string.IsNullOrWhiteSpace(dealer?.Phone) ? "-" : dealer!.Phone)}");
                    col.Item().Text($"Email : {(string.IsNullOrWhiteSpace(dealer?.Email) ? "-" : dealer!.Email)}");
                    col.Item().Text($"GSTIN : {(string.IsNullOrWhiteSpace(dealer?.Gstin) ? "" : dealer!.Gstin)}");
                    col.Item().PaddingTop(6).AlignCenter().Text("GST TAX INVOICE").FontSize(13).Bold();
                });

                page.Content().PaddingTop(10).Column(col =>
                {
                    // ---------------- Customer Details panel ----------------
                    var customerRows = new List<(string Label, string Value)>
                    {
                        ("Customer Name", customerName),
                        ("Phone", customerMobile ?? "-"),
                        ("Address", string.IsNullOrWhiteSpace(customerAddress) ? "-" : customerAddress!),
                        ("State", string.IsNullOrWhiteSpace(customerState) ? "-" : customerState!),
                        ("City", string.IsNullOrWhiteSpace(customerCity) ? "-" : customerCity!),
                        ("GSTIN", string.IsNullOrWhiteSpace(customerGstin) ? "-" : customerGstin!),
                    };
                    col.Item().Border(1).Padding(6).Column(c =>
                    {
                        c.Item().Text("Customer Details").Bold();
                        foreach (var (label, value) in customerRows)
                        {
                            var rowLabel = label; var rowValue = value;
                            c.Item().Row(r =>
                            {
                                r.ConstantItem(110).Text(rowLabel).SemiBold();
                                r.RelativeItem().Text(rowValue);
                            });
                        }
                    });

                    // ---------------- Vehicle Details panel ----------------
                    var vehicleRows = new List<(string Label1, string Value1, string Label2, string Value2)>
                    {
                        ("Job No", jobCard.BaplJobNo?.ToString() ?? jobCard.JobCardNumber, "Invoice No", invoiceNo),
                        ("Chassis No", jobCard.Vehicle?.Vin ?? "-", "Registration No", jobCard.Vehicle?.RegNo ?? "-"),
                        ("Motor No", jobCard.Vehicle?.MotorNo ?? "-", "Model", jobCard.Vehicle?.Model ?? "-"),
                        ("Color", jobCard.Vehicle?.Color ?? "-", "Job Type", jobCard.BaplJobType ?? jobCard.ServiceType.ToString()),
                        ("Job Source", jobCard.BaplJobSourceName ?? jobCard.Source.ToString(),
                            "Technician", jobCard.BaplTechnicianName ?? jobCard.AssignedTechnician?.Name ?? jobCard.AssignedTechnicianName ?? "-"),
                    };
                    col.Item().PaddingTop(8).Border(1).Padding(6).Column(c =>
                    {
                        c.Item().Text("Vehicle Details").Bold();
                        foreach (var (label1, value1, label2, value2) in vehicleRows)
                        {
                            var l1 = label1; var v1 = value1; var l2 = label2; var v2 = value2;
                            c.Item().Row(r =>
                            {
                                r.RelativeItem().Row(rr => { rr.ConstantItem(90).Text(l1).SemiBold(); rr.RelativeItem().Text(v1); });
                                r.RelativeItem().Row(rr => { rr.ConstantItem(90).Text(l2).SemiBold(); rr.RelativeItem().Text(v2); });
                            });
                        }
                    });

                    // ---------------- Line items table ----------------
                    col.Item().PaddingTop(10).Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.ConstantColumn(22);  // Sr
                            c.RelativeColumn(2);   // Code
                            c.RelativeColumn(4);   // Description
                            c.RelativeColumn(1.6f);// HSN
                            c.RelativeColumn(1.2f);// Qty
                            c.RelativeColumn(1.6f);// Rate
                            c.RelativeColumn(1.6f);// Discount
                            c.RelativeColumn(1.8f);// Taxable
                            c.RelativeColumn(1.6f);// IGST
                            c.RelativeColumn(1.8f);// Net Amount
                        });

                        table.Header(h =>
                        {
                            h.Cell().Text("Sr").Bold();
                            h.Cell().Text("Code").Bold();
                            h.Cell().Text("Description").Bold();
                            h.Cell().Text("HSN").Bold();
                            h.Cell().AlignRight().Text("Qty").Bold();
                            h.Cell().AlignRight().Text("Rate").Bold();
                            h.Cell().AlignRight().Text("Discount").Bold();
                            h.Cell().AlignRight().Text("Taxable").Bold();
                            h.Cell().AlignRight().Text("IGST").Bold();
                            h.Cell().AlignRight().Text("Net Amount").Bold();
                            h.Cell().ColumnSpan(10).PaddingTop(3).BorderBottom(1);
                        });

                        var sr = 1;
                        foreach (var it in items)
                        {
                            table.Cell().Text(sr.ToString());
                            table.Cell().Text(it.Code);
                            table.Cell().Text(it.Description);
                            table.Cell().Text(it.Hsn);
                            table.Cell().AlignRight().Text(it.Qty.ToString("0.##"));
                            table.Cell().AlignRight().Text(it.Rate.ToString("N2"));
                            table.Cell().AlignRight().Text(it.Discount.ToString("N2"));
                            table.Cell().AlignRight().Text(it.Taxable.ToString("N2"));
                            table.Cell().AlignRight().Text(it.Igst.ToString("N2"));
                            table.Cell().AlignRight().Text(it.NetAmount.ToString("N2"));
                            sr++;
                        }
                    });

                    // ---------------- Amount in words + totals ----------------
                    col.Item().PaddingTop(8).Text($"Amount In Words : {NumberToIndianWords(Math.Round(invoiceTotal, 0))} Rupees Only");

                    col.Item().PaddingTop(4).AlignRight().Column(c =>
                    {
                        void Line(string label, decimal amount, bool bold = false)
                        {
                            c.Item().Row(r =>
                            {
                                r.RelativeItem().AlignRight().Text(t => { var x = t.Span(label); if (bold) x.Bold(); });
                                r.ConstantItem(90).AlignRight().Text(t => { var x = t.Span(amount.ToString("N2")); if (bold) x.Bold(); });
                            });
                        }
                        Line("Part Total", partTotal);
                        Line("Labour Total", labourTotal);
                        c.Item().PaddingTop(2).LineHorizontal(1);
                        Line("Invoice Total", invoiceTotal, bold: true);
                    });

                    // ---------------- HSN Summary panel ----------------
                    col.Item().PaddingTop(12).Border(1).Padding(6).Column(c =>
                    {
                        c.Item().Text("HSN Summary").Bold();
                        c.Item().PaddingTop(4).Table(table =>
                        {
                            table.ColumnsDefinition(cc =>
                            {
                                cc.RelativeColumn(1.4f); // HSN
                                cc.RelativeColumn(1.6f); // Taxable Value
                                cc.RelativeColumn(1.2f); // SGST Rate
                                cc.RelativeColumn(1.4f); // SGST Amt
                                cc.RelativeColumn(1.2f); // CGST Rate
                                cc.RelativeColumn(1.4f); // CGST Amt
                                cc.RelativeColumn(1.2f); // IGST Rate
                                cc.RelativeColumn(1.4f); // IGST Amt
                            });
                            table.Header(h =>
                            {
                                h.Cell().Text("HSN").Bold();
                                h.Cell().AlignRight().Text("Taxable Value").Bold();
                                h.Cell().AlignRight().Text("SGST Rate").Bold();
                                h.Cell().AlignRight().Text("SGST Amt").Bold();
                                h.Cell().AlignRight().Text("CGST Rate").Bold();
                                h.Cell().AlignRight().Text("CGST Amt").Bold();
                                h.Cell().AlignRight().Text("IGST Rate").Bold();
                                h.Cell().AlignRight().Text("IGST Amt").Bold();
                                h.Cell().ColumnSpan(8).PaddingTop(3).BorderBottom(1);
                            });
                            foreach (var g in hsnGroups)
                            {
                                var sgstRate = g.Taxable > 0 ? g.Sgst / g.Taxable * 100m : 0m;
                                var cgstRate = g.Taxable > 0 ? g.Cgst / g.Taxable * 100m : 0m;
                                var igstRate = g.Taxable > 0 ? g.Igst / g.Taxable * 100m : 0m;
                                table.Cell().Text(g.Hsn);
                                table.Cell().AlignRight().Text(g.Taxable.ToString("N2"));
                                table.Cell().AlignRight().Text(sgstRate.ToString("N2"));
                                table.Cell().AlignRight().Text(g.Sgst.ToString("N2"));
                                table.Cell().AlignRight().Text(cgstRate.ToString("N2"));
                                table.Cell().AlignRight().Text(g.Cgst.ToString("N2"));
                                table.Cell().AlignRight().Text(igstRate.ToString("N2"));
                                table.Cell().AlignRight().Text(g.Igst.ToString("N2"));
                            }
                        });
                    });

                    // ---------------- Remarks + signatures ----------------
                    col.Item().PaddingTop(16).Text("Remarks :");
                    col.Item().PaddingTop(18).Height(1); // blank space for handwritten remarks

                    col.Item().PaddingTop(24).Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().PaddingTop(20).LineHorizontal(1);
                            c.Item().AlignCenter().Text("Customer Signature");
                        });
                        row.ConstantItem(30);
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().PaddingTop(20).LineHorizontal(1);
                            c.Item().AlignCenter().Text("Authorized Signatory");
                        });
                    });
                });

                page.Footer().AlignCenter().Text("Generated by JobCardScanner from DMS.").FontSize(7).Italic();
            });
        });

        return doc.GeneratePdf();
    }

    // =====================================================================================
    // 2026-09-07 ("this also show like whole data in our jobcard flow") - the DMS-only job card
    // detail page (BaplJobCardDetailPage.tsx, opened for a "DMS" badge row on /jobcards that
    // JobCardScanner never created locally) previously showed only a handful of plain summary
    // fields. These two methods bring it the same repair-bill breakdown/invoice the native
    // JobCardDetailPage already gets - sourced entirely from DMS's own data
    // (IBaplDmsService.GetJobCardByIdAsync) plus a local Dealer lookup by BaplDmsDealerCode for
    // letterhead details only, since there's no local JobCard/Customer/Vehicle row to read instead.
    // =====================================================================================

    public async Task<BaplDmsInvoiceLineItemsResult?> GetLineItemsAsync(int jobCardHeaderId, CancellationToken ct = default)
    {
        BaplDmsRepairBillHeaderDetail? header;
        try
        {
            header = await _baplDms.GetRepairBillHeaderDetailAsync(jobCardHeaderId, ct);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMS repair bill header for job card header {JobCardHeaderId}", jobCardHeaderId);
            throw;
        }
        if (header is null) return null; // no repair bill raised for this job yet - normal, not an error

        IReadOnlyList<BaplDmsRepairBillDetailRow> lines;
        try
        {
            lines = await _baplDms.GetRepairBillDetailLinesAsync(header.Id, ct);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMS repair bill lines for bill {RepairBillId}", header.Id);
            throw;
        }

        var items = lines.Select(ClassifyLine)
            .Select(i => new BaplDmsInvoiceLineItemDto(i.Code, i.Description, i.Hsn, i.Qty, i.Rate, i.Discount, i.Taxable, i.NetAmount, i.IsPart))
            .ToList();
        var partTotal = items.Where(i => i.IsPart).Sum(i => i.NetAmount);
        var labourTotal = items.Where(i => !i.IsPart).Sum(i => i.NetAmount);
        var invoiceNo = header.BillNo.HasValue ? $"{header.Prefix}{header.BillNo}" : null;
        return new BaplDmsInvoiceLineItemsResult(items, partTotal, labourTotal, header.TotalNetAmount ?? (partTotal + labourTotal), header.RepairBillStatus, invoiceNo);
    }

    public async Task<byte[]?> BuildInvoicePdfFromDmsAsync(int jobCardHeaderId, CancellationToken ct = default)
    {
        var row = await _baplDms.GetJobCardByIdAsync(jobCardHeaderId, ct);
        if (row is null) return null; // no such DMS job card

        BaplDmsRepairBillHeaderDetail? header;
        try
        {
            header = await _baplDms.GetRepairBillHeaderDetailAsync(jobCardHeaderId, ct);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMS repair bill header for job card header {JobCardHeaderId}", jobCardHeaderId);
            throw;
        }
        if (header is null) return null; // no repair bill raised for this job yet - normal, not an error

        IReadOnlyList<BaplDmsRepairBillDetailRow> lines;
        try
        {
            lines = await _baplDms.GetRepairBillDetailLinesAsync(header.Id, ct);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Could not read DMS repair bill lines for bill {RepairBillId}", header.Id);
            throw;
        }

        BaplDmsCustomerLedgerDetail? ledger = null;
        if (header.CustomerLedgerId.HasValue)
        {
            try { ledger = await _baplDms.GetCustomerLedgerDetailAsync(header.CustomerLedgerId.Value, ct); }
            catch (InvalidOperationException ex)
            {
                _logger.LogInformation(ex, "DMS customer ledger lookup skipped for invoice (ledger {LedgerId})", header.CustomerLedgerId);
            }
        }

        // Letterhead only - this DMS job card has no local JobCard/Dealer row of its own, so the
        // dealer's own name/address/GSTIN for the invoice header comes from a plain lookup by
        // BaplDmsDealerCode (same code every other DMS-scoped local lookup uses - see
        // PartsController, BaplDmsController.Workshops), not from anything DMS itself returns.
        var dealer = string.IsNullOrWhiteSpace(row.DealerCode)
            ? null
            : await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.BaplDmsDealerCode == row.DealerCode, ct);

        var items = lines.Select(ClassifyLine).ToList();
        var partTotal = items.Where(i => i.IsPart).Sum(i => i.NetAmount);
        var labourTotal = items.Where(i => !i.IsPart).Sum(i => i.NetAmount);
        var invoiceTotal = header.TotalNetAmount ?? (partTotal + labourTotal);

        var hsnGroups = items
            .GroupBy(i => string.IsNullOrWhiteSpace(i.Hsn) ? "-" : i.Hsn)
            .Select(g => new
            {
                Hsn = g.Key,
                Taxable = g.Sum(x => x.Taxable),
                Sgst = g.Sum(x => x.Sgst),
                Cgst = g.Sum(x => x.Cgst),
                Igst = g.Sum(x => x.Igst),
            })
            .OrderBy(g => g.Hsn)
            .ToList();

        var customerName = ledger?.Name ?? row.CustomerName ?? "-";
        var customerMobile = ledger?.Mobile ?? row.CustomerMobile ?? "-";
        var customerAddress = ledger?.Address; // no confirmed fallback on the DMS row itself
        var customerCity = !string.IsNullOrWhiteSpace(ledger?.City) ? ledger!.City : null;
        var customerState = ledger?.State;
        var customerGstin = ledger?.Gstin;

        var invoiceNo = header.BillNo.HasValue ? $"{header.Prefix}{header.BillNo}" : (row.InvoiceNo ?? "-");
        var jobNoDisplay = $"{row.JobPrefix}{row.JobNo}".Trim();
        if (string.IsNullOrWhiteSpace(jobNoDisplay)) jobNoDisplay = "-";

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(28);
                page.DefaultTextStyle(x => x.FontSize(9));

                page.Header().Column(col =>
                {
                    col.Item().Text(dealer?.Name ?? "-").FontSize(15).Bold();
                    if (!string.IsNullOrWhiteSpace(dealer?.Address)) col.Item().Text(dealer!.Address!);
                    var cityLine = string.Join(", ", new[] { dealer?.City, dealer?.State }
                        .Where(s => !string.IsNullOrWhiteSpace(s)));
                    if (!string.IsNullOrWhiteSpace(cityLine)) col.Item().Text(cityLine!);
                    col.Item().Text($"Phone : {(string.IsNullOrWhiteSpace(dealer?.Phone) ? "-" : dealer!.Phone)}");
                    col.Item().Text($"Email : {(string.IsNullOrWhiteSpace(dealer?.Email) ? "-" : dealer!.Email)}");
                    col.Item().Text($"GSTIN : {(string.IsNullOrWhiteSpace(dealer?.Gstin) ? "" : dealer!.Gstin)}");
                    col.Item().PaddingTop(6).AlignCenter().Text("GST TAX INVOICE").FontSize(13).Bold();
                });

                page.Content().PaddingTop(10).Column(col =>
                {
                    var customerRows = new List<(string Label, string Value)>
                    {
                        ("Customer Name", customerName),
                        ("Phone", customerMobile ?? "-"),
                        ("Address", string.IsNullOrWhiteSpace(customerAddress) ? "-" : customerAddress!),
                        ("State", string.IsNullOrWhiteSpace(customerState) ? "-" : customerState!),
                        ("City", string.IsNullOrWhiteSpace(customerCity) ? "-" : customerCity!),
                        ("GSTIN", string.IsNullOrWhiteSpace(customerGstin) ? "-" : customerGstin!),
                    };
                    col.Item().Border(1).Padding(6).Column(c =>
                    {
                        c.Item().Text("Customer Details").Bold();
                        foreach (var (label, value) in customerRows)
                        {
                            var rowLabel = label; var rowValue = value;
                            c.Item().Row(r =>
                            {
                                r.ConstantItem(110).Text(rowLabel).SemiBold();
                                r.RelativeItem().Text(rowValue);
                            });
                        }
                    });

                    var vehicleRows = new List<(string Label1, string Value1, string Label2, string Value2)>
                    {
                        ("Job No", jobNoDisplay, "Invoice No", invoiceNo),
                        ("Chassis No", row.ChassisNo ?? "-", "Registration No", row.RegisterNo ?? "-"),
                        ("Motor No", row.MotorNo ?? "-", "Model", row.ModelName ?? "-"),
                        ("Battery No", row.BatteryNo ?? "-", "Inward Type", row.InwardType ?? "-"),
                        ("Job Status", row.JobStatus ?? "-", "Technician", row.Technician ?? "-"),
                    };
                    col.Item().PaddingTop(8).Border(1).Padding(6).Column(c =>
                    {
                        c.Item().Text("Vehicle Details").Bold();
                        foreach (var (label1, value1, label2, value2) in vehicleRows)
                        {
                            var l1 = label1; var v1 = value1; var l2 = label2; var v2 = value2;
                            c.Item().Row(r =>
                            {
                                r.RelativeItem().Row(rr => { rr.ConstantItem(90).Text(l1).SemiBold(); rr.RelativeItem().Text(v1); });
                                r.RelativeItem().Row(rr => { rr.ConstantItem(90).Text(l2).SemiBold(); rr.RelativeItem().Text(v2); });
                            });
                        }
                    });

                    col.Item().PaddingTop(10).Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.ConstantColumn(22);
                            c.RelativeColumn(2);
                            c.RelativeColumn(4);
                            c.RelativeColumn(1.6f);
                            c.RelativeColumn(1.2f);
                            c.RelativeColumn(1.6f);
                            c.RelativeColumn(1.6f);
                            c.RelativeColumn(1.8f);
                            c.RelativeColumn(1.6f);
                            c.RelativeColumn(1.8f);
                        });

                        table.Header(h =>
                        {
                            h.Cell().Text("Sr").Bold();
                            h.Cell().Text("Code").Bold();
                            h.Cell().Text("Description").Bold();
                            h.Cell().Text("HSN").Bold();
                            h.Cell().AlignRight().Text("Qty").Bold();
                            h.Cell().AlignRight().Text("Rate").Bold();
                            h.Cell().AlignRight().Text("Discount").Bold();
                            h.Cell().AlignRight().Text("Taxable").Bold();
                            h.Cell().AlignRight().Text("IGST").Bold();
                            h.Cell().AlignRight().Text("Net Amount").Bold();
                            h.Cell().ColumnSpan(10).PaddingTop(3).BorderBottom(1);
                        });

                        var sr = 1;
                        foreach (var it in items)
                        {
                            table.Cell().Text(sr.ToString());
                            table.Cell().Text(it.Code);
                            table.Cell().Text(it.Description);
                            table.Cell().Text(it.Hsn);
                            table.Cell().AlignRight().Text(it.Qty.ToString("0.##"));
                            table.Cell().AlignRight().Text(it.Rate.ToString("N2"));
                            table.Cell().AlignRight().Text(it.Discount.ToString("N2"));
                            table.Cell().AlignRight().Text(it.Taxable.ToString("N2"));
                            table.Cell().AlignRight().Text(it.Igst.ToString("N2"));
                            table.Cell().AlignRight().Text(it.NetAmount.ToString("N2"));
                            sr++;
                        }
                    });

                    col.Item().PaddingTop(8).Text($"Amount In Words : {NumberToIndianWords(Math.Round(invoiceTotal, 0))} Rupees Only");

                    col.Item().PaddingTop(4).AlignRight().Column(c =>
                    {
                        void Line(string label, decimal amount, bool bold = false)
                        {
                            c.Item().Row(r =>
                            {
                                r.RelativeItem().AlignRight().Text(t => { var x = t.Span(label); if (bold) x.Bold(); });
                                r.ConstantItem(90).AlignRight().Text(t => { var x = t.Span(amount.ToString("N2")); if (bold) x.Bold(); });
                            });
                        }
                        Line("Part Total", partTotal);
                        Line("Labour Total", labourTotal);
                        c.Item().PaddingTop(2).LineHorizontal(1);
                        Line("Invoice Total", invoiceTotal, bold: true);
                    });

                    col.Item().PaddingTop(12).Border(1).Padding(6).Column(c =>
                    {
                        c.Item().Text("HSN Summary").Bold();
                        c.Item().PaddingTop(4).Table(table =>
                        {
                            table.ColumnsDefinition(cc =>
                            {
                                cc.RelativeColumn(1.4f);
                                cc.RelativeColumn(1.6f);
                                cc.RelativeColumn(1.2f);
                                cc.RelativeColumn(1.4f);
                                cc.RelativeColumn(1.2f);
                                cc.RelativeColumn(1.4f);
                                cc.RelativeColumn(1.2f);
                                cc.RelativeColumn(1.4f);
                            });
                            table.Header(h =>
                            {
                                h.Cell().Text("HSN").Bold();
                                h.Cell().AlignRight().Text("Taxable Value").Bold();
                                h.Cell().AlignRight().Text("SGST Rate").Bold();
                                h.Cell().AlignRight().Text("SGST Amt").Bold();
                                h.Cell().AlignRight().Text("CGST Rate").Bold();
                                h.Cell().AlignRight().Text("CGST Amt").Bold();
                                h.Cell().AlignRight().Text("IGST Rate").Bold();
                                h.Cell().AlignRight().Text("IGST Amt").Bold();
                                h.Cell().ColumnSpan(8).PaddingTop(3).BorderBottom(1);
                            });
                            foreach (var g in hsnGroups)
                            {
                                var sgstRate = g.Taxable > 0 ? g.Sgst / g.Taxable * 100m : 0m;
                                var cgstRate = g.Taxable > 0 ? g.Cgst / g.Taxable * 100m : 0m;
                                var igstRate = g.Taxable > 0 ? g.Igst / g.Taxable * 100m : 0m;
                                table.Cell().Text(g.Hsn);
                                table.Cell().AlignRight().Text(g.Taxable.ToString("N2"));
                                table.Cell().AlignRight().Text(sgstRate.ToString("N2"));
                                table.Cell().AlignRight().Text(g.Sgst.ToString("N2"));
                                table.Cell().AlignRight().Text(cgstRate.ToString("N2"));
                                table.Cell().AlignRight().Text(g.Cgst.ToString("N2"));
                                table.Cell().AlignRight().Text(igstRate.ToString("N2"));
                                table.Cell().AlignRight().Text(g.Igst.ToString("N2"));
                            }
                        });
                    });

                    col.Item().PaddingTop(16).Text("Remarks :");
                    col.Item().PaddingTop(18).Height(1);

                    col.Item().PaddingTop(24).Row(sigRow =>
                    {
                        sigRow.RelativeItem().Column(c =>
                        {
                            c.Item().PaddingTop(20).LineHorizontal(1);
                            c.Item().AlignCenter().Text("Customer Signature");
                        });
                        sigRow.ConstantItem(30);
                        sigRow.RelativeItem().Column(c =>
                        {
                            c.Item().PaddingTop(20).LineHorizontal(1);
                            c.Item().AlignCenter().Text("Authorized Signatory");
                        });
                    });
                });

                page.Footer().AlignCenter().Text("Generated by JobCardScanner from DMS.").FontSize(7).Italic();
            });
        });

        return doc.GeneratePdf();
    }

    /// <summary>
    /// Resolves one RepairBillDetail row to a rendered line-item. ItemType's own value convention
    /// (what a part line looks like vs a labour line) was NEVER confirmed anywhere in this codebase
    /// (see BaplDmsRepairBillDetailRow's doc comment), so this does NOT switch on it directly -
    /// instead it infers part-vs-labour from which of PartItemId/LabourMasterId is actually
    /// populated (a much safer signal, since those columns ARE confirmed), and only falls back to
    /// ItemType's own text as a tie-breaker when neither id is set.
    /// </summary>
    private static LineItem ClassifyLine(BaplDmsRepairBillDetailRow r)
    {
        var looksLikePart = r.PartItemId.HasValue || (r.PartQty is > 0) || (r.PartNetAmount is > 0 && r.LabourNetAmount is null or 0);
        var looksLikeLabour = r.LabourMasterId.HasValue || (r.LabourQty is > 0) || (r.LabourNetAmount is > 0 && r.PartNetAmount is null or 0);

        bool isPart;
        if (looksLikePart && !looksLikeLabour) isPart = true;
        else if (looksLikeLabour && !looksLikePart) isPart = false;
        else if (!string.IsNullOrWhiteSpace(r.ItemType) && r.ItemType!.Any(char.IsLetter))
            isPart = r.ItemType.Contains("Labour", StringComparison.OrdinalIgnoreCase) ? false : true;
        else
            isPart = looksLikePart; // default: whichever matched, or Part if both/neither did

        var code = (isPart ? r.PartItemId ?? r.MaterialId : r.LabourMasterId)?.ToString() ?? "-";
        // No confirmed part/labour-name master table exists anywhere in this codebase (see
        // BaplDmsRepairBillDetailRow's doc comment) - a generic label is printed rather than
        // guessing a join that would very likely just fail.
        var description = isPart ? "Part" : "Labour";
        const string hsn = "-"; // no confirmed HSN source per part - see doc comment above

        var qty = isPart ? (r.PartQty ?? 0) : (r.LabourQty ?? 0);
        var rate = isPart ? (r.PartRate ?? 0) : (r.LabourRate ?? 0);
        var discount = isPart ? (r.PartDiscount ?? r.DiscountValue ?? 0) : (r.LabourDiscount ?? r.DiscountValue ?? 0);
        var taxable = isPart ? (r.PartTaxblAmount ?? 0) : (r.LabourTaxblAmount ?? 0);
        var netAmount = isPart ? (r.PartNetAmount ?? 0) : (r.LabourNetAmount ?? 0);
        var igst = r.Igstamount ?? 0;
        var cgst = r.Cgstamount ?? 0;
        var sgst = r.Sgstamount ?? 0;

        return new LineItem(code, description, hsn, qty, rate, discount, taxable, igst, cgst, sgst, netAmount, isPart);
    }

    /// <summary>Indian-numbering-system (Crore/Lakh/Thousand) integer-to-words converter for the
    /// "Amount In Words : ... Rupees Only" line. No paisa component - the invoice total is rounded
    /// to the nearest rupee first (see caller).</summary>
    private static string NumberToIndianWords(decimal amount)
    {
        var n = (long)Math.Abs(amount);
        if (n == 0) return "Zero";

        string[] ones = { "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
            "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen" };
        string[] tens = { "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety" };

        static string TwoDigits(long v, string[] ones, string[] tens)
        {
            if (v < 20) return ones[v];
            return (tens[v / 10] + (v % 10 != 0 ? " " + ones[v % 10] : "")).Trim();
        }

        static string ThreeDigits(long v, string[] ones, string[] tens)
        {
            var parts = new List<string>();
            if (v >= 100) { parts.Add(ones[v / 100] + " Hundred"); v %= 100; }
            if (v > 0) parts.Add(TwoDigits(v, ones, tens));
            return string.Join(" ", parts);
        }

        var crore = n / 10000000; n %= 10000000;
        var lakh = n / 100000; n %= 100000;
        var thousand = n / 1000; n %= 1000;
        var hundred = n;

        var words = new List<string>();
        if (crore > 0) words.Add(ThreeDigits(crore, ones, tens) + " Crore");
        if (lakh > 0) words.Add(ThreeDigits(lakh, ones, tens) + " Lakh");
        if (thousand > 0) words.Add(ThreeDigits(thousand, ones, tens) + " Thousand");
        if (hundred > 0) words.Add(ThreeDigits(hundred, ones, tens));

        return string.Join(" ", words);
    }
}
