using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace JobCardScanner.Api.Services.Zoho;

/// <summary>
/// 2026-10-28 - request/response shapes for Zoho Books' own REST API, field-for-field against "BGauss_DMS_Zoho_Books_API_Payloads.docx" (sections 4, 5, 6, 7) and the matching rows of
/// "BGauss_DMS_Zoho_Books_Fields_List.xlsx". Every property is named the way a C# caller would expect (PascalCase, our own vocabulary), and [JsonPropertyName] maps it to Zoho's EXACT wire
/// field name ("your payload name in our DTO", as asked) - so ZohoBooksApiClient serializes/deserializes directly against Zoho's real API without a hand-built JSON string anywhere.
/// [Required]/[RegularExpression]/[Range]/[StringLength] on the request DTOs implement section 8's "Checks the DMS must do before sending - Zoho does not check these and accepts wrong
/// values" list, via DataAnnotations (the other half of what was asked) - see ZohoBooksValidation.cs for how these are actually run and for the one cross-field rule (cgst + sgst = igst)
/// a single attribute can't express.
/// </summary>

// ============================================================================================================ shared

/// <summary>Every Zoho Books reply starts with these two fields, success or failure (Payloads doc, section 8: "Every Zoho reply has code and message; code 0 means success").</summary>
public class ZohoApiEnvelope
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }
}

/// <summary>error_info - present on some failure replies, e.g. code 2006 and code 120303 (Payloads doc, section 8), carrying the id of the conflicting record.</summary>
public class ZohoErrorInfo
{
    [JsonPropertyName("item_id")]
    public string? ItemId { get; set; }

    [JsonPropertyName("contact_id")]
    public string? ContactId { get; set; }
}

public class ZohoApiErrorResponse : ZohoApiEnvelope
{
    [JsonPropertyName("error_info")]
    public ZohoErrorInfo? ErrorInfo { get; set; }
}

// ============================================================================================================ 2. OAuth

/// <summary>Reply from POST https://accounts.zoho.in/oauth/v2/token (Payloads doc, section 2) - only the three fields the document says the DMS uses.</summary>
public class ZohoOAuthTokenResponse
{
    [JsonPropertyName("access_token")]
    public string AccessToken { get; set; } = "";

    [JsonPropertyName("api_domain")]
    public string? ApiDomain { get; set; }

    [JsonPropertyName("expires_in")]
    public int ExpiresInSeconds { get; set; }
}

// ============================================================================================================ 4. Items

/// <summary>item_tax_preferences entry - section 4.2: "both lines are always sent, for the item's GST %".</summary>
public class ZohoItemTaxPreference
{
    [JsonPropertyName("tax_id")]
    [Required]
    public string TaxId { get; set; } = "";

    /// <summary>"intra" or "inter" - literal values from the document's sample body (section 4.2); not an enum here so a value Zoho adds later still round-trips.</summary>
    [JsonPropertyName("tax_specification")]
    [Required]
    public string TaxSpecification { get; set; } = "";
}

/// <summary>POST /items body - Payloads doc section 4.2. DataAnnotations below implement section 8's item checks ("hsnCode is 8 digits; dealerPrice > 0; itemName is unique" - uniqueness
/// is NOT checkable by an attribute on a single object and is left to the caller, see ZohoBooksApiClient.CreateItemAsync's own doc comment).</summary>
public class ZohoCreateItemRequest
{
    [JsonPropertyName("name")]
    [Required(ErrorMessage = "itemName is required.")]
    [StringLength(400)]
    public string Name { get; set; } = "";

    /// <summary>The DMS item code - Zoho's unique match key for every later update (Payloads doc section 1: "For items the ID is the item code, stored in the Zoho SKU field.").</summary>
    [JsonPropertyName("sku")]
    [Required(ErrorMessage = "itemCode is required.")]
    [StringLength(100)]
    public string Sku { get; set; } = "";

    /// <summary>Fixed value on every item (Fields List, "Item" sheet) - "goods".</summary>
    [JsonPropertyName("product_type")]
    [Required]
    public string ProductType { get; set; } = "goods";

    /// <summary>Fixed value on every item - "inventory" (this is what makes Zoho track stock for the item; section 4.2's reply confirms `item_type inventory` and `track_inventory true`).</summary>
    [JsonPropertyName("item_type")]
    [Required]
    public string ItemType { get; set; } = "inventory";

    /// <summary>Fixed value on every item - from ZohoBooksOptions.DefaultUnitName ("pcs" in every tested example).</summary>
    [JsonPropertyName("unit")]
    [Required]
    public string Unit { get; set; } = "";

    /// <summary>2026-10-28 - per Zoho's "Held-back items: HSN and price are not mandatory" email: no longer [Required]. Nullable + JsonIgnore(WhenWritingNull) so a missing HSN
    /// is left OUT of the JSON entirely ("leave those fields out and Zoho creates the item with a blank HSN"), not sent as "" or null. The regex still gates a HSN that IS
    /// present but malformed (section 8: "hsnCode is 8 digits" - Zoho itself does not check this, so BGauss still gates a present-but-wrong value before sending).</summary>
    [JsonPropertyName("hsn_or_sac")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [RegularExpression(@"^\d{8}$", ErrorMessage = "hsnCode, when present, must be exactly 8 digits.")]
    public string? HsnOrSac { get; set; }

    /// <summary>2026-10-28 - per the same email: price is no longer mandatory either ("leave those fields out and Zoho creates the item ... with rate 0"). Nullable +
    /// JsonIgnore(WhenWritingNull) so a missing price is omitted rather than sent as 0. Still blocks a NEGATIVE rate if one is present (dealerPrice / (1 + igst/100) should
    /// never be negative in practice, so this only guards against a mapping bug, not a legitimate business case).</summary>
    [JsonPropertyName("rate")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [Range(0, double.MaxValue, ErrorMessage = "dealerPrice (after removing GST), when present, must not be negative.")]
    public decimal? Rate { get; set; }

    [JsonPropertyName("account_id")]
    [Required]
    public string AccountId { get; set; } = "";

    /// <summary>"the rule is to be confirmed by Magnemite finance; the example uses the same value [as rate]" (section 4.2) - ZohoItemMapper defaults this to Rate until that confirmation
    /// arrives; flagged again here so the field is never silently left at 0.</summary>
    [JsonPropertyName("purchase_rate")]
    public decimal? PurchaseRate { get; set; }

    [JsonPropertyName("purchase_account_id")]
    [Required]
    public string PurchaseAccountId { get; set; } = "";

    [JsonPropertyName("inventory_account_id")]
    [Required]
    public string InventoryAccountId { get; set; } = "";

    [JsonPropertyName("item_tax_preferences")]
    [Required, MinLength(2, ErrorMessage = "Both the intra-state and inter-state tax lines must be sent (section 4.2).")]
    public List<ZohoItemTaxPreference> ItemTaxPreferences { get; set; } = new();
}

/// <summary>PUT /items/{id} body - section 4.3: "Send only the fields that changed. Fields not sent stay as they are." Every property is nullable/omit-if-null for exactly that reason -
/// see the [JsonIgnore] condition applied where this is serialized in ZohoBooksApiClient.UpdateItemAsync.</summary>
public class ZohoUpdateItemRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("hsn_or_sac")]
    [RegularExpression(@"^\d{8}$", ErrorMessage = "hsnCode must be exactly 8 digits.")]
    public string? HsnOrSac { get; set; }

    [JsonPropertyName("rate")]
    [Range(0.01, double.MaxValue, ErrorMessage = "dealerPrice (after removing GST) must be greater than 0.")]
    public decimal? Rate { get; set; }

    [JsonPropertyName("purchase_rate")]
    public decimal? PurchaseRate { get; set; }

    [JsonPropertyName("item_tax_preferences")]
    public List<ZohoItemTaxPreference>? ItemTaxPreferences { get; set; }
}

public class ZohoItem
{
    [JsonPropertyName("item_id")]
    public string ItemId { get; set; } = "";

    [JsonPropertyName("sku")]
    public string? Sku { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>"active" or "inactive" - section 4.1: "Read items[0].item_id and items[0].status from the reply."</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("rate")]
    public decimal? Rate { get; set; }

    [JsonPropertyName("item_type")]
    public string? ItemType { get; set; }

    [JsonPropertyName("track_inventory")]
    public bool? TrackInventory { get; set; }
}

/// <summary>GET /items?sku=... reply (section 4.1) - "Exact match ..., and inactive items are included."</summary>
public class ZohoItemListResponse : ZohoApiEnvelope
{
    [JsonPropertyName("items")]
    public List<ZohoItem> Items { get; set; } = new();
}

/// <summary>POST/PUT /items reply (sections 4.2/4.3) - singular "item".</summary>
public class ZohoItemResponse : ZohoApiEnvelope
{
    [JsonPropertyName("item")]
    public ZohoItem? Item { get; set; }
}

// ============================================================================================================ 5. Inventory adjustments

/// <summary>line_items[] entry - section 5.</summary>
public class ZohoInventoryAdjustmentLineItem
{
    [JsonPropertyName("item_id")]
    [Required]
    public string ItemId { get; set; } = "";

    /// <summary>Section 8 check: "not 0" - "+ adds stock, - removes stock" (Fields List, "Inventory Adjustment" sheet).</summary>
    [JsonPropertyName("quantity_adjusted")]
    [Range(double.MinValue, double.MaxValue)]
    public decimal QuantityAdjusted { get; set; }

    [JsonPropertyName("location_id")]
    [Required]
    public string LocationId { get; set; } = "";
}

/// <summary>POST /inventoryadjustments body - section 5. adjustment_type is always "quantity" per the sample body; reason is free text, Zoho creates a new one the first time.</summary>
public class ZohoCreateInventoryAdjustmentRequest
{
    [JsonPropertyName("date")]
    [Required]
    public string Date { get; set; } = ""; // YYYY-MM-DD

    [JsonPropertyName("reason")]
    [Required(ErrorMessage = "reason is required.")]
    public string Reason { get; set; } = "";

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    /// <summary>The DMS adjustment number - section 8 check: "Unique in the DMS."</summary>
    [JsonPropertyName("reference_number")]
    [Required(ErrorMessage = "adjustment number is required.")]
    public string ReferenceNumber { get; set; } = "";

    [JsonPropertyName("adjustment_type")]
    public string AdjustmentType { get; set; } = "quantity";

    [JsonPropertyName("location_id")]
    [Required]
    public string LocationId { get; set; } = "";

    [JsonPropertyName("line_items")]
    [Required, MinLength(1)]
    public List<ZohoInventoryAdjustmentLineItem> LineItems { get; set; } = new();
}

public class ZohoInventoryAdjustment
{
    [JsonPropertyName("inventory_adjustment_id")]
    public string InventoryAdjustmentId { get; set; } = "";

    [JsonPropertyName("status")]
    public string? Status { get; set; }
}

public class ZohoInventoryAdjustmentResponse : ZohoApiEnvelope
{
    [JsonPropertyName("inventory_adjustment")]
    public ZohoInventoryAdjustment? InventoryAdjustment { get; set; }
}

// ============================================================================================================ 6. Customers (contacts)

public class ZohoBillingAddress
{
    [JsonPropertyName("address")]
    public string? Address { get; set; }

    [JsonPropertyName("street2")]
    public string? Street2 { get; set; }

    [JsonPropertyName("city")]
    public string? City { get; set; }

    [JsonPropertyName("state")]
    public string? State { get; set; }

    [JsonPropertyName("zip")]
    public string? Zip { get; set; }

    [JsonPropertyName("country")]
    public string Country { get; set; } = "India";
}

/// <summary>contact_persons[] entry - section 6.2: "Mobile and email go in contact_persons (first_name, mobile, email, is_primary_contact true)."</summary>
public class ZohoContactPerson
{
    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("mobile")]
    public string? Mobile { get; set; }

    [JsonPropertyName("email")]
    public string? Email { get; set; }

    [JsonPropertyName("is_primary_contact")]
    public bool IsPrimaryContact { get; set; } = true;
}

public class ZohoCustomField
{
    [JsonPropertyName("api_name")]
    [Required]
    public string ApiName { get; set; } = "";

    [JsonPropertyName("value")]
    [Required]
    public string Value { get; set; } = "";
}

/// <summary>POST /contacts body - section 6.2. Section 8 checks: "every customer has a DMS customer ID; GSTIN is 15 characters when registered; state is set" - the DMS customer ID check
/// is structural here (CustomFields is required/non-empty, enforced in ZohoBooksApiClient.CreateCustomerAsync rather than via an attribute, since it must specifically be the
/// cf_bgauss_dms_customer_id entry, not just any custom field).</summary>
public class ZohoCreateContactRequest
{
    [JsonPropertyName("contact_name")]
    [Required(ErrorMessage = "ledgerName is required.")]
    [StringLength(200)]
    public string ContactName { get; set; } = "";

    [JsonPropertyName("company_name")]
    public string? CompanyName { get; set; }

    [JsonPropertyName("contact_type")]
    public string ContactType { get; set; } = "customer";

    /// <summary>"business" or "individual" (section 6.2 / 8.5 of the Fields List).</summary>
    [JsonPropertyName("customer_sub_type")]
    [Required]
    public string CustomerSubType { get; set; } = "business";

    /// <summary>business_gst | business_none | consumer (section 6.2: "Registered business: gst_treatment business_gst + gst_no. Business without GSTIN: business_none. Individual:
    /// customer_sub_type individual, gst_treatment consumer.").</summary>
    [JsonPropertyName("gst_treatment")]
    [Required]
    public string GstTreatment { get; set; } = "";

    /// <summary>Section 8 check: "GSTIN is 15 characters when registered" - only validated when present; a business_none/consumer contact correctly sends none.</summary>
    [JsonPropertyName("gst_no")]
    [RegularExpression(@"^[0-9A-Z]{15}$", ErrorMessage = "gstin must be exactly 15 characters when the customer is GST-registered.")]
    public string? GstNo { get; set; }

    /// <summary>2-letter state code (DL, TN, MH, KA, TS, GJ, ... - section 6.2). Section 8 check: "state is set."</summary>
    [JsonPropertyName("place_of_contact")]
    [Required(ErrorMessage = "state (2-letter code) is required.")]
    [StringLength(2, MinimumLength = 2)]
    public string PlaceOfContact { get; set; } = "";

    [JsonPropertyName("billing_address")]
    public ZohoBillingAddress? BillingAddress { get; set; }

    [JsonPropertyName("contact_persons")]
    public List<ZohoContactPerson>? ContactPersons { get; set; }

    [JsonPropertyName("custom_fields")]
    [Required, MinLength(1, ErrorMessage = "custom_fields must carry cf_bgauss_dms_customer_id (section 8: every customer needs a DMS customer ID).")]
    public List<ZohoCustomField> CustomFields { get; set; } = new();
}

public class ZohoContact
{
    [JsonPropertyName("contact_id")]
    public string ContactId { get; set; } = "";

    [JsonPropertyName("contact_name")]
    public string? ContactName { get; set; }

    [JsonPropertyName("custom_fields")]
    public List<ZohoCustomField>? CustomFields { get; set; }
}

/// <summary>GET /contacts?cf_bgauss_dms_customer_id=... reply - section 6.1.</summary>
public class ZohoContactListResponse : ZohoApiEnvelope
{
    [JsonPropertyName("contacts")]
    public List<ZohoContact> Contacts { get; set; } = new();
}

public class ZohoContactResponse : ZohoApiEnvelope
{
    [JsonPropertyName("contact")]
    public ZohoContact? Contact { get; set; }
}

// ============================================================================================================ 7. Invoices

/// <summary>line_items[] entry - section 7.1. "Paid lines: rate without GST; discount = the line discount amount in rupees. FOC/U-W lines: rate 0."</summary>
public class ZohoInvoiceLineItem
{
    [JsonPropertyName("item_id")]
    [Required]
    public string ItemId { get; set; } = "";

    [JsonPropertyName("description")]
    [Required]
    public string Description { get; set; } = "";

    [JsonPropertyName("quantity")]
    [Range(0.0001, double.MaxValue, ErrorMessage = "qty must be greater than 0.")]
    public decimal Quantity { get; set; }

    [JsonPropertyName("rate")]
    [Range(0, double.MaxValue)]
    public decimal Rate { get; set; }

    /// <summary>Rupee discount amount, Paid lines only (Fields List, "Invoice Line" sheet) - omitted (null) for FOC/U-W lines rather than sent as 0, matching the document's sample body
    /// where FOC/U-W lines carry no discount key at all.</summary>
    [JsonPropertyName("discount")]
    public decimal? Discount { get; set; }

    [JsonPropertyName("tax_id")]
    [Required]
    public string TaxId { get; set; } = "";
}

/// <summary>POST /invoices?ignore_auto_number_generation=true body - section 7.1. Section 8 checks: "status is Billed; every line has issueType Paid, FOC or U/W; every itemCode is already
/// in Zoho; the DMS customer ID is sent with every bill" - the "status Billed" and "DMS customer ID present" checks are enforced by the caller before building this DTO (ZohoInvoiceMapper),
/// since they depend on the source RepairBillDoc, not on this request body alone.</summary>
public class ZohoCreateInvoiceRequest
{
    [JsonPropertyName("customer_id")]
    [Required(ErrorMessage = "The Zoho contact_id (resolved via the DMS customer ID, section 6) is required.")]
    public string CustomerId { get; set; } = "";

    /// <summary>The DMS bill number - section 8 check: "Unique; never reused."</summary>
    [JsonPropertyName("invoice_number")]
    [Required(ErrorMessage = "billNumber is required.")]
    public string InvoiceNumber { get; set; } = "";

    [JsonPropertyName("reference_number")]
    public string? ReferenceNumber { get; set; } // jobCardNumber

    [JsonPropertyName("date")]
    [Required]
    public string Date { get; set; } = ""; // YYYY-MM-DD

    [JsonPropertyName("location_id")]
    [Required]
    public string LocationId { get; set; } = "";

    [JsonPropertyName("discount_type")]
    public string DiscountType { get; set; } = "item_level";

    [JsonPropertyName("is_discount_before_tax")]
    public bool IsDiscountBeforeTax { get; set; } = true;

    [JsonPropertyName("custom_fields")]
    public List<ZohoCustomField>? CustomFields { get; set; }

    [JsonPropertyName("line_items")]
    [Required, MinLength(1, ErrorMessage = "At least one line item is required.")]
    public List<ZohoInvoiceLineItem> LineItems { get; set; } = new();

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}

public class ZohoInvoice
{
    [JsonPropertyName("invoice_id")]
    public string InvoiceId { get; set; } = "";

    [JsonPropertyName("invoice_number")]
    public string? InvoiceNumber { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("sub_total")]
    public decimal? SubTotal { get; set; }

    [JsonPropertyName("total")]
    public decimal? Total { get; set; }
}

public class ZohoInvoiceResponse : ZohoApiEnvelope
{
    [JsonPropertyName("invoice")]
    public ZohoInvoice? Invoice { get; set; }
}

public class ZohoInvoiceListResponse : ZohoApiEnvelope
{
    [JsonPropertyName("invoices")]
    public List<ZohoInvoice> Invoices { get; set; } = new();
}

// ============================================================================================================ result wrapper used by ZohoBooksApiClient

/// <summary>What every ZohoBooksApiClient call returns - the Zoho-specific error handling (section 8's table) already applied, so callers (ZohoPushDispatcher, controllers) only ever see
/// Success/Data or a plain, already-classified failure.</summary>
public sealed class ZohoBooksResult<T>
{
    public bool Success { get; init; }
    public T? Data { get; init; }
    public int? HttpStatus { get; init; }
    public int? ZohoCode { get; init; }
    public string? Message { get; init; }
    /// <summary>True when the failure is one section 8 says to retry (401/code 57 after a refresh already failed, HTTP 429, a network error) - false for anything section 8 says not to
    /// retry (1001, 4023, any other non-zero code).</summary>
    public bool Retryable { get; init; }
    /// <summary>For code 2006 ("Invoice cannot be raised for items that have been deleted or marked as inactive") and 120303 (duplicate DMS id) - the conflicting item_id/contact_id from
    /// error_info, so the caller can act on it (section 8: "Re-activate the item (4.4), then send the bill again").</summary>
    public string? ConflictingId { get; init; }

    public static ZohoBooksResult<T> Ok(T data, int httpStatus, int zohoCode, string? message) =>
        new() { Success = true, Data = data, HttpStatus = httpStatus, ZohoCode = zohoCode, Message = message };

    public static ZohoBooksResult<T> Fail(int? httpStatus, int? zohoCode, string? message, bool retryable, string? conflictingId = null) =>
        new() { Success = false, HttpStatus = httpStatus, ZohoCode = zohoCode, Message = message, Retryable = retryable, ConflictingId = conflictingId };
}
