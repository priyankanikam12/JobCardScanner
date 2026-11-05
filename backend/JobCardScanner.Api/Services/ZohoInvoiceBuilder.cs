using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace JobCardScanner.Api.Services;

public sealed record ZohoBillLine(Guid Id, string ItemType, string ItemCode, string? Description, string? IssueType, double Qty, decimal Rate,
    string? DiscountType, decimal DiscountValue, decimal CgstPct, decimal SgstPct, decimal IgstPct);

public sealed record ZohoBill(Guid Id, string BillNumber, DateOnly BillDate, string JobCardNumber, string Status, string? Remarks, decimal TotalAmount, IReadOnlyList<ZohoBillLine> Lines);

public sealed record ZohoCustomerData(Guid CustomerId, string Name, string? Mobile, string? Email, string? Gstin, string? State, string? Address, string? City, string? Pin);

/// <summary>
/// 2026-11-04 (Learnall, "BGauss DMS to Zoho Books - API Payloads and Fields", 03.11.2026, sections 4.6, 6, 7 and 8): the request bodies of the invoice push and the checks the DMS must make BEFORE sending - "a record that
/// fails a check is not sent; it is corrected in the DMS and sent again". Pure logic (no HTTP, no database) so every rule can be tested; the push itself calls Zoho with these bodies.
///   * invoice: Billed bills only; every line Paid, FOC or U/W; Paid line = rate without GST + discount in rupees; FOC and U/W = rate 0 with (FOC) / (U/W) in the description; tax_id by the line's GST (CGST + SGST = the intra-state id,
///     IGST = the inter-state id); the DMS bill id goes in cf_bgauss_dms_invoice_id; ignore_auto_number_generation=true is added by the caller.
///   * labour item (created at invoice time when the labour code is not in Zoho): service, SAC 998729, GST18 + IGST18, name = description + (labour code), no "&lt;" or "&gt;".
///   * customer (created at invoice time when the DMS customer id is not in Zoho): by gst_treatment (business_gst with GSTIN, business_none, consumer for an individual), place_of_contact = the 2-letter state code.
/// </summary>
public static class ZohoInvoiceBuilder
{
    public const string SalesAccountId = "3898946000000000486";
    public const string LabourSac = "998729";

    /// <summary>GST % -> (intra-state tax id, inter-state tax id), from section 3 of the payloads document.</summary>
    public static readonly IReadOnlyDictionary<int, (string Intra, string Inter)> TaxIds = new Dictionary<int, (string, string)>
    {
        [0] = ("3898946000000041127", "3898946000000041055"), [5] = ("3898946000000041131", "3898946000000041056"), [12] = ("3898946000000041135", "3898946000000041057"),
        [18] = ("3898946000000041139", "3898946000000041059"), [28] = ("3898946000000041147", "3898946000000041060"), [40] = ("3898946000000041143", "3898946000000041058"),
    };

    private static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>The rupee amount the discount takes off a line (Percentage = % of gross, anything else a flat amount; never more than gross) - the same formula as the repair bill.</summary>
    public static decimal DiscountAmount(double qty, decimal rate, string? discountType, decimal discountValue)
    {
        var gross = (decimal)qty * rate;
        var amt = string.Equals(discountType, "Percentage", StringComparison.OrdinalIgnoreCase) ? gross * discountValue / 100m : discountValue;
        return R(Math.Min(Math.Max(amt, 0m), gross));
    }

    private static string? IssueKind(string? issueType) => issueType?.Trim().ToUpperInvariant() switch { "PAID" => "Paid", "FOC" => "FOC", "U/W" or "UW" => "U/W", _ => null };

    /// <param name="itemIds">item code (any case) -> Zoho item_id, from the item lookup by SKU (parts) or the lookup / create of the labour item.</param>
    public static (JsonObject? Body, List<string> Errors) BuildInvoice(ZohoBill bill, string customerContactId, string locationId, IReadOnlyDictionary<string, string> itemIds)
    {
        var errors = new List<string>();
        if (!string.Equals(bill.Status, "Billed", StringComparison.OrdinalIgnoreCase)) errors.Add($"bill status is {bill.Status}: only Billed bills are sent.");
        if (string.IsNullOrWhiteSpace(bill.BillNumber)) errors.Add("bill number is blank.");
        if (string.IsNullOrWhiteSpace(customerContactId)) errors.Add("no Zoho customer (contact_id) for this bill.");
        if (string.IsNullOrWhiteSpace(locationId)) errors.Add("no Zoho location for this bill.");
        if (bill.Lines.Count == 0) errors.Add("the bill has no lines.");

        var lines = new JsonArray();
        var ids = new Dictionary<string, string>(itemIds, StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < bill.Lines.Count; i++)
        {
            var l = bill.Lines[i]; var at = $"line {i + 1} ({l.ItemCode})";
            var kind = IssueKind(l.IssueType);
            if (kind is null) { errors.Add($"{at}: issue type \"{l.IssueType}\" is not Paid, FOC or U/W."); continue; }
            if (l.Qty <= 0) errors.Add($"{at}: quantity must be more than 0.");
            if (!ids.TryGetValue((l.ItemCode ?? "").Trim(), out var itemId)) { errors.Add($"{at}: the item is not in Zoho Books."); continue; }

            var intra = Math.Round(l.CgstPct + l.SgstPct, 2); var inter = Math.Round(l.IgstPct, 2);
            string? taxId = null;
            if (inter > 0m) { if (inter == Math.Truncate(inter) && TaxIds.TryGetValue((int)inter, out var t1)) taxId = t1.Inter; else errors.Add($"{at}: IGST {inter}% is not one of 0, 5, 12, 18, 28, 40."); }
            else if (intra == Math.Truncate(intra) && TaxIds.TryGetValue((int)intra, out var t2)) taxId = t2.Intra;
            else errors.Add($"{at}: CGST + SGST ({intra}%) is not one of 0, 5, 12, 18, 28, 40.");

            var description = (l.Description ?? l.ItemCode ?? "").Trim();
            var line = new JsonObject { ["item_id"] = itemId };
            if (kind == "Paid")
            {
                line["description"] = description;
                line["quantity"] = l.Qty;
                line["rate"] = R(l.Rate);
                var disc = DiscountAmount(l.Qty, l.Rate, l.DiscountType, l.DiscountValue);
                if (disc > 0m) line["discount"] = disc;
            }
            else   // FOC and U/W still reduce stock: quantity stays, the rate is 0
            {
                line["description"] = $"{description} ({kind})";
                line["quantity"] = l.Qty;
                line["rate"] = 0m;
            }
            if (taxId is not null) line["tax_id"] = taxId;
            lines.Add(line);
        }
        if (errors.Count > 0) return (null, errors);

        var body = new JsonObject
        {
            ["customer_id"] = customerContactId,
            ["invoice_number"] = bill.BillNumber.Trim(),
            ["reference_number"] = bill.JobCardNumber,
            ["date"] = bill.BillDate.ToString("yyyy-MM-dd"),
            ["location_id"] = locationId,
            ["discount_type"] = "item_level",
            ["is_discount_before_tax"] = true,
            ["custom_fields"] = new JsonArray(new JsonObject { ["api_name"] = "cf_bgauss_dms_invoice_id", ["value"] = bill.Id.ToString() }),
            ["line_items"] = lines,
        };
        if (!string.IsNullOrWhiteSpace(bill.Remarks)) body["notes"] = bill.Remarks.Trim();
        return (body, errors);
    }

    /// <summary>Zoho's total against the DMS total: a difference over Rs 1 is reported (section 8.3 of the field list).</summary>
    public static bool TotalsAgree(decimal dmsTotal, decimal zohoTotal) => Math.Abs(dmsTotal - zohoTotal) <= 1m;

    /// <summary>The labour item to create when the labour code is not found (section 4.6). rate = the labour rate without GST.</summary>
    public static JsonObject BuildLabourItem(string labourCode, string? description, decimal rate)
    {
        var clean = Regex.Replace((description ?? labourCode).Replace("<", " ").Replace(">", " "), @"\s+", " ").Trim();
        return new JsonObject
        {
            ["name"] = $"{clean} ({labourCode.Trim()})",
            ["sku"] = labourCode.Trim(),
            ["product_type"] = "service",
            ["item_type"] = "sales",
            ["hsn_or_sac"] = LabourSac,
            ["rate"] = R(rate),
            ["account_id"] = SalesAccountId,
            ["item_tax_preferences"] = new JsonArray(
                new JsonObject { ["tax_id"] = TaxIds[18].Intra, ["tax_specification"] = "intra" },
                new JsonObject { ["tax_id"] = TaxIds[18].Inter, ["tax_specification"] = "inter" }),
        };
    }

    // ------------------------------------------------------------------ customers

    /// <summary>GST state codes as Zoho takes them in place_of_contact. A name is matched without case, spaces or dots.</summary>
    private static readonly Dictionary<string, string> StateCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ANDAMANANDNICOBARISLANDS"] = "AN", ["ANDHRAPRADESH"] = "AP", ["ARUNACHALPRADESH"] = "AR", ["ASSAM"] = "AS", ["BIHAR"] = "BR", ["CHANDIGARH"] = "CH", ["CHHATTISGARH"] = "CT",
        ["DADRAANDNAGARHAVELIANDDAMANANDDIU"] = "DN", ["DELHI"] = "DL", ["NEWDELHI"] = "DL", ["GOA"] = "GA", ["GUJARAT"] = "GJ", ["HARYANA"] = "HR", ["HIMACHALPRADESH"] = "HP",
        ["JAMMUANDKASHMIR"] = "JK", ["JHARKHAND"] = "JH", ["KARNATAKA"] = "KA", ["KERALA"] = "KL", ["LADAKH"] = "LA", ["LAKSHADWEEP"] = "LD", ["MADHYAPRADESH"] = "MP", ["MAHARASHTRA"] = "MH",
        ["MANIPUR"] = "MN", ["MEGHALAYA"] = "ML", ["MIZORAM"] = "MZ", ["NAGALAND"] = "NL", ["ODISHA"] = "OD", ["ORISSA"] = "OD", ["PUDUCHERRY"] = "PY", ["PONDICHERRY"] = "PY", ["PUNJAB"] = "PB",
        ["RAJASTHAN"] = "RJ", ["SIKKIM"] = "SK", ["TAMILNADU"] = "TN", ["TELANGANA"] = "TS", ["TRIPURA"] = "TR", ["UTTARPRADESH"] = "UP", ["UTTARAKHAND"] = "UK", ["WESTBENGAL"] = "WB",
    };

    public static string? StateCode(string? state)
    {
        if (string.IsNullOrWhiteSpace(state)) return null;
        var key = new string(state.Where(char.IsLetter).ToArray());
        if (StateCodes.TryGetValue(key, out var code)) return code;
        return state.Trim().Length == 2 && StateCodes.ContainsValue(state.Trim().ToUpperInvariant()) ? state.Trim().ToUpperInvariant() : null;
    }

    private static readonly Regex Gstin = new(@"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$", RegexOptions.Compiled);
    private static readonly Regex CompanyName = new(@"\b(PRIVATE|PVT|LIMITED|LTD|LLP|CORPORATION|CORP|ENTERPRISES|TECHNOLOGIES|VENTURES|SERVICES|LOGISTICS|MOBILITY|SOLUTIONS|INDUSTRIES|TRADERS|MOTORS)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>The customer to create when the DMS customer id is not in Zoho (section 6.2). GSTIN of 15 characters = business_gst; no GSTIN and a company-looking name = business_none; otherwise an individual (consumer).</summary>
    public static (JsonObject? Body, List<string> Errors) BuildCustomer(ZohoCustomerData c)
    {
        var errors = new List<string>();
        if (c.CustomerId == Guid.Empty) errors.Add("the customer has no DMS customer ID.");
        if (string.IsNullOrWhiteSpace(c.Name)) errors.Add("the customer name is blank.");
        var gstin = c.Gstin?.Trim().ToUpperInvariant();
        if (!string.IsNullOrEmpty(gstin) && !Gstin.IsMatch(gstin)) errors.Add($"GSTIN \"{c.Gstin}\" is not 15 valid characters.");
        var state = StateCode(c.State);
        if (state is null) errors.Add($"the state \"{c.State}\" is blank or unknown (place_of_contact needs the 2-letter state code).");
        if (errors.Count > 0) return (null, errors);

        var name = c.Name.Trim();
        var registered = !string.IsNullOrEmpty(gstin);
        var business = registered || CompanyName.IsMatch(name);
        var body = new JsonObject
        {
            ["contact_name"] = name, ["company_name"] = name, ["contact_type"] = "customer",
            ["customer_sub_type"] = business ? "business" : "individual",
            ["gst_treatment"] = registered ? "business_gst" : business ? "business_none" : "consumer",
            ["place_of_contact"] = state,
        };
        if (registered) body["gst_no"] = gstin;
        var address = new JsonObject { ["country"] = "India" };
        if (!string.IsNullOrWhiteSpace(c.Address)) address["address"] = c.Address.Trim();
        if (!string.IsNullOrWhiteSpace(c.City)) address["city"] = c.City.Trim();
        if (!string.IsNullOrWhiteSpace(c.State)) address["state"] = c.State.Trim();
        if (!string.IsNullOrWhiteSpace(c.Pin)) address["zip"] = c.Pin.Trim();
        body["billing_address"] = address;
        body["custom_fields"] = new JsonArray(new JsonObject { ["api_name"] = "cf_bgauss_dms_customer_id", ["value"] = c.CustomerId.ToString() });
        if (!string.IsNullOrWhiteSpace(c.Mobile) || !string.IsNullOrWhiteSpace(c.Email))
        {
            var person = new JsonObject { ["first_name"] = name.Length > 60 ? name[..60] : name, ["is_primary_contact"] = true };
            if (!string.IsNullOrWhiteSpace(c.Mobile)) person["mobile"] = c.Mobile.Trim();
            if (!string.IsNullOrWhiteSpace(c.Email)) person["email"] = c.Email.Trim();
            body["contact_persons"] = new JsonArray(person);
        }
        return (body, errors);
    }

    // ------------------------------------------------------------------ locations and order

    /// <summary>Dealer code + sub-location -> Zoho location_id, from the location table: "CUS0288W4" first, then the dealer code alone (the hub). null = not mapped (the bill is not sent).</summary>
    public static string? ResolveLocation(IReadOnlyDictionary<string, string> map, string? dealerCode, string? subLocation)
    {
        var m = new Dictionary<string, string>(map, StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(subLocation) && m.TryGetValue(subLocation.Trim(), out var a)) return a;
        if (!string.IsNullOrWhiteSpace(dealerCode) && m.TryGetValue(dealerCode.Trim(), out var b)) return b;
        return null;
    }

    /// <summary>The order of the first push (Learnall: "push them in date order, both together, so the stock in Zoho Books follows the same sequence as the DMS"): by date, then by creation time, bills before adjustments on the same moment.</summary>
    public static List<T> InDateOrder<T>(IEnumerable<T> records, Func<T, DateOnly> date, Func<T, DateTime> createdAt, Func<T, int> kindRank) =>
        records.OrderBy(date).ThenBy(createdAt).ThenBy(kindRank).ToList();
}