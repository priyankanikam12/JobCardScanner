using JobCardScanner.Api.Dtos;

namespace JobCardScanner.Api.Services;

/// <summary>
/// 2026-09-22 - shared eligibility formula for the Extended Battery Warranty Scheme feature,
/// extracted out into its own service (rather than living only inside
/// ExtendedBatteryWarrantySchemesController) so that controller's own GET .../eligible endpoint
/// and RepairBillDocsController.Create's non-destructive per-line tagging (see that method's own
/// comment) always evaluate eligibility exactly the same way - one formula, no risk of the two
/// drifting apart as either is edited later. See Models/ExtendedBatteryWarrantySchemes.cs for the
/// full formula write-up and its INTERPRETATION/ASSUMPTION disclosures - this service is a
/// mechanical implementation of that documented formula, not a place to re-derive it.
/// </summary>
public interface IExtendedBatteryWarrantyEligibilityService
{
    /// <summary>Returns every ACTIVE scheme for this dealer whose VehicleModel matches (case
    /// insensitive) and whose [FromDate, ToDate] window contains purchaseDate - each tagged
    /// IsEligible for the given kms/claimDate, so the caller can show why a candidate scheme did or
    /// didn't qualify rather than just silently omitting it.</summary>
    Task<List<ExtendedBatteryWarrantyEligibilityResult>> EvaluateAsync(
        Guid dealerId, string vehicleModel, DateOnly purchaseDate, decimal kms, DateOnly claimDate,
        CancellationToken ct = default);
}
