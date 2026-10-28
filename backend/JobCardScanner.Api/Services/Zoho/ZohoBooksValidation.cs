using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Services.Zoho;

/// <summary>
/// 2026-10-28 - runs the DataAnnotations already on the ZohoBooksDtos request classes, plus the one rule from "BGauss_DMS_Zoho_Books_API_Payloads.docx" section 8 that a single
/// attribute cannot express: "cgst + sgst = igst". Call this BEFORE every create/update call in ZohoBooksApiClient so a bad record is caught in the DMS, not sent to Zoho and
/// silently accepted wrong (section 8: "Zoho does not check these and accepts wrong values").
/// </summary>
public static class ZohoBooksValidation
{
    /// <summary>Runs every [Required]/[Range]/[RegularExpression]/[StringLength]/[MinLength] attribute on the object (and, recursively, on any nested object or list of objects -
    /// item_tax_preferences, line_items, custom_fields, contact_persons, billing_address - since DataAnnotations alone does not walk into child objects). Returns the readable
    /// messages, or an empty list when everything passes.</summary>
    public static List<string> ValidateDataAnnotations(object request)
    {
        var errors = new List<string>();
        ValidateRecursive(request, errors, new HashSet<object>());
        return errors;
    }

    private static void ValidateRecursive(object? obj, List<string> errors, HashSet<object> seen)
    {
        if (obj is null || obj is string) return;
        if (!obj.GetType().IsClass) return;
        if (!seen.Add(obj)) return;   // guard against a cycle; none of these DTOs have one today, but this keeps it safe if one is ever added

        if (obj is System.Collections.IEnumerable list and not string)
        {
            foreach (var item in list) ValidateRecursive(item, errors, seen);
            return;
        }

        var ctx = new ValidationContext(obj);
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(obj, ctx, results, validateAllProperties: true);
        foreach (var r in results) errors.Add(r.ErrorMessage ?? $"{obj.GetType().Name}: invalid value.");

        foreach (var prop in obj.GetType().GetProperties())
        {
            if (prop.GetIndexParameters().Length > 0) continue;
            object? value;
            try { value = prop.GetValue(obj); } catch { continue; }
            if (value is null || value is string || value.GetType().IsPrimitive || value is decimal || value is DateTime) continue;
            ValidateRecursive(value, errors, seen);
        }
    }

    /// <summary>Payloads doc section 8, Item checks: "igst is 0, 5, 12, 18, 28 or 40; cgst + sgst = igst." Zoho's own ZohoItemTaxPreference only carries the two resolved tax_id
    /// values (see ZohoBooksOptions.TaxIdsByGstPercent) - this check runs on the SOURCE DMS figures, before the tax_id lookup, so a bad item is rejected before a tax_id is even
    /// resolved (ZohoBooksApiClient.CreateItemAsync / UpdateItemAsync call this first).</summary>
    public static List<string> ValidateItemGst(string itemCode, decimal igst, decimal cgst, decimal sgst)
    {
        var errors = new List<string>();
        decimal[] allowed = { 0m, 5m, 12m, 18m, 28m, 40m };
        if (!allowed.Contains(igst))
            errors.Add($"Item {itemCode}: igst {igst} is not one of the allowed rates (0, 5, 12, 18, 28, 40).");
        if (cgst + sgst != igst)
            errors.Add($"Item {itemCode}: cgst ({cgst}) + sgst ({sgst}) = {cgst + sgst}, which does not equal igst ({igst}).");
        return errors;
    }

    /// <summary>Payloads doc section 8, Customer checks: "every customer has a DMS customer ID; GSTIN is 15 characters when registered; state is set." The DMS-customer-ID and
    /// state checks are structural on ZohoCreateContactRequest already ([Required]/[MinLength] on CustomFields and PlaceOfContact); this adds the one cross-field rule the
    /// attributes can't express on their own: a GST-registered customer (gst_treatment = business_gst) must actually carry a gst_no.</summary>
    public static List<string> ValidateCustomerGstConsistency(ZohoCreateContactRequest request)
    {
        var errors = new List<string>();
        if (string.Equals(request.GstTreatment, "business_gst", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(request.GstNo))
            errors.Add($"Customer {request.ContactName}: gst_treatment is business_gst but gst_no is missing.");
        return errors;
    }
}
