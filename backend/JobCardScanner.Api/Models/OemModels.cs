using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

/// <summary>
/// 2026-09-22 "this wants to integrate for my battery-warranty-schemes for link models for
/// warrenty and this all table add in jobcard db that all functionality need to craete in jc" -
/// ported from the real DMS reference's OemmodelMaster table (Id/ModelName/ModelShortName/
/// IsActive/audit fields) you pasted this session, native to JobCardScannerDb (not a read from
/// BAPLDMSvad/baplfinal - this app owns this table).
///
/// SCOPE (confirmed via AskUserQuestion before building this): GLOBAL, not per-dealer. The
/// reference table itself has no DealerId at all - one shared model catalog ("BGauss B1",
/// "BGauss D15", etc.) for the whole business - and that shape was kept rather than making every
/// dealer maintain a duplicate list of the same BGauss models. Consequently OemModelsController
/// gates List/Get at WorkshopManagerUp (so a dealer's own Workshop Manager can still BROWSE this
/// list when picking a model for an Extended Battery Warranty Scheme - see below) but Create/
/// Update/Delete at the stricter CorporateAdminUp (a catalog shared by every dealer shouldn't be
/// editable by dealer-level staff) - stacking a stricter per-action [Authorize] on top of a looser
/// controller-level one, the same pattern already used by ReportsController.ExportInvoices in this
/// codebase (CashierUp on top of the controller's own Staff).
///
/// LINKING TO ExtendedBatteryWarrantyScheme (also confirmed via AskUserQuestion): a new nullable
/// OemModelId FK was added to ExtendedBatteryWarrantyScheme ALONGSIDE its existing free-text
/// VehicleModel column, not replacing it - see that class's own updated doc comment. Vehicle.Model
/// (Models/MasterData.cs) stays free text per that same decision, so there is still no FK to match
/// a real Vehicle against at eligibility-check time; OemModelId on a scheme exists so the admin
/// UI's model picker can set both OemModelId and VehicleModel together (keeping VehicleModel in
/// sync with a real catalog entry going forward) while eligibility MATCHING keeps reading
/// VehicleModel text exactly as before (see ExtendedBatteryWarrantyEligibilityService) - nothing
/// about the matching logic itself changed. This closes the "no OEM Model master exists" gap
/// flagged in ExtendedBatteryWarrantyScheme's original doc comment without requiring the much
/// larger, riskier change of turning Vehicle.Model itself into an FK across the rest of this app.
/// </summary>
public class OemModel
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required, MaxLength(100)] public string ModelName { get; set; } = default!;
    [MaxLength(30)] public string? ModelShortName { get; set; }
    public bool IsActive { get; set; } = true;

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public User? UpdatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public ICollection<OemModelWarranty> Warranties { get; set; } = new List<OemModelWarranty>();
}

/// <summary>
/// Ported from the reference's OemmodelWarranty table - the OEM/manufacturer's own STANDARD
/// warranty terms for a model (Id/OemmodelId/EffectiveDate/Odoreading/DurationType/Duration/IsB2b/
/// audit fields), as opposed to <see cref="ExtendedBatteryWarrantyScheme"/> which is a dealer-
/// configurable, PRICED extended/paid scheme - the two are separate, additive concepts, same as
/// that class's own doc comment already distinguishes it from Vehicle.Warranty.BatteryWarrantyExpiry.
///
/// Two adaptations from the reference, both flagged rather than silently changed:
///  1. DurationType: the reference used a numeric FK into a frontend-only, never-confirmed
///     DurationTypes constant, with "MONTH"/"YEAR" as the only values ever set from its own
///     add-oemmodel-warranty.ts form. Kept here as a plain string restricted to "Months"/"Years"
///     (full words) - matching ExtendedBatteryWarrantyScheme.DurationType's own established
///     convention in this app (fixed dropdown, full words, no numeric id to misinterpret). "Days"
///     is deliberately NOT offered here, unlike ExtendedBatteryWarrantyScheme, since the reference
///     itself never offered it for this specific table.
///  2. CreatedBy/UpdatedBy: the reference stores these as plain strings from its own separate user
///     table. This app's own convention (every other master built this session) is a nullable Guid
///     FK into JobCardScannerDb's own Users table, used here instead for real referential
///     integrity rather than an unverified free-text name.
///
/// EffectiveDate business rule (ported from the reference's add-oemmodel-warranty.ts
/// getLastEffectiveDate()/effectiveMinDate): a new warranty row's EffectiveDate must be strictly
/// AFTER the same model's most recent existing EffectiveDate - warranty terms for a model are
/// versioned by effective date, not freely overlapping. The reference enforces this CLIENT-SIDE
/// only (an HTML [min] attribute). OemModelWarrantiesController.Create/Update enforce the same
/// rule SERVER-SIDE too, since a client-only check is trivially bypassed by a direct API call -
/// this is a deliberate hardening beyond the reference, not a change to the rule's meaning.
/// </summary>
public class OemModelWarranty
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OemModelId { get; set; }
    public OemModel? OemModel { get; set; }

    public DateOnly EffectiveDate { get; set; }

    /// <summary>Reference: Odoreading - odometer/mileage cap for this warranty term.</summary>
    [Column(TypeName = "decimal(10,2)")] public decimal? OdoReading { get; set; }

    /// <summary>"Months" or "Years" - see this class's own doc comment.</summary>
    [MaxLength(10)] public string? DurationType { get; set; }
    [Column(TypeName = "decimal(10,2)")] public decimal? Duration { get; set; }

    /// <summary>Reference: IsB2b - whether this warranty term applies to B2B/fleet sales rather
    /// than retail B2C.</summary>
    public bool? IsB2b { get; set; }

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public User? UpdatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
