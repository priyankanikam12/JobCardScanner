using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

/// <summary>
/// 2026-09-19 "now i want Create Repair Bill and Material Transfer Bill ... i want to now this
/// both pages data i want save in JobCardScannerDb", corrected 2026-09-21 ("backend logic which i
/// gave u ... same make only according to our project dont chnage Repair Bill and Material
/// tranfer logic") - a Repair Bill created directly inside JobCardScanner (own, writable
/// database), NOT a mirror of DMS's own RepairBillHeader/RepairBillDetail tables (those live
/// in BAPLDMSvad, which this app never writes to) and NOT the same thing as the "Repair Bill
/// Report" page's DmsBaplDataRepairBillRow (a read-only DMSBAPLDATA sync).
///
/// Field set and the actions below (Insert/Update/Delete/search) are ported field-for-field and
/// rule-for-rule from the reference DMS_BAPL_Api RepairBillController/RepairBillRepo/
/// RepairBillHeader/RepairBillDetail you pasted - re-checked against that exact pasted source on
/// 2026-09-21, not re-derived from memory. What could NOT be ported as-is, because the underlying
/// master data doesn't exist in JobCardScannerDb, is disclosed at the point it's used below
/// (Insurance/CustomerLedger/PartWiseLabour/ItemMaster all live in BAPLDMSvad only). Two corrections
/// from the first version of this file:
///  1. The reference's InsertRepairBill/UpdateRepairBill NEVER compute CGST/SGST/IGST themselves -
///     they persist whatever amounts+percentages the CALLER already computed (Angular did that,
///     reading LabourMaster/PartWiseLabour's own stored Cgst/Sgst/Igst percentages). The first
///     version of this file instead had the controller GUESS an IGST-vs-CGST+SGST split by
///     comparing Customer.State to Dealer.State - a rule the reference never had. That guess has
///     been removed: RepairBillDocItem now carries three independent CgstPct/SgstPct/IgstPct
///     fields, same shape as the reference's LabourMaster/PartWiseLabour-sourced rates, and the
///     controller only does the arithmetic (rate% x taxable amount) - never decides which rates
///     apply.
///  2. Discount (DiscountType/DiscountValue per line) and the header's TotalDiscount/
///     AmountReceived/insurance-claim fields, all present on the reference's RepairBillHeader/
///     RepairBillDetail, were missing from the first version - added back below.
/// </summary>
public enum RepairBillDocStatus { Performa, Billed, Cancelled }

public enum RepairBillDocItemType { Part, Labour }

public class RepairBillDoc
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Minted via IJobCardNumberingService.NextRepairBillNumberAsync, e.g. "RB-DL01-2026-000001" -
    /// same per-dealer Counter-table convention as Estimate/Invoice numbers, NOT DMS's own
    /// invoice numbering (this bill never touches DMS).</summary>
    [Required, MaxLength(40)] public string BillNumber { get; set; } = default!;

    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }

    /// <summary>Optional link to the JobCardScanner job card this bill was raised against - null
    /// for a bill entered standalone (e.g. against a fleet party like Zomato with no job card of
    /// its own in this app), matching the reference app's own "job card is one of several ways a
    /// repair bill can originate" behaviour.</summary>
    public Guid? JobCardId { get; set; }
    public JobCard? JobCard { get; set; }

    public Guid? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public Guid? VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    /// <summary>Bill-to name - the customer's name for a walk-in, or a fleet party name (e.g.
    /// "Zomato") for a fleet bill with no JobCardScanner Customer record of its own.</summary>
    [Required, MaxLength(200)] public string PartyName { get; set; } = default!;
    [MaxLength(30)] public string? RegNo { get; set; }
    [MaxLength(50)] public string? ChassisNo { get; set; }
    /// <summary>Free-text workshop location label (e.g. dealer's own city/workshop name) - this
    /// app has no DMS LocCode of its own to store here, unlike the DMSBAPLDATA-sourced report.</summary>
    [MaxLength(150)] public string? Location { get; set; }
    /// <summary>Free-text bill type, e.g. "Cash", "Credit", "Warranty" - kept as text rather than
    /// an enum since the reference app's own BillType is itself a loosely-defined lookup value,
    /// not a small fixed set worth hard-coding here.</summary>
    [MaxLength(60)] public string? BillType { get; set; }
    /// <summary>CORRECTED 2026-09-21: the reference's IssueType (IssutypeId) actually lives per
    /// LINE, on RepairBillDetail - RepairBillHeader itself has no such column (confirmed by
    /// re-reading that entity). This bill-level field is this app's own default/fallback only -
    /// used to prefill each new line, and as the tax-zeroing value for any line whose own
    /// RepairBillDocItem.IssueType is null (e.g. a line saved before the per-line field existed).
    /// See RepairBillDocItem.IssueType for where the real, authoritative value now lives.</summary>
    [MaxLength(30)] public string? IssueType { get; set; }

    public RepairBillDocStatus Status { get; set; } = RepairBillDocStatus.Performa;

    // ---- Insurance claim fields - reference RepairBillHeader.InsuranceId/InsDecription/
    // SurveyorName/ContactNumber/PolicyNo/InsValidTill/ZeroDepo. The reference's InsuranceId is a
    // FK into BAPLDMSvad's own LedgerMaster (an insurance-company ledger row) - JobCardScannerDb
    // has no ledger/insurance-company master at all, so this is captured as free text (company
    // name) rather than fabricating a master table nothing else in this app would ever populate. ----
    [MaxLength(200)] public string? InsuranceCompanyName { get; set; }
    [MaxLength(500)] public string? InsuranceDescription { get; set; }
    [MaxLength(150)] public string? SurveyorName { get; set; }
    [MaxLength(30)] public string? SurveyorContactNumber { get; set; }
    [MaxLength(60)] public string? PolicyNo { get; set; }
    public DateOnly? InsuranceValidTill { get; set; }
    /// <summary>Reference: RepairBillHeader.ZeroDepo - a "zero depreciation" insurance add-on flag.</summary>
    public bool ZeroDepreciation { get; set; }

    // ---- Reference: RepairBillHeader.TotalDiscount/AmountReceived (TotalTaxableAmount/
    // TotalNetAmount below are this row's TaxableAmount/TotalAmount, same header-level rollup). ----
    [Column(TypeName = "decimal(12,2)")] public decimal TotalDiscount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal AmountReceived { get; set; }

    [Column(TypeName = "decimal(12,2)")] public decimal TaxableAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal CgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal SgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal IgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal TotalAmount { get; set; }

    [MaxLength(1000)] public string? Remarks { get; set; }

    /// <summary>Reference: RepairBillHeader.IsDelete - a soft delete, not a hard row removal, set
    /// only via RepairBillDocsController.Delete's SuperAdmin-equivalent (SystemAdminOnly) gate,
    /// same authorization rule as the reference's DeleteRepairbill("Only SuperAdmin can delete").</summary>
    public bool IsDeleted { get; set; }

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public User? UpdatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateOnly BillDate { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow);

    public ICollection<RepairBillDocItem> Items { get; set; } = new List<RepairBillDocItem>();
}

public class RepairBillDocItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RepairBillDocId { get; set; }
    public RepairBillDoc? RepairBillDoc { get; set; }

    public RepairBillDocItemType ItemType { get; set; }
    [Required, MaxLength(60)] public string ItemCode { get; set; } = default!;
    [Required, MaxLength(300)] public string ItemDescription { get; set; } = default!;
    [MaxLength(20)] public string? HsnCode { get; set; }

    /// <summary>Reference: RepairBillDetail.IssutypeId - confirmed (by directly re-reading that
    /// entity, not assumed) to live on the DETAIL row, not the header - RepairBillHeader has no
    /// IssueType column at all. "U/W" or "FSC" zero this line's own tax/taxable amount at save
    /// time (RepairBillDocsController.Create); confirmed reference values (the shared IssueTypes
    /// lookup this reads its ids from was never pasted in full) are "Paid", "U/W", "FSC" - all
    /// three appear referenced by name in the pasted repair-bill.ts. Falls back to the bill-level
    /// RepairBillDoc.IssueType when null, for a line created before this per-line field existed.</summary>
    [MaxLength(30)] public string? IssueType { get; set; }

    public double Qty { get; set; } = 1;
    [Column(TypeName = "decimal(12,2)")] public decimal Rate { get; set; }

    // ---- Reference: RepairBillDetail.DiscountValue/LabourDiscount/PartDiscount/DiscountType -
    // applied to reduce the taxable amount BEFORE GST, same order of operations as the reference
    // (Angular's sanitizeForSave/tax calc always discounts first, taxes the remainder). DiscountType
    // is free text ("Percentage" or "Amount") matching the reference's own untyped string field. ----
    [MaxLength(20)] public string? DiscountType { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal DiscountValue { get; set; }

    /// <summary>Reference: RepairBillDetail.Cgstamount/Sgstamount/Igstamount are populated from
    /// whatever LabourMaster/PartWiseLabour rate the CALLER already resolved and sent -
    /// RepairBillRepo.InsertRepairBill/UpdateRepairBill never decide same-state vs different-state
    /// themselves, they only persist. These three percentages are the equivalent input here: all
    /// three are independent and caller-supplied (normally only one pair is non-zero for a given
    /// line, but the controller does not enforce or infer that - it only multiplies each rate by
    /// the taxable amount, matching the reference's own division of responsibility).</summary>
    [Column(TypeName = "decimal(5,2)")] public decimal CgstPct { get; set; }
    [Column(TypeName = "decimal(5,2)")] public decimal SgstPct { get; set; }
    [Column(TypeName = "decimal(5,2)")] public decimal IgstPct { get; set; }

    [Column(TypeName = "decimal(12,2)")] public decimal TaxableAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal CgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal SgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal IgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal TotalAmount { get; set; }

    // ---- 2026-09-22 "add this in our function" (Extended Battery Warranty Scheme) - see
    // Models/ExtendedBatteryWarrantySchemes.cs's own doc comment for the full eligibility formula
    // and RepairBillDocsController.Create for where this is set. NON-DESTRUCTIVE: neither field
    // ever changes Rate/TaxableAmount/CgstAmount/SgstAmount/IgstAmount/TotalAmount above, which stay
    // exactly what the caller submitted - this is audit/display metadata only, same principle used
    // for the DMS version of this same feature earlier in this session. Both nullable so
    // existing rows are unaffected. ----
    public Guid? ExtendedBatteryWarrantySchemeId { get; set; }
    public ExtendedBatteryWarrantyScheme? ExtendedBatteryWarrantyScheme { get; set; }
    public bool? IsUnderExtendedWarranty { get; set; }
}
