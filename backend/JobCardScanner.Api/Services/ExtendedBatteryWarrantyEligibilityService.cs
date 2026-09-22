using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>See IExtendedBatteryWarrantyEligibilityService for why this formula lives here and not
/// duplicated in each caller.</summary>
public class ExtendedBatteryWarrantyEligibilityService : IExtendedBatteryWarrantyEligibilityService
{
    private readonly JobCardScannerDbContext _db;

    public ExtendedBatteryWarrantyEligibilityService(JobCardScannerDbContext db)
    {
        _db = db;
    }

    public async Task<List<ExtendedBatteryWarrantyEligibilityResult>> EvaluateAsync(
        Guid dealerId, string vehicleModel, DateOnly purchaseDate, decimal kms, DateOnly claimDate,
        CancellationToken ct = default)
    {
        var modelLower = vehicleModel.Trim().ToLowerInvariant();

        var candidates = await _db.ExtendedBatteryWarrantySchemes.AsNoTracking()
            .Where(s => s.DealerId == dealerId && s.IsActive
                && s.VehicleModel.ToLower() == modelLower
                && s.FromDate <= purchaseDate
                && (s.ToDate == null || s.ToDate >= purchaseDate))
            .ToListAsync(ct);

        return candidates.Select(s =>
        {
            var coverageEndDate = AddDuration(purchaseDate, s.Duration, s.DurationType);
            var dateOk = claimDate <= coverageEndDate;
            // Kms <= 0 is treated as "no mileage cap set" - a literal 0 cap would make every claim
            // ineligible, which isn't a useful default for a scheme that only specified a duration.
            var kmsOk = s.Kms <= 0 || kms <= s.Kms;
            var isEligible = dateOk && kmsOk;

            string? reason = null;
            if (!dateOk) reason = $"Claim date {claimDate:dd.MM.yyyy} is past scheme coverage end date {coverageEndDate:dd.MM.yyyy}.";
            else if (!kmsOk) reason = $"Vehicle odometer ({kms:N0} km) exceeds scheme coverage ({s.Kms:N0} km).";

            return new ExtendedBatteryWarrantyEligibilityResult(
                SchemeId: s.Id, SchemeName: s.SchemeName, IsEligible: isEligible, IneligibilityReason: reason,
                DealerPrice: s.DealerPrice, CustomerPrice: s.CustomerPrice, GstPercent: s.GstPercent,
                CoverageEndDate: coverageEndDate, CoverageUptoKms: s.Kms,
                BatteryPartCode: s.BatteryPartCode, PartCode: s.PartCode);
        }).ToList();
    }

    private static DateOnly AddDuration(DateOnly from, int duration, string durationType) => durationType switch
    {
        "Days" => from.AddDays(duration),
        "Years" => from.AddYears(duration),
        _ => from.AddMonths(duration), // "Months" and any unrecognized legacy value fall back to Months
    };
}
