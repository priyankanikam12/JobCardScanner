using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-28 - the exact payload Zoho Books POSTs to DMS for a purchase bill event, field-for-field against
/// "BGauss_DMS_Zoho_Books_Purchase_Bills_and_Locations.docx" sections 3-4. This is the REVERSE direction from everything
/// else in this integration: Zoho calls DMS, not the other way round, so there is no ZohoBooksApiClient call here - this
/// is just the inbound request/response shape for ZohoPurchaseBillWebhookController.
/// </summary>
public class ZohoPurchaseBillLinePayload
{
    [JsonPropertyName("lineItemId")] [Required] public string LineItemId { get; set; } = "";
    [JsonPropertyName("itemCode")] [Required] public string ItemCode { get; set; } = "";
    [JsonPropertyName("itemName")] [Required] public string ItemName { get; set; } = "";
    /// <summary>"blank if not set" (section 4) - genuinely optional on this side too, unlike the outbound item push.</summary>
    [JsonPropertyName("hsnCode")] public string? HsnCode { get; set; }
    [JsonPropertyName("quantity")] [Range(0.0001, double.MaxValue, ErrorMessage = "quantity must be greater than 0.")] public decimal Quantity { get; set; }
    [JsonPropertyName("unit")] [Required] public string Unit { get; set; } = "";
    [JsonPropertyName("rate")] [Range(0, double.MaxValue)] public decimal Rate { get; set; }
    [JsonPropertyName("discount")] public decimal Discount { get; set; }
    [JsonPropertyName("taxName")] [Required] public string TaxName { get; set; } = "";
    [JsonPropertyName("taxPercentage")] [Range(0, 100)] public decimal TaxPercentage { get; set; }
    [JsonPropertyName("taxAmount")] public decimal TaxAmount { get; set; }
    [JsonPropertyName("lineTotal")] public decimal LineTotal { get; set; }
}

public class ZohoPurchaseBillWebhookPayload
{
    /// <summary>bill.created | bill.updated | bill.voided (section 2).</summary>
    [JsonPropertyName("event")] [Required] public string Event { get; set; } = "";
    /// <summary>Zoho's own bill id - THE match key (section 2: "No separate match-key field is used").</summary>
    [JsonPropertyName("billId")] [Required] public string BillId { get; set; } = "";
    [JsonPropertyName("billNumber")] [Required] public string BillNumber { get; set; } = "";
    [JsonPropertyName("billDate")] [Required] public string BillDate { get; set; } = ""; // YYYY-MM-DD
    [JsonPropertyName("status")] [Required] public string Status { get; set; } = "";
    [JsonPropertyName("referenceNumber")] public string? ReferenceNumber { get; set; }
    [JsonPropertyName("vendorId")] [Required] public string VendorId { get; set; } = "";
    [JsonPropertyName("vendorName")] [Required] public string VendorName { get; set; } = "";
    [JsonPropertyName("vendorGstin")] public string? VendorGstin { get; set; }
    [JsonPropertyName("sourceOfSupply")] [Required, StringLength(2, MinimumLength = 2)] public string SourceOfSupply { get; set; } = "";
    [JsonPropertyName("destinationOfSupply")] [Required, StringLength(2, MinimumLength = 2)] public string DestinationOfSupply { get; set; } = "";
    [JsonPropertyName("locationId")] [Required] public string LocationId { get; set; } = "";
    [JsonPropertyName("locationName")] [Required] public string LocationName { get; set; } = "";
    /// <summary>Section 7: the location_id -> dealerCode mapping. Sent by Zoho on every bill, but DMS should NOT blindly trust
    /// it as the sole source of truth until BGauss's own mapping (section 7's table) has been confirmed back to Learnall -
    /// see ValidateDealerCode in the controller.</summary>
    [JsonPropertyName("dealerCode")] [Required] public string DealerCode { get; set; } = "";
    [JsonPropertyName("subTotal")] public decimal SubTotal { get; set; }
    [JsonPropertyName("taxTotal")] public decimal TaxTotal { get; set; }
    [JsonPropertyName("total")] public decimal Total { get; set; }
    [JsonPropertyName("lines")] [Required, MinLength(1)] public List<ZohoPurchaseBillLinePayload> Lines { get; set; } = new();
}

/// <summary>What DMS replies with, success or error - section 6: "The reply DMS sends on success and on error, so Zoho
/// Books can record whether each bill was delivered." Kept deliberately simple (HTTP status + this body) rather than
/// mirroring Zoho's own {code,message} envelope, since DMS is the SERVER on this one call, not Zoho.</summary>
public class ZohoPurchaseBillWebhookReply
{
    public bool Success { get; set; }
    /// <summary>"accepted" (processed), "duplicate" (same event already processed - still a 200, not an error) or "error".</summary>
    public string Status { get; set; } = "";
    public string Message { get; set; } = "";
    public string? BillId { get; set; }
}
