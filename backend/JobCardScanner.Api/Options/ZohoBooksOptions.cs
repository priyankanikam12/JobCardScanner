namespace JobCardScanner.Api.Options;

/// <summary>
/// 2026-10-28 ("BGauss_DMS_Zoho_Books_API_Payloads.docx" + "BGauss_DMS_Zoho_Books_Fields_List.xlsx", both tested by Learnall against Magnemite's real Zoho Books org on 26.10.2026):
/// configuration for calling Zoho Books' OWN REST API directly (OAuth2), as that document specifies - NOT the same thing as the existing "ZohoPush:Provider = ZohoBooks" webhook-URL mode in
/// ZohoPushDispatcher (that mode posts to a Learnall-hosted proxy URL with BGauss's own field names and a custom `{code, response: {...}}` reply wrapper - built earlier, on 2026-10-16, from a
/// DIFFERENT, since-superseded document, "Zoho Books Item Push - Details for BGauss"). This options class is for the NEW, now-tested, direct-API integration: real Zoho endpoints
/// (www.zohoapis.in/books/v3), Zoho's own field names (sku, rate, hsn_or_sac, ...) and Zoho's own top-level `{code, message, item: {...}}` reply shape.
///
/// appsettings.json section "ZohoBooksApi" - every value except the Tax/Account/Location maps comes from Learnall "through a secure channel, never by email" (per the Payloads document, section 2):
///   ClientId / ClientSecret / RefreshToken   - OAuth2 credentials. NEVER put these in appsettings.json committed to source control - use user secrets or environment variables
///                                              (ZohoBooksApi__ClientSecret, ZohoBooksApi__RefreshToken) in every environment, the same convention already used for ZohoPush:ItemsUrl.
///   AccountsBaseUrl   default https://accounts.zoho.in          (India data centre - NOT the .com address, confirmed in the document, section 3)
///   ApiBaseUrl        default https://www.zohoapis.in/books/v3  (India data centre)
///   OrganizationId    60074559380 per the document - still read from config, not hardcoded, in case Magnemite's org id ever changes or a second org is added later.
///   RateLimitPerMinute default 100 - the document's stated Zoho limit for this organization; used to pace outgoing calls (see ZohoBooksApiClient's throttle), not to hard-cap them.
/// </summary>
public sealed class ZohoBooksOptions
{
    public const string SectionName = "ZohoBooksApi";

    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }
    public string? RefreshToken { get; set; }
    public string AccountsBaseUrl { get; set; } = "https://accounts.zoho.in";
    public string ApiBaseUrl { get; set; } = "https://www.zohoapis.in/books/v3";
    public string? OrganizationId { get; set; }
    public int RateLimitPerMinute { get; set; } = 100;

    /// <summary>Section 3 of the Payloads document, "Accounts, location and unit" table - Zoho account/location/unit IDs this org already has. FLAGGED in the source document itself:
    /// "The accounts and unit are Zoho defaults used in testing; Magnemite finance will confirm them before go-live." Do not treat these as final without that confirmation.</summary>
    public ZohoBooksAccounts Accounts { get; set; } = new();

    /// <summary>Section 3, "Tax IDs" table - GST % (0/5/12/18/28/40) to the matching intra-state (CGST+SGST) and inter-state (IGST) tax_id. Populate every rate the item/HSN catalog actually
    /// uses; an item whose GST % has no entry here cannot be pushed (ZohoBooksApiClient refuses it rather than guessing a tax_id) - this is intentional, not a bug: guessing a tax ID would mis-tax
    /// a real invoice.</summary>
    public Dictionary<string, ZohoTaxIdPair> TaxIdsByGstPercent { get; set; } = new();

    /// <summary>Dealer BAPL code (e.g. "CUS0288") to Zoho location_id. Only Delhi/CUS0288 (3898946000000032107) is confirmed in the document today - "Locations for the other branches will be
    /// added when created in Zoho." A dealer with no entry here cannot be pushed; see the same reasoning as TaxIdsByGstPercent above.</summary>
    public Dictionary<string, string> LocationIdsByDealerCode { get; set; } = new();

    /// <summary>Zoho's "unit" field - a NAME, not an id (section 3: 'Unit | pcs | name "pcs"'). Every item in the document's examples used "pcs"; if BGauss ever sells parts in a different unit,
    /// that unit name needs to already exist in Zoho Books before an item referencing it can be created.</summary>
    public string DefaultUnitName { get; set; } = "pcs";
}

public sealed class ZohoBooksAccounts
{
    /// <summary>Sales account (items, labour) - Zoho account id, section 3: "Sales" / 3898946000000000486 in testing.</summary>
    public string? SalesAccountId { get; set; }

    /// <summary>Purchase / cost account (items) - section 3: "Cost of Goods Sold" / 3898946000000000567 in testing. The document also flags: "purchase_rate: the rule is to be confirmed by
    /// Magnemite finance; the example uses the same value [as rate]" - ZohoBooksApiClient defaults purchase_rate to the same value as rate until finance says otherwise; see CreateItemAsync's
    /// own doc comment.</summary>
    public string? PurchaseAccountId { get; set; }

    /// <summary>Inventory account (items) - section 3: "Inventory Asset" / 3898946000000000626 in testing.</summary>
    public string? InventoryAccountId { get; set; }
}

public sealed class ZohoTaxIdPair
{
    /// <summary>Intra-state (CGST + SGST combined) tax_id for this GST %, e.g. GST18 = 3898946000000041139.</summary>
    public string? IntraStateTaxId { get; set; }

    /// <summary>Inter-state (IGST) tax_id for this GST %, e.g. IGST18 = 3898946000000041059.</summary>
    public string? InterStateTaxId { get; set; }
}
