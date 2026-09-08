using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services;

/// <summary>One rendered Part/Labour line from a DMS repair bill, shaped for the "whole data...like
/// our jobcard flow" Part Details/Labour Details tables on the DMS-only job card detail page (see
/// BaplJobCardDetailPage.tsx) - the exact same classification InvoicePdfService's PDF line-items
/// table uses (ClassifyLine), just exposed as JSON instead of only ever ending up on a page of the
/// invoice PDF. Code/Description/Hsn are the same best-effort placeholders as the PDF (see
/// ClassifyLine's doc comment) - no confirmed part/labour-name master table exists anywhere in this
/// codebase, so these are never a guessed join.</summary>
public sealed record BaplDmsInvoiceLineItemDto(
    string Code, string Description, string Hsn, decimal Qty, decimal Rate,
    decimal Discount, decimal Taxable, decimal NetAmount, bool IsPart);

/// <summary>Whole shaped repair-bill breakdown for one DMS job card - what
/// GET /api/bapl-dms/job-cards/{id}/line-items returns. Null (from GetLineItemsAsync) means no
/// repair bill has been raised for this job in DMS yet - normal for an Open job card, not an error.</summary>
public sealed record BaplDmsInvoiceLineItemsResult(
    IReadOnlyList<BaplDmsInvoiceLineItemDto> Items,
    decimal PartTotal,
    decimal LabourTotal,
    decimal InvoiceTotal,
    string? RepairBillStatus,
    string? InvoiceNo);

public interface IInvoicePdfService
{
    /// <summary>Renders the invoice (with its job card's parts/labour breakdown) to a PDF byte array.</summary>
    byte[] Generate(Invoice invoice, JobCard jobCard, IReadOnlyList<JobCardPart> parts);

    /// <summary>
    /// "Download Invoice from DMS" - renders DMS's own repair bill (RepairBillHeader/
    /// RepairBillDetail, read live via IBaplDmsService) for one job card as a PDF matching BAPL
    /// DMS's own GST tax invoice layout, NOT JobCardScanner's own <see cref="Invoice"/>/Generate
    /// above (a different feature backing a different button). Returns null when there's nothing
    /// to render: the job card was never synced to DMS (BaplJobCardHeaderId is null), or BAPL
    /// DMS has no repair bill saved for it yet - both are normal, not errors. See
    /// InvoicePdfService.BuildInvoicePdfAsync for exactly which fields are confirmed DMS
    /// schema vs. best-effort/placeholder.
    /// </summary>
    Task<byte[]?> BuildInvoicePdfAsync(Guid jobCardId, CancellationToken ct = default);

    /// <summary>
    /// 2026-09-07 ("this also show like whole data in our jobcard flow") - same invoice PDF as
    /// BuildInvoicePdfAsync above, but for a DMS job card JobCardScanner never created at all (no
    /// local JobCard row to look up - opened directly in DMS, the "DMS" badge rows on /jobcards).
    /// Sources everything BuildInvoicePdfAsync would normally read off the local JobCard/Customer/
    /// Vehicle/Dealer straight from DMS's own data instead (IBaplDmsService.GetJobCardByIdAsync)
    /// plus a local Dealer lookup by BaplDmsDealerCode for letterhead details only. Same null
    /// conventions as BuildInvoicePdfAsync: null means no such DMS job card, or no repair bill
    /// raised for it yet - both normal, not errors.
    /// </summary>
    Task<byte[]?> BuildInvoicePdfFromDmsAsync(int jobCardHeaderId, CancellationToken ct = default);

    /// <summary>
    /// 2026-09-07 ("this also show like whole data in our jobcard flow") - the Part Details/Labour
    /// Details breakdown + Grand Total for one DMS job card's repair bill, for
    /// BaplJobCardDetailPage.tsx to render inline (the same shape JobCardDetailPage's Estimates
    /// Amount card already shows for a JobCardScanner-native job card, sourced from DMS's repair
    /// bill instead of local PartSuggestions/LabourSuggestions). Returns null when DMS has no
    /// repair bill for this job card yet (normal for one still Open) rather than an error.
    /// </summary>
    Task<BaplDmsInvoiceLineItemsResult?> GetLineItemsAsync(int jobCardHeaderId, CancellationToken ct = default);
}
