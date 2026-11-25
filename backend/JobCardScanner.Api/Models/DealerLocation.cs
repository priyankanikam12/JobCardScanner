using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

/// <summary>2026-11-25 ("W series location wants to fetch in our JobCardScannerDb ... new location added in ERP that direct synced with their particular dealer"):
/// one workshop location (Loc_Code CUS0316W1, CUS0316W2, ...) of a dealer, copied from the ERP table baplfinal.dbo.C_DMS_DealerConsigneeDetail by
/// Services/DealerLocationSyncService.cs (hourly, and on demand from POST /api/dealer-locations/sync). Table created by sql/2026-11-25_DealerLocations.sql.
/// <see cref="LocationCode"/> is exactly what User.WorkLocationCodes holds, so a location that exists here can be ticked in an employee's Work Area.</summary>
public class DealerLocation
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The JobCardScannerDb dealer this location belongs to - matched on Dealers.BaplDmsDealerCode, else Dealers.Code, against the ERP Dealer_Code.
    /// Null while no dealer with that code exists here (the row is still stored, and is linked on a later sync once the dealer is imported).</summary>
    public Guid? DealerId { get; set; }
    public Dealer? Dealer { get; set; }

    /// <summary>ERP Dealer_Code, e.g. "CUS0316".</summary>
    [Required, MaxLength(30)] public string DealerCode { get; set; } = default!;
    /// <summary>ERP Loc_Code, e.g. "CUS0316W3" - unique.</summary>
    [Required, MaxLength(30)] public string LocationCode { get; set; } = default!;
    [MaxLength(200)] public string? LocationName { get; set; }
    [MaxLength(400)] public string? Address { get; set; }
    [MaxLength(100)] public string? City { get; set; }
    [MaxLength(100)] public string? State { get; set; }
    [MaxLength(10)] public string? Pincode { get; set; }
    [MaxLength(30)] public string? Gstin { get; set; }
    [MaxLength(200)] public string? Email { get; set; }
    [MaxLength(30)] public string? Mobile { get; set; }

    /// <summary>ERP Loc_Idno.</summary>
    public int? SourceLocId { get; set; }
    /// <summary>False when the ERP marks the location inactive (Status other than 1) or it has disappeared from the ERP table. Inactive rows are kept, never deleted.</summary>
    public bool IsActive { get; set; } = true;
    /// <summary>ERP Date_Modified.</summary>
    public DateTime? SourceModifiedAt { get; set; }
    public DateTime FirstSyncedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSyncedAt { get; set; } = DateTime.UtcNow;
}