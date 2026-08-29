namespace JobCardScanner.Api.Services;

public interface IJobCardNumberingService
{
    Task<string> NextJobCardNumberAsync(Guid dealerId);
    Task<string> NextEstimateNumberAsync(Guid dealerId);
    Task<string> NextInvoiceNumberAsync(Guid dealerId);
}
