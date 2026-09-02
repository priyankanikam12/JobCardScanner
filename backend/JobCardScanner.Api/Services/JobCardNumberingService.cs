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

    public Task<string> NextEstimateNumberAsync(Guid dealerId) => NextAsync(dealerId, "Estimate", "EST");
    public Task<string> NextInvoiceNumberAsync(Guid dealerId) => NextAsync(dealerId, "Invoice", "INV");

    /// <summary>
    /// JC/{last 3 digits of the dealer's BAPL DMS dealer code}/{Indian FY, e.g. "26-27"}/
    /// {4-digit sequence} - e.g. "JC/487/26-27/0001" for dealer CUS0487's first job card of
    /// FY2026-27. Deliberately keyed off a per-financial-year CounterType ("JobCard-FY26-27"
    /// etc.) rather than a schema change: this app creates its schema with
    /// Database.EnsureCreatedAsync() (see Program.cs), which does nothing on a database that
    /// already exists in production, so a new nullable column here would silently never appear
    /// on deployed databases. A distinct CounterType per FY sidesteps that - the very first call
    /// after a financial year rolls over just doesn't find an existing counter for the new
    /// CounterType, and starts a fresh one at 0001, without touching prior years' counters or
    /// requiring any manual ALTER TABLE.
    /// </summary>
    public async Task<string> NextJobCardNumberAsync(Guid dealerId)
    {
        var dealer = await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealerId);
        var dealerCode = dealer?.BaplDmsDealerCode ?? dealer?.Code ?? "000";
        var digitsOnly = new string(dealerCode.Where(char.IsDigit).ToArray());
        var last3Source = digitsOnly.Length > 0 ? digitsOnly : dealerCode;
        var last3 = last3Source.Length >= 3 ? last3Source[^3..] : last3Source.PadLeft(3, '0');
        var fyLabel = CurrentIndianFinancialYearLabel();
        var counterType = $"JobCard-FY{fyLabel}";

        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                var counter = await _db.Counters.FirstOrDefaultAsync(c => c.DealerId == dealerId && c.CounterType == counterType);
                if (counter is null)
                {
                    counter = new Counter { DealerId = dealerId, CounterType = counterType, Prefix = last3, CurrentValue = 0 };
                    _db.Counters.Add(counter);
                }

                counter.CurrentValue++;
                await _db.SaveChangesAsync();

                return $"JC/{last3}/{fyLabel}/{counter.CurrentValue:D4}";
            }
            catch (DbUpdateConcurrencyException)
            {
                // Another request incremented the same counter first - reload and retry.
            }
        }

        throw new InvalidOperationException($"Could not allocate a job card number for dealer {dealerId} after several attempts.");
    }

    /// <summary>Current Indian financial year (Apr 1 - Mar 31, IST) as "YY-YY", e.g. "26-27".</summary>
    private static string CurrentIndianFinancialYearLabel()
    {
        var nowIst = IndianNow();
        var startYear = nowIst.Month >= 4 ? nowIst.Year : nowIst.Year - 1;
        var endYear = startYear + 1;
        return $"{startYear % 100:D2}-{endYear % 100:D2}";
    }

    private static DateTime IndianNow()
    {
        // "India Standard Time" is the Windows tz ID (production runs on IIS/Windows);
        // "Asia/Kolkata" is the IANA equivalent used on Linux (dev/CI). Falling back to a fixed
        // UTC+5:30 offset if neither tzdata entry is present keeps this from ever throwing -
        // financial-year boundary math only needs to be right within a few hours of midnight IST.
        try { return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("India Standard Time")); }
        catch (TimeZoneNotFoundException) { }
        catch (InvalidTimeZoneException) { }

        try { return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Kolkata")); }
        catch (TimeZoneNotFoundException) { }
        catch (InvalidTimeZoneException) { }

        return DateTime.UtcNow.Add(TimeSpan.FromMinutes(5 * 60 + 30));
    }

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
