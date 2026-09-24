using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

/// <summary>2026-09-24 ("this technician dont want to bid username and password for that
/// location wants to create technician"): a lightweight, LOGIN-LESS master-data record - just a
/// name tied to a workshop location - used purely to populate the Job Card Wizard's "Technician"
/// dropdown and the Job Card Detail page's "Assign Technician" dropdown. Deliberately NOT a
/// <see cref="User"/> row: no email/password/AuthType/Role, nothing that would let this "sign in"
/// - see TechniciansController's own doc comment for the full reasoning and how this differs from
/// the pre-existing (but functionally unused - see StaffRole.Technician's own doc comment)
/// StaffRole.Technician enum value, which this deliberately does NOT reuse.
///
/// Created/managed by a Supervisor (or DealerAdmin/CorporateAdmin/SystemAdmin) from the new
/// "Technician Employee" tab - see StaffRole.Supervisor's doc comment for that role's own
/// reasoning.</summary>
public class Technician
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DealerId { get; set; }
    [Required, MaxLength(150)] public string Name { get; set; } = default!;
    /// <summary>DMS workshop LocCode (e.g. "CUS0288W5") this technician works at - same code
    /// space as User.WorkLocationCodes/BaplDmsWorkshop.LocCode, so the Job Card Wizard's Service
    /// Location selection can filter this dropdown down to just the technicians at that one
    /// workshop, exactly as it already does for the Supervisor dropdown (Users where
    /// Role=Supervisor and WorkLocationCodes contains this code).</summary>
    [Required, MaxLength(20)] public string LocationCode { get; set; } = default!;
    /// <summary>Human-readable workshop name (e.g. "Chakan Service Center") captured alongside
    /// LocationCode purely for display on the Technician Employee grid, the same way
    /// EmployeesPage.tsx's Work Area picker shows "{locName} ({locCode})" rather than the bare
    /// code - not authoritative (DMS's own WorkshopMaster/LocationMaster is, same as
    /// everywhere else in this app), just a snapshot taken at the moment this record was saved.</summary>
    [MaxLength(200)] public string? LocationName { get; set; }
    /// <summary>Soft-deactivate, same convention as User.Active - lets a Supervisor retire a
    /// technician without losing that technician's name on any job card that already references
    /// them (JobCard.AssignedTechnicianName is a plain string snapshot, not a foreign key - see
    /// its own doc comment), and without a hard DELETE breaking the dropdown's "who's active right
    /// now" list.</summary>
    public bool Active { get; set; } = true;
    public Guid? CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
