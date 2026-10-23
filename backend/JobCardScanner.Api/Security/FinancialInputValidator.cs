namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-17 (VAPT DMS-08): the same kind of server-side check the report says already exists for discounts, now for prices, quantities and tax rates - on every bill / suggestion line, create AND update.
/// The browser can send anything; before this a bill could be saved with a negative price (-100), a 99% GST and a quantity of 999,999,999.
/// Returns null when the line is acceptable, or a message naming the line (the pages already show a 400 "message" in an alert).
/// Limits (edit here): price / rate / discount amount 0 .. 1 crore; quantity above 0 up to 10,000; discount % up to 100;
/// IGST 0 / 5 / 12 / 18 / 28 / 40 and CGST / SGST 0 / 2.5 / 6 / 9 / 14 / 20 (half of the IGST rate). The report names 0 / 5 / 12 / 18 / 28; 40 is also accepted because Care Desk and the Zoho push rules of this project use it -
/// remove 40 / 20 below if BGauss does not sell at that rate.
/// </summary>
public static class FinancialInputValidator
{
    public const decimal MaxMoney = 10_000_000m;
    public const decimal MaxQty = 10_000m;

    private static readonly decimal[] IgstRates = { 0m, 5m, 12m, 18m, 28m, 40m };
    private static readonly decimal[] HalfRates = { 0m, 2.5m, 6m, 9m, 14m, 20m };

    public static string? ValidateLine(string label, decimal qty, decimal rate, string? discountType, decimal discountValue, decimal cgstPct, decimal sgstPct, decimal igstPct)
    {
        if (qty <= 0 || qty > MaxQty) return $"'{label}': the quantity must be more than 0 and at most {MaxQty:0}.";
        if (rate < 0 || rate > MaxMoney) return $"'{label}': the price / rate must be between 0 and {MaxMoney:0}.";
        if (discountValue < 0 || discountValue > MaxMoney) return $"'{label}': the discount must be between 0 and {MaxMoney:0}.";
        if (string.Equals(discountType, "Percentage", StringComparison.OrdinalIgnoreCase) && discountValue > 100) return $"'{label}': a percentage discount cannot be more than 100.";
        if (!HalfRates.Contains(cgstPct) || !HalfRates.Contains(sgstPct)) return $"'{label}': CGST / SGST must be one of 0, 2.5, 6, 9, 14, 20 percent.";
        if (!IgstRates.Contains(igstPct)) return $"'{label}': IGST must be one of 0, 5, 12, 18, 28, 40 percent.";
        return null;
    }

    /// <summary>For lines that carry only a rate and a quantity (labour / part suggestions): same limits, no tax fields.</summary>
    public static string? ValidateRateQty(string label, decimal? qty, decimal? rate) =>
        ValidateLine(label, qty ?? 1m, rate ?? 0m, null, 0m, 0m, 0m, 0m);
}
