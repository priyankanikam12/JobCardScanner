using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services.Integrations;

public class MockDmsClient : IntegrationClientBase, IDmsClient
{
    public MockDmsClient(JobCardScannerDbContext db, ILogger<MockDmsClient> logger) : base(db, logger) { }

    public Task<IReadOnlyList<PartAvailabilityRecord>> CheckNetworkAvailabilityAsync(string partNumber) =>
        ExecuteAsync<IReadOnlyList<PartAvailabilityRecord>>(IntegrationSystem.Dms, "GET /network/availability", new { partNumber }, async () =>
        {
            await SimulateLatencyAsync();
            // Mock: synthesize 1-2 nearby dealers with plausible stock.
            return new List<PartAvailabilityRecord>
            {
                new(partNumber, "DL-NORTH-02", Rng.Next(0, 20), Rng.Next(1, 3)),
                new(partNumber, "DL-CENTRAL-01", Rng.Next(0, 20), Rng.Next(2, 5)),
            };
        });

    public Task<string> RaiseInterDealerTransferAsync(string partNumber, int quantity, string fromDealerCode, string toDealerCode) =>
        ExecuteAsync(IntegrationSystem.Dms, "POST /network/transfers", new { partNumber, quantity, fromDealerCode, toDealerCode }, async () =>
        {
            await SimulateLatencyAsync();
            return $"TRF-{DateTime.UtcNow:yyyyMMddHHmmss}-{Rng.Next(1000, 9999)}";
        });
}
