using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services;

public interface IInvoicePdfService
{
    /// <summary>Renders the invoice (with its job card's parts/labour breakdown) to a PDF byte array.</summary>
    byte[] Generate(Invoice invoice, JobCard jobCard, IReadOnlyList<JobCardPart> parts);
}
