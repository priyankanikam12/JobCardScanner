using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services;

public interface IInvoicePdfService
{
    /// <summary>Renders the invoice (with its job card's parts/labour breakdown) to a PDF byte array.</summary>
    byte[] Generate(Invoice invoice, JobCard jobCard, IReadOnlyList<JobCardPart> parts);

    /// <summary>
    /// "Download Invoice from DMS" - renders BAPL DMS's own repair bill (RepairBillHeader/
    /// RepairBillDetail, read live via IBaplDmsService) for one job card as a PDF matching BAPL
    /// DMS's own GST tax invoice layout, NOT JobCardScanner's own <see cref="Invoice"/>/Generate
    /// above (a different feature backing a different button). Returns null when there's nothing
    /// to render: the job card was never synced to BAPL DMS (BaplJobCardHeaderId is null), or BAPL
    /// DMS has no repair bill saved for it yet - both are normal, not errors. See
    /// InvoicePdfService.BuildInvoicePdfAsync for exactly which fields are confirmed BAPL DMS
    /// schema vs. best-effort/placeholder.
    /// </summary>
    Task<byte[]?> BuildInvoicePdfAsync(Guid jobCardId, CancellationToken ct = default);
}
