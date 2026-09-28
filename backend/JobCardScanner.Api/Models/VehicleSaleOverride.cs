namespace JobCardScanner.Api.Models;

/// <summary>
/// 2026-09-28 ("edit button for new page where we can edit details like reg no. we can edit and
/// that was save in our jobcard db that will data reflect on ui whivh reg no. we saved in jobcard
/// db that also modify for vehicle sale"): brand-new entity, one row = one hand-corrected field for
/// one vehicle (keyed by ChassisNo - the one identifier shared across DMS_SaleBill,
/// DMS_ServiceHistory and an imported Vehicle Sale Report). Written by
/// VehicleSaleOverridesController.Save() (web/src/pages/staff/VehicleSalePage.tsx's new Reg No
/// inline edit), read back by DmsBaplDataService.GetVehicleSalesAsync as the FINAL, highest-
/// priority layer on top of DMS_SaleBill's own reg_number and SECTION 113's DMS_ServiceHistory
/// fallback - see that method's 2026-09-28 doc comment.
///
/// This app is read-only against DMSBAPLDATA/BaplConnection everywhere else (see e.g.
/// DmsBaplDataService's own class-level doc comments) - this table is deliberately NOT there. It
/// lives in JobCardScannerDb (this app's own database) instead, exactly so a manual correction
/// never needs (or risks) a write against either external DMS database.
///
/// SCOPE, not guessed beyond what you asked for: only RegNo is overridable right now, since that
/// was your concrete example ("edit details like reg no."). If other Vehicle Sale fields need the
/// same manual-correction treatment, tell me which ones and I'll add more nullable override columns
/// here rather than assuming which fields you meant by "details".
/// </summary>
public class VehicleSaleOverride
{
    public Guid Id { get; set; }

    /// <summary>The join key - matches DmsBaplDataVehicleSaleRow.ChassisNo /
    /// DmsBaplDataServiceHistoryRow.ChassisNo / the imported report's Chassis No column. One
    /// override row per chassis (see the SQL script's unique constraint) - saving a second time for
    /// the same chassis updates this same row rather than creating a duplicate.</summary>
    public string ChassisNo { get; set; } = "";

    /// <summary>The corrected Reg No, exactly as typed and saved from the Vehicle Sale page's
    /// inline edit.</summary>
    public string RegNo { get; set; } = "";

    /// <summary>FK to Users.Id - whoever last saved this override (_currentUser.UserId). Nullable
    /// Guid?, same convention as Attendance.MarkedByUserId (see that model's own doc comment on
    /// why - this codebase's actor FKs are consistently nullable).</summary>
    public Guid? UpdatedByUserId { get; set; }

    public DateTime UpdatedAtUtc { get; set; }
}
