namespace JobCardScanner.Api.Services.Integrations;

public record PartAvailabilityRecord(string PartNumber, string SourceDealer, int AvailableQty, int EtaDays);

/// <summary>Swappable client for the dealer management system's cross-dealer parts network.</summary>
public interface IDmsClient
{
    Task<IReadOnlyList<PartAvailabilityRecord>> CheckNetworkAvailabilityAsync(string partNumber);
    Task<string> RaiseInterDealerTransferAsync(string partNumber, int quantity, string fromDealerCode, string toDealerCode);
}
