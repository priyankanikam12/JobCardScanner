using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace JobCardScanner.Api.Services;

public interface IEstimatePdfService
{
    /// <summary>Builds the "Estimates Amount" PDF (dealer/customer/vehicle identity + Part Details/
    /// Labour Details/Grand Total) for the Estimates Amount "Done" -> email feature
    /// (JobCardsController.EmailEstimate) - same numbers as EstimatesCard on web/Android and the
    /// existing "Estimate" browser-print option (buildEstimatePrintHtml), just rendered server-side
    /// as an actual PDF file so it can be attached to an email instead of only opened in a browser
    /// tab. Returns null if the job card doesn't exist.</summary>
    Task<byte[]?> BuildEstimatePdfAsync(Guid jobCardId, CancellationToken ct = default);
}

/// <summary>See IEstimatePdfService. Deliberately a thin, separate service rather than another
/// method bolted onto InvoicePdfService - this PDF is JobCardScanner's own Part/Labour Suggestion
/// data (JobCardPartSuggestion/JobCardLabourSuggestion), not DMS's repair bill, so it doesn't
/// share InvoicePdfService's DMS dependency at all.</summary>
public class EstimatePdfService : IEstimatePdfService
{
    private readonly JobCardScannerDbContext _db;

    public EstimatePdfService(JobCardScannerDbContext db)
    {
        _db = db;
    }

    // 2026-09-07: colors lifted straight from PRINT_DOC_CSS (web/src/lib/jobCardPrintHtml.ts) so
    // this server-rendered PDF is the same document family as the browser "Estimate" print/PDF
    // (buildEstimatePrintHtml) - same navy header rule, same light-grey section title bars, same
    // bordered Customer/Vehicle Details boxes, same table chrome. Per explicit request: "same
    // estimate format" as that existing print output, not a distinct layout of its own.
    // Plain hex strings - QuestPDF.Infrastructure.Color has an implicit string -> Color
    // conversion (Color.FromHex under the hood), so these work directly wherever a Color
    // parameter is expected (FontColor/BorderColor/Background/LineColor etc.) without an
    // explicit Color.FromHex(...) call at each call site.
    private static readonly string Navy = "#1a4f8b";
    private static readonly string TitleBarBg = "#e8e8e8";
    private static readonly string TitleBarText = "#333333";
    private static readonly string BoxBorder = "#c8c8c8";
    private static readonly string RowBorder = "#eaeaea";
    private static readonly string LabelGrey = "#555555";
    private static readonly string SubGrey = "#666666";
    private static readonly string BodyText = "#111111";

    public async Task<byte[]?> BuildEstimatePdfAsync(Guid jobCardId, CancellationToken ct = default)
    {
        var jc = await _db.JobCards.AsNoTracking()
            .Include(j => j.Customer).Include(j => j.Vehicle).Include(j => j.Dealer)
            .Include(j => j.PartSuggestions).Include(j => j.LabourSuggestions)
            .FirstOrDefaultAsync(j => j.Id == jobCardId, ct);
        if (jc is null) return null;

        // 2026-10-03 ("Issue Type ... FOC select the Amount will be 0 ... that give from backend
        // calculation ... as well"): this method computed Amount as a flat Rate*Qty with no look
        // at Status (Part)/IssueType (Labour) at all - this is exactly the gap flagged when FOC
        // was added to the frontend. Same zero-amount rule the frontend's EstimatesCard and
        // PrintMenu.printEstimate now apply (Part: p.status === 'FOC', Labour: l.issueType ===
        // 'FOC') is applied here too, so an emailed estimate PDF matches what's shown on screen
        // for an FOC line instead of still showing its real amount.
        var partRows = jc.PartSuggestions.Select((p, i) =>
        {
            var mrp = p.Mrp ?? 0;
            var qty = p.Quantity <= 0 ? 1 : p.Quantity;
            var isFoc = p.Status == "FOC";
            return (Sr: i + 1, Code: p.ItemCode, Description: p.Description ?? "-", Hsn: p.HsnCode ?? "-", Rate: mrp, Qty: qty, Amount: isFoc ? 0 : mrp * qty);
        }).ToList();
        var labourRows = jc.LabourSuggestions.Select((l, i) =>
        {
            var rate = l.RateAtSuggestion ?? 0;
            var qty = l.Quantity <= 0 ? 1 : l.Quantity;
            var isFoc = l.IssueType == "FOC";
            return (Sr: i + 1, Code: l.LabourCode, Description: l.LabourDescription ?? "-", Hsn: l.HsnCode ?? "-", Rate: rate, Qty: qty, Amount: isFoc ? 0 : rate * qty);
        }).ToList();
        var partsTotal = partRows.Sum(r => r.Amount);
        var labourTotal = labourRows.Sum(r => r.Amount);
        var grandTotal = partsTotal + labourTotal;

        string Money(decimal n) => $"Rs. {n:N2}";
        string Dash(string? s) => string.IsNullOrWhiteSpace(s) ? "-" : s;
        var vehicleModel = $"{jc.Vehicle?.Model} {jc.Vehicle?.Variant}".Trim();

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(10).FontColor(BodyText));

                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(jc.Dealer?.Name ?? "Dealer").FontSize(15).Bold().FontColor(Navy);
                            c.Item().PaddingTop(2).Text($"Dealer Code: {Dash(jc.Dealer?.Code)}").FontSize(9).FontColor(SubGrey);
                        });
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().AlignRight().Text("ESTIMATE").FontSize(15).Bold().FontColor(Navy);
                            c.Item().PaddingTop(3).AlignRight().Text(t =>
                            {
                                t.Span("Job Card No: ").FontSize(9.5f).FontColor(LabelGrey);
                                t.Span(jc.JobCardNumber).FontSize(9.5f).Bold();
                            });
                            c.Item().AlignRight().Text(t =>
                            {
                                t.Span("Date: ").FontSize(9.5f).FontColor(LabelGrey);
                                t.Span(DateTime.UtcNow.AddMinutes(330).ToString("dd/MM/yyyy")).FontSize(9.5f).Bold();
                            });
                        });
                    });
                    col.Item().PaddingTop(7).LineHorizontal(2.5f).LineColor(Navy);
                });

                page.Content().PaddingTop(8).Column(col =>
                {
                    col.Spacing(6);

                    col.Item().Row(row =>
                    {
                        row.Spacing(6);
                        row.RelativeItem().Element(e => DetailsBox(e, "Customer Details",
                        [
                            ("Customer Name", Dash(jc.Customer?.Name)),
                            ("Mobile", Dash(jc.Customer?.Mobile)),
                            ("Address", Dash(jc.Customer?.Address)),
                            ("City", Dash(jc.Customer?.City)),
                        ]));
                        row.RelativeItem().Element(e => DetailsBox(e, "Vehicle Details",
                        [
                            ("Model", Dash(vehicleModel)),
                            ("Register No", Dash(jc.Vehicle?.RegNo)),
                            ("Chassis No", Dash(jc.Vehicle?.Vin)),
                            ("Odometer", $"{jc.OdometerAtCheckIn:0.#} km"),
                        ]));
                    });

                    void ItemsTable(string title, IReadOnlyList<(int Sr, string Code, string Description, string Hsn, decimal Rate, int Qty, decimal Amount)> rows, string codeHeader, string rateHeader, decimal total)
                    {
                        col.Item().Border(1).BorderColor(BoxBorder).Column(box =>
                        {
                            box.Item().Background(TitleBarBg).BorderBottom(1).BorderColor(BoxBorder)
                                .Padding(4).PaddingHorizontal(8)
                                .Text(title.ToUpperInvariant()).FontSize(8.5f).Bold().FontColor(TitleBarText).LetterSpacing(0.05f);

                            box.Item().Padding(8).Table(table =>
                            {
                                table.ColumnsDefinition(c =>
                                {
                                    c.ConstantColumn(30);
                                    c.RelativeColumn(2);
                                    c.RelativeColumn(3);
                                    c.RelativeColumn(1);
                                    c.RelativeColumn(1.3f);
                                    c.ConstantColumn(32);
                                    c.RelativeColumn(1.3f);
                                });
                                table.Header(h =>
                                {
                                    h.Cell().Text("Sr").FontSize(8.5f).Bold().FontColor(Navy);
                                    h.Cell().Text(codeHeader).FontSize(8.5f).Bold().FontColor(Navy);
                                    h.Cell().Text("Description").FontSize(8.5f).Bold().FontColor(Navy);
                                    h.Cell().Text("HSN").FontSize(8.5f).Bold().FontColor(Navy);
                                    h.Cell().AlignRight().Text(rateHeader).FontSize(8.5f).Bold().FontColor(Navy);
                                    h.Cell().AlignCenter().Text("Qty").FontSize(8.5f).Bold().FontColor(Navy);
                                    h.Cell().AlignRight().Text("Amount").FontSize(8.5f).Bold().FontColor(Navy);
                                    h.Cell().ColumnSpan(7).PaddingTop(4).BorderBottom(1).BorderColor(BoxBorder);
                                });
                                if (rows.Count == 0)
                                {
                                    table.Cell().ColumnSpan(7).PaddingVertical(5).AlignCenter().Text($"No {title.ToLowerInvariant()} suggested").Italic().FontColor(SubGrey);
                                }
                                foreach (var r in rows)
                                {
                                    table.Cell().PaddingTop(4).Text(r.Sr.ToString());
                                    table.Cell().PaddingTop(4).Text(r.Code);
                                    table.Cell().PaddingTop(4).Text(r.Description);
                                    table.Cell().PaddingTop(4).Text(r.Hsn);
                                    table.Cell().PaddingTop(4).AlignRight().Text(Money(r.Rate));
                                    table.Cell().PaddingTop(4).AlignCenter().Text(r.Qty.ToString());
                                    table.Cell().PaddingTop(4).AlignRight().Text(Money(r.Amount));
                                }
                                if (rows.Count > 0)
                                {
                                    table.Cell().ColumnSpan(6).PaddingTop(6).BorderTop(1).BorderColor(BoxBorder).AlignRight().Text($"{title} Total").Bold();
                                    table.Cell().PaddingTop(6).BorderTop(1).BorderColor(BoxBorder).AlignRight().Text(Money(total)).Bold();
                                }
                            });
                        });
                    }

                    ItemsTable("Part Details", partRows, "Item Code", "MRP", partsTotal);
                    ItemsTable("Labour Details", labourRows, "Labour Code", "Rate", labourTotal);

                    col.Item().Border(1).BorderColor(BoxBorder).Padding(8).PaddingTop(0).Column(box =>
                    {
                        box.Item().PaddingTop(8).BorderTop(2).BorderColor(Navy).PaddingTop(6).Row(r =>
                        {
                            r.RelativeItem().Text("Grand Total").FontSize(12.5f).Bold();
                            r.AutoItem().Text(Money(grandTotal)).FontSize(12.5f).Bold();
                        });
                    });
                });
            });
        });

        return doc.GeneratePdf();
    }

    /// <summary>One "Customer Details"/"Vehicle Details" box: bordered, a grey title bar, then a
    /// label:value row per entry with a thin bottom rule between rows (none after the last) -
    /// matches .sec/.sec-title/.kv in PRINT_DOC_CSS.</summary>
    private static void DetailsBox(QuestPDF.Infrastructure.IContainer container, string title, (string Label, string Value)[] rows)
    {
        container.Border(1).BorderColor(BoxBorder).Column(box =>
        {
            box.Item().Background(TitleBarBg).BorderBottom(1).BorderColor(BoxBorder)
                .Padding(4).PaddingHorizontal(8)
                .Text(title.ToUpperInvariant()).FontSize(8.5f).Bold().FontColor(TitleBarText).LetterSpacing(0.05f);

            for (var i = 0; i < rows.Length; i++)
            {
                var (label, value) = rows[i];
                var cell = box.Item();
                if (i < rows.Length - 1) cell = cell.BorderBottom(1).BorderColor(RowBorder);
                cell.Padding(6).PaddingHorizontal(8).Row(r =>
                {
                    r.ConstantItem(95).Text(label).FontSize(9).FontColor(LabelGrey);
                    r.RelativeItem().Text(value).FontSize(10).Bold();
                });
            }
        });
    }
}
