using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>
/// Mints sequential, human-readable numbers ("JC-BLR01-2026-000123") from the per-dealer
/// <see cref="Counter"/> table. Uses a short retry loop around SaveChanges instead of raw SQL
/// locking hints, which is adequate for the prototype's traffic and keeps the code portable
/// between LocalDB/Docker SQL Server and Azure SQL without provider-specific syntax.
/// </summary>
public class JobCardNumberingService : IJobCardNumberingService
{
    private readonly JobCardScannerDbContext _db;

    public JobCardNumberingService(JobCardScannerDbContext db)
    {
        _db = db;
    }

    public Task<string> NextJobCardNumberAsync(Guid dealerId) => NextAsync(dealerId, "JobCard", "JC");
    public Task<string> NextEstimateNumberAsync(Guid dealerId) => NextAsync(dealerId, "Estimate", "EST");
    public Task<string> NextInvoiceNumberAsync(Guid dealerId) => NextAsync(dealerId, "Invoice", "INV");

    private async Task<string> NextAsync(Guid dealerId, string counterType, string defaultPrefix)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                var counter = await _db.Counters.FirstOrDefaultAsync(c => c.DealerId == dealerId && c.CounterType == counterType);
                if (counter is null)
                {
                    var dealer = await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealerId);
                    counter = new Counter { DealerId = dealerId, CounterType = counterType, Prefix = dealer?.Code ?? defaultPrefix, CurrentValue = 0 };
                    _db.Counters.Add(counter);
                }

                counter.CurrentValue++;
                await _db.SaveChangesAsync();

                return $"{defaultPrefix}-{counter.Prefix}-{DateTime.UtcNow:yyyy}-{counter.CurrentValue:D6}";
            }
            catch (DbUpdateConcurrencyException)
            {
                // Another request incremented the same counter first - reload and retry.
            }
        }

        throw new InvalidOperationException($"Could not allocate a {counterType} number for dealer {dealerId} after several attempts.");
    }
}
