using JobCardScanner.Api.Models;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace JobCardScanner.Api.Services;

/// <summary>Builds the customer-facing invoice PDF with QuestPDF (Community license, see Program.cs).</summary>
public class InvoicePdfService : IInvoicePdfService
{
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
}
