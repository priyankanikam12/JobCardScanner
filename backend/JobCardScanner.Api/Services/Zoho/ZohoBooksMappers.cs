using JobCardScanner.Api.Options;

namespace JobCardScanner.Api.Services.Zoho;

/// <summary>
/// 2026-10-28 - turns the DMS's own data shapes into the Zoho Books request DTOs (ZohoBooksDtos.cs), field-for-field against "BGauss_DMS_Zoho_Books_Fields_List.xlsx". This is
/// the layer that knows the DMS's column names (ItemCode, DealerPrice, LedgerName, ...); ZohoBooksApiClient only ever sees Zoho's own vocabulary.
///
/// NOT included here: the repair-bill / invoice mapper (Fields List sheets "Invoice Header" and "Invoice Line"). That needs the actual repair-bill source (RepairBillDoc /
/// RepairBillLine or equivalent - whatever table backs GET /api/zoho/repair-bills in ZohoIntegrationController), which was not part of what was shared in this conversation.
/// ZOHO_BOOKS_INTEGRATION.md shows the exact shape the mapper would need to build (a ZohoCreateInvoiceRequest, per Payloads doc section 7) so it can be added the same way
/// once that source is available.
/// </summary>
public static class ZohoBooksMappers
{
    // ============================================================================================================ items

    /// <summary>Fields List, "Item" sheet - ItemData is ZohoPushStore's existing row shape (ItemCode, ItemName, HsnCode, DealerPrice, Sgst, Cgst, Igst, Status), already read
    /// straight off dbo.C_ItemMaster by ZohoPushStore.EnqueueItemsAsync. Returns null + the validation errors when the item fails a section-8 check (igst not an allowed
    /// rate, cgst+sgst != igst, or there is no TaxIdsByGstPercent / Accounts entry for this item's GST % yet) - ZohoBooksApiClient.UpsertItemAsync must not be called in that
    /// case; log the errors and leave the item queued/held back instead (the same "SkipInvalidItems" idea ZohoPushStore already applies for the old webhook mode).</summary>
    public static (ZohoCreateItemRequest? Request, bool ShouldBeActive, List<string> Errors) ToCreateItemRequest(ZohoPushStore.ItemData item, ZohoBooksOptions options)
    {
        var errors = new List<string>();
        var igst = item.Igst ?? 0m;
        var cgst = item.Cgst ?? 0m;
        var sgst = item.Sgst ?? 0m;
        errors.AddRange(ZohoBooksValidation.ValidateItemGst(item.ItemCode, igst, cgst, sgst));

        var gstKey = igst.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);
        if (!options.TaxIdsByGstPercent.TryGetValue(gstKey, out var taxIds) || string.IsNullOrWhiteSpace(taxIds.IntraStateTaxId) || string.IsNullOrWhiteSpace(taxIds.InterStateTaxId))
            errors.Add($"Item {item.ItemCode}: no ZohoBooksApi:TaxIdsByGstPercent entry for GST {gstKey}% - add it (Payloads doc section 3) before this item can be pushed.");

        if (string.IsNullOrWhiteSpace(options.Accounts.SalesAccountId) || string.IsNullOrWhiteSpace(options.Accounts.PurchaseAccountId) || string.IsNullOrWhiteSpace(options.Accounts.InventoryAccountId))
            errors.Add($"Item {item.ItemCode}: ZohoBooksApi:Accounts (SalesAccountId/PurchaseAccountId/InventoryAccountId) is not fully configured.");

        // 2026-10-28 - per Zoho's "Held-back items: HSN and price are not mandatory" email, a bad/missing HSN or price no longer holds the item back. A HSN that IS present
        // but not exactly 8 digits is still rejected (Zoho won't check it, so garbage would go in silently) - it is just not REQUIRED to be present at all any more. Same for
        // price: present-and-negative is rejected (a mapping bug), missing/zero is sent through with the field left out so "Zoho creates the item with ... rate 0" (the
        // documented behaviour), rather than held back pending a price BGauss may not have yet.
        var rawHsn = (item.HsnCode ?? "").Trim();
        string? hsn = null;
        if (rawHsn.Length > 0)
        {
            if (rawHsn.Length is not (4 or 6 or 8) || !rawHsn.All(char.IsDigit))
                errors.Add($"Item {item.ItemCode}: hsnCode '{item.HsnCode}' is present but not exactly 4, 6, or 8 digits (section 8) - fix it or clear it, do not send it as-is.");
            else
                hsn = rawHsn;
        }

        var dealerPrice = item.DealerPrice ?? 0m;
        if (dealerPrice < 0)
            errors.Add($"Item {item.ItemCode}: dealerPrice {dealerPrice} is negative - that looks like a data error, not a legitimately-unpriced item.");

        var name = (string.IsNullOrWhiteSpace(item.DisplayName) ? item.ItemName : item.DisplayName)?.Trim() ?? "";
        if (name.Length == 0)
            errors.Add($"Item {item.ItemCode}: itemName is blank.");

        if (errors.Count > 0) return (null, false, errors);

        // rate = dealerPrice / (1 + igst/100), 2 decimals (Fields List, "Item" sheet; Payloads doc section 4.2 example: 1311 / 1.18 = 1111.02) - null (omitted) when there is
        // no price yet, rather than sending a fabricated 0 that would look like a real zero rate.
        decimal? rate = dealerPrice > 0 ? Math.Round(dealerPrice / (1 + igst / 100m), 2, MidpointRounding.AwayFromZero) : null;

        var request = new ZohoCreateItemRequest
        {
            Name = name,
            Sku = item.ItemCode,
            Unit = options.DefaultUnitName,
            HsnOrSac = hsn,
            Rate = rate,
            AccountId = options.Accounts.SalesAccountId!,
            // "the rule is to be confirmed by Magnemite finance; the example uses the same value [as rate]" (section 4.2) - defaulted here until that confirmation arrives
            PurchaseRate = rate,
            PurchaseAccountId = options.Accounts.PurchaseAccountId!,
            InventoryAccountId = options.Accounts.InventoryAccountId!,
            ItemTaxPreferences = new List<ZohoItemTaxPreference>
            {
                new() { TaxId = taxIds?.IntraStateTaxId!, TaxSpecification = "intra" },
                new() { TaxId = taxIds?.InterStateTaxId!, TaxSpecification = "inter" },
            },
        };
        var shouldBeActive = string.Equals(item.Status?.Trim(), "Y", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(item.Status);
        return (request, shouldBeActive, errors);
    }

    // ============================================================================================================ customers

    /// <summary>Fields List, "Customer" sheet - the same columns ZohoPushStore.BuildCustomerDataAsync already reads off LedgerMaster (ZohoIntegrationController /
    /// ZohoMasterDataController), just named rather than anonymous so this mapper can take them without reflection. Deliberately NOT ZohoPushStore's own anonymous return
    /// type: see ZOHO_BOOKS_INTEGRATION.md for why customer push for the direct API is built at INVOICE TIME from a fresh LedgerMaster read, not from the existing
    /// proactive customer.created/.updated outbox events - this type is what that invoice-time code builds and passes in, with no change needed to ZohoPushStore.cs at all.</summary>
    public sealed class ZohoCustomerSource
    {
        public Guid CustomerId { get; set; }                 // LedgerMaster.Id - the DMS customer ID (section 1 / 6)
        public string? LedgerCode { get; set; }
        public string? LedgerName { get; set; }
        public string? LedgerType { get; set; }               // "Party" or "Insurance"
        public string? MobileNumber { get; set; }
        public string? Email { get; set; }
        public string? Address { get; set; }
        public string? Address2 { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public string? Pin { get; set; }
        public string? Gstin { get; set; }
        /// <summary>null = use LedgerName as the Zoho company_name too (matches the Payloads doc's sample body, which repeats the same name in both fields).</summary>
        public string? CompanyNameOverride { get; set; }
    }

    public static (ZohoCreateContactRequest? Request, List<string> Errors) ToCreateContactRequest(ZohoCustomerSource customer, ZohoBooksOptions options)
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(customer.LedgerName))
            errors.Add($"Customer {customer.LedgerCode}: ledgerName is blank.");

        var gstin = (customer.Gstin ?? "").Trim().ToUpperInvariant();
        var isRegistered = gstin.Length > 0;
        if (isRegistered && gstin.Length != 15)
            errors.Add($"Customer {customer.LedgerCode}: gstin '{customer.Gstin}' is not exactly 15 characters (section 8).");

        var stateCode = MapStateToTwoLetterCode(customer.State);
        if (stateCode is null)
            errors.Add($"Customer {customer.LedgerCode}: state '{customer.State}' does not map to one of the known 2-letter codes (DL, TN, MH, KA, TS, GJ, ...) - " +
                       "add it to MapStateToTwoLetterCode, or confirm the code with Learnall (section 6.2).");

        var isIndividual = string.Equals(customer.LedgerType, "Party", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(customer.Gstin) && string.IsNullOrWhiteSpace(customer.CompanyNameOverride);
        // NOTE: the DMS does not currently carry an explicit "business vs individual" flag in what was shared - this infers it from the presence of a GSTIN, which matches
        // the document's own description ("Registered business: business_gst + gst_no. Business without GSTIN: business_none. Individual: customer_sub_type individual,
        // gst_treatment consumer.") but should be confirmed with Vijay/Learnall before go-live, not treated as settled by this inference alone.

        if (errors.Count > 0) return (null, errors);

        var request = new ZohoCreateContactRequest
        {
            ContactName = customer.LedgerName!,
            CompanyName = isIndividual ? null : (customer.CompanyNameOverride ?? customer.LedgerName),
            CustomerSubType = isIndividual ? "individual" : "business",
            GstTreatment = isIndividual ? "consumer" : (isRegistered ? "business_gst" : "business_none"),
            GstNo = isRegistered ? gstin : null,
            PlaceOfContact = stateCode!,
            BillingAddress = new ZohoBillingAddress
            {
                Address = customer.Address,
                Street2 = customer.Address2,
                City = customer.City,
                State = customer.State,
                Zip = customer.Pin,
            },
            ContactPersons = (customer.MobileNumber is not null || customer.Email is not null)
                ? new List<ZohoContactPerson> { new() { FirstName = customer.LedgerName, Mobile = customer.MobileNumber, Email = customer.Email, IsPrimaryContact = true } }
                : null,
            CustomFields = new List<ZohoCustomField> { new() { ApiName = "cf_bgauss_dms_customer_id", Value = customer.CustomerId.ToString() } },
        };
        return (request, errors);
    }

    /// <summary>Section 6.2's five confirmed codes (DL, TN, MH, KA, TS, GJ). A state outside this list returns null rather than guessing - sending the wrong
    /// place_of_contact would mis-tax a real invoice (the same reasoning ZohoBooksOptions.TaxIdsByGstPercent uses for an unmapped GST rate). Extend this table as
    /// Magnemite's dealer footprint grows; do not add a fallback that guesses.</summary>
    private static string? MapStateToTwoLetterCode(string? state) => (state ?? "").Trim().ToUpperInvariant() switch
    {
        "DELHI" or "NEW DELHI" or "DL" => "DL",
        "TAMIL NADU" or "TN" => "TN",
        "MAHARASHTRA" or "MH" => "MH",
        "KARNATAKA" or "KA" => "KA",
        "TELANGANA" or "TS" => "TS",
        "GUJARAT" or "GJ" => "GJ",
        _ => null,
    };
}
