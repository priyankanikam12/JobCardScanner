namespace JobCardScanner.Api.Services;

public interface IJobCardNumberingService
{
    /// <summary>
    /// Mints the next job card number as JC/{last 3 digits of the dealer's DMS dealer code}/
    /// {Indian financial year, e.g. "26-27"}/{4-digit sequence, e.g. "0001"} - continuing the
    /// sequence for as long as the financial year (Apr 1 - Mar 31, IST) is current, and starting
    /// back at 0001 the first time this is called after the financial year rolls over.
    /// </summary>
    Task<string> NextJobCardNumberAsync(Guid dealerId);
    Task<string> NextEstimateNumberAsync(Guid dealerId);
    Task<string> NextInvoiceNumberAsync(Guid dealerId);
}
