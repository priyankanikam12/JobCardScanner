using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

/// <summary>
/// 2026-09-22 "needs to create warenty table in jobcardscanner db for this functionality and add
/// this in our function" - a dealer-configurable Extended Battery Warranty scheme master, native to
/// JobCardScannerDb (this app's own database, not BAPLDMSvad/baplfinal). Ported in SHAPE from the
/// real DMS reference's own ExtendedBatteryWarranty table/screens you pasted earlier in this
/// session (SchemeName/RateType/Duration/DurationType/Kms/DealerPrice/CustomerPrice/
/// DiscountAmount/Gstpercentage/PurchaseValidity/BatteryPartCode/PartCode/FromDate/ToDate/IsActive),
/// with two deliberate adaptations rather than a field-for-field copy:
///
///  1. The reference links a scheme to a vehicle via OemmodelId, an FK into DMS's own
///     OemmodelMaster table - JobCardScannerDb had NO such master when this class was first
///     written (confirmed: grepped Models/ and Controllers/ for "OemModel"/"VehicleModel", nothing
///     existed). Vehicle.Model here is a plain free-text string (see Models/MasterData.cs), so
///     VehicleModel below is free text too, matched against Vehicle.Model at eligibility-check
///     time. This means scheme matching is exact-text (case-insensitive) rather than FK-based - a
///     typo in either place breaks the match silently, which a real OEM Model master would
///     prevent.
///
///     2026-09-22 UPDATE: that gap is now partially closed - see Models/OemModels.cs (OemModel/
///     OemModelWarranty, ported from the same reference's OemmodelMaster/OemmodelWarranty tables
///     you pasted). Per an explicit choice confirmed via AskUserQuestion, the new OemModelId below
///     was added ALONGSIDE VehicleModel, not as a replacement, and Vehicle.Model itself stays free
///     text - eligibility MATCHING still reads VehicleModel exactly as before. OemModelId exists so
///     the admin UI's model picker can set both fields together (keeping VehicleModel in sync with
///     a real catalog entry for schemes saved going forward) without requiring the much larger,
///     riskier change of turning Vehicle.Model into an FK across the rest of this app.
///  2. The reference's DurationType is a numeric FK into a frontend-only DurationTypes constant
///     whose real member values were never confirmed (see the earlier BAPL_DMS delivery's own
///     disclosure of this same gap). Rather than repeat that guess, DurationType here is a plain
///     string ("Days"/"Months"/"Years", enforced client-side as a fixed dropdown) - no numeric id
///     to misinterpret.
///
/// Eligibility formula (used by ExtendedBatteryWarrantySchemesController's GET .../eligible and by
/// RepairBillDocsController.Create's non-destructive per-line tagging - see that controller's own
/// comment): a scheme is a candidate when VehicleModel matches (case-insensitive) AND the vehicle's
/// own Vehicle.PurchaseDate falls inside [FromDate, ToDate] (reading FromDate/ToDate as "which batch
/// of vehicle purchases this scheme's pricing/terms apply to", the same INTERPRETATION - not
/// confirmed BGauss policy - used for the DMS version of this feature). Coverage for a given
/// claim = PurchaseDate + Duration(DurationType) for the date side, and Kms for the mileage side,
/// "whichever comes first". PurchaseValidityDays is carried through but NOT used in the eligibility
/// check, for the same reason it wasn't used in the DMS version: nothing confirms what it
/// gates. All of this should be reviewed against actual BGauss policy before it's treated as
/// authoritative for a real claim - see ExtendedBatteryWarrantySchemesController's doc comment.
/// </summary>
public class ExtendedBatteryWarrantyScheme
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }

    [Required, MaxLength(150)] public string SchemeName { get; set; } = default!;

    /// <summary>Free text, matched case-insensitively against Vehicle.Model - see this class's own
    /// doc comment for why this stays free text (Vehicle.Model itself stays free text by explicit
    /// choice) even though <see cref="OemModelId"/> below now exists.</summary>
    [Required, MaxLength(100)] public string VehicleModel { get; set; } = default!;

    /// <summary>2026-09-22 addition (see this class's own doc comment) - nullable FK into the new
    /// OemModels master, added ALONGSIDE VehicleModel above, not replacing it. Populated by the
    /// admin UI's model picker going forward; schemes saved before this column existed keep this
    /// null and still work exactly as before - VehicleModel is still what eligibility matching
    /// reads, this field is not consulted by ExtendedBatteryWarrantyEligibilityService.</summary>
    public Guid? OemModelId { get; set; }
    public OemModel? OemModel { get; set; }

    /// <summary>Free text, mirrors the reference's own loosely-defined RateType concept - no fixed
    /// enum here since that master/lookup was never confirmed. Purely informational/display.</summary>
    [MaxLength(60)] public string? RateType { get; set; }

    public int Duration { get; set; }
    /// <summary>"Days", "Months", or "Years" - enforced as a fixed dropdown client-side rather than
    /// a numeric id, see this class's own doc comment.</summary>
    [Required, MaxLength(10)] public string DurationType { get; set; } = "Months";

    [Column(TypeName = "decimal(10,2)")] public decimal Kms { get; set; }

    [Column(TypeName = "decimal(12,2)")] public decimal DealerPrice { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal CustomerPrice { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal DiscountAmount { get; set; }
    [Column(TypeName = "decimal(5,2)")] public decimal GstPercent { get; set; }

    /// <summary>Reference: PurchaseValidity (days) - carried through, NOT used in the eligibility
    /// check (see this class's own doc comment for why).</summary>
    public int? PurchaseValidityDays { get; set; }

    [MaxLength(60)] public string? BatteryPartCode { get; set; }
    [MaxLength(60)] public string? PartCode { get; set; }

    /// <summary>Reference: "Invoice Date From/To" on the scheme form - which batch of vehicle
    /// purchases this scheme's pricing/terms apply to (INTERPRETATION - see class doc comment).</summary>
    public DateOnly FromDate { get; set; }
    public DateOnly? ToDate { get; set; }

    public bool IsActive { get; set; } = true;

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public User? UpdatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
