using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

public enum JobCardStatus
{
    Open,
    InProgress,
    PendingCustomerApproval,
    PendingQc,
    PendingClosure,
    PendingInvoice,
    Closed,
    Cancelled,
}

public enum ServiceType
{
    FreeService,
    PaidService,
    Warranty,
    AccidentRepair,
    Breakdown,
    Pdi,
    GoodwillService,
}

public enum JobCardSource
{
    WalkIn,
    PickupAndDrop,
    Breakdown,
    Scheduled,
    Online,
}

public enum JobCardPriority { Normal, High, Urgent }

/// <summary>
/// The central record of the customer service journey: created by the 6-step Job Card Opening
/// Wizard, driven through <see cref="WorkflowStage"/>s, and closed via OTP + invoiced.
///
/// 2026-09-05: BAPL DMS is now the sole source of truth for whether a job card exists at all -
/// see JobCardsController.Create, which calls BAPL DMS's own CreateJobCardAsync FIRST and only
/// ever creates a row here as a direct, same-request consequence of that succeeding
/// (BaplJobCardHeaderId/BaplJobNo below are always set for any row created this way; a row that
/// somehow lacks them predates this change and is hidden from the list/detail endpoints, never
/// deleted). This row is therefore no longer an independent save path or "the" record of the job
/// card - JobCardNumber itself is DMS's own JobPrefix+JobNo, not a JobCardScanner-generated
/// number. What this row IS still for: (1) a stable local id for everything BAPL DMS has no table
/// for and that must keep working exactly as before - Photos, Complaints, Inspections,
/// StageHistory, Worklogs, QcChecklistItems, PartSuggestions, LabourSuggestions, Invoice,
/// Estimates, Parts (all FK'd to this row's Id below, unchanged) - and (2) JobCardScanner-only
/// workflow concepts DMS doesn't model, like Status/CurrentStage/AssignedTechnician/ExpectedDeliveryAt.
/// </summary>
public class JobCard
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Human-readable sequential number, e.g. "JC-DL01-2026-000123". See <see cref="Counter"/>.</summary>
    [Required, MaxLength(40)] public string JobCardNumber { get; set; } = default!;

    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }
    public Guid CustomerId { get; set; }
    public Customer? Customer { get; set; }

    public JobCardStatus Status { get; set; } = JobCardStatus.Open;
    public ServiceType ServiceType { get; set; }
    public JobCardSource Source { get; set; }
    public JobCardPriority Priority { get; set; } = JobCardPriority.Normal;

    public Guid? CurrentStageId { get; set; }
    public WorkflowStage? CurrentStage { get; set; }

    public Guid? ServiceAdvisorId { get; set; }
    public User? ServiceAdvisor { get; set; }
    public Guid? AssignedTechnicianId { get; set; }
    public User? AssignedTechnician { get; set; }
    /// <summary>Free-text technician name for the Job Card Detail page's "Assign Technician" field -
    /// there's no confirmed source of a technician catalog to populate a dropdown from, so this is
    /// typed in directly rather than picked from Users. Kept alongside (not instead of)
    /// AssignedTechnicianId, which some other flow may still set from a real User row; when both are
    /// present, AssignedTechnician's own Name wins for display (see JobCardsController.Summarize).</summary>
    [MaxLength(120)] public string? AssignedTechnicianName { get; set; }

    public double OdometerAtCheckIn { get; set; }
    /// <summary>0-100 battery charge % reported at check-in.</summary>
    public int? BatteryLevelAtCheckIn { get; set; }

    public DateTime? ExpectedDeliveryAt { get; set; }
    public DateTime? ActualDeliveryAt { get; set; }
    public DateTime? ClosedAt { get; set; }

    /// <summary>Opaque token embedded in the customer real-time tracking portal link/QR code.</summary>
    [MaxLength(80)] public string TrackingToken { get; set; } = Guid.NewGuid().ToString("N");

    [MaxLength(2000)] public string? CustomerConsentNotes { get; set; }
    [MaxLength(500)] public string? CheckInSignatureUrl { get; set; }

    /// <summary>Mirrors the originating ERP/DMS job-card id when this record was pushed/pulled.</summary>
    [MaxLength(60)] public string? ErpJobCardId { get; set; }

    // ---------------- BAPL DMS-style fields (captured locally; not yet synced) ----------------
    // These mirror fields on BAPL DMS's own JobCardHeader (JobType/Supervisor/Technician - see
    // BaplDmsService's confirmed-schema queries - and the "Service Location" seen on their Job Card
    // List screen, e.g. "BM ENTERPRISES-TIRUPATHUR") so the wizard can capture the same information
    // your team is used to entering there. They are plain free-text/label fields for now, NOT
    // foreign keys and NOT yet written back into BAPL DMS's own database - that write-back needs
    // BAPL DMS's real insert requirements (identity/JobNo-generation logic, required columns,
    // defaults) before it can be built safely; see the project notes on this. BaplSupervisorName/
    // BaplTechnicianName are deliberately separate from ServiceAdvisorId/AssignedTechnicianId above
    // - those are real JobCardScanner User accounts driving the workflow, these are just the
    // BAPL-DMS-style names typed in at intake.
    /// <summary>BAPL DMS's JobType label (PDI / Accidental / In Warranty Period / Post Warranty
    /// Period / In test - from BAPL DMS's own JobType master) chosen at intake, alongside
    /// JobCardScanner's own <see cref="ServiceType"/>.</summary>
    [MaxLength(60)] public string? BaplJobType { get; set; }
    /// <summary>Free-text service location/branch, as seen on BAPL DMS's own job card list (e.g.
    /// "BM ENTERPRISES-TIRUPATHUR") - separate from the Dealer/Workshop this job card belongs to.</summary>
    [MaxLength(200)] public string? BaplServiceLocation { get; set; }
    [MaxLength(120)] public string? BaplSupervisorName { get; set; }
    [MaxLength(120)] public string? BaplTechnicianName { get; set; }
    /// <summary>BAPL DMS's own "ManualJobNo." column (a separate manually-entered reference number,
    /// distinct from BAPL DMS's system-generated JobNo and from JobCardScanner's own
    /// JobCardNumber) - free text since some dealers may leave it as "0" or blank.</summary>
    [MaxLength(40)] public string? BaplManualJobNo { get; set; }

    // ---------------- BAPL DMS write-back (JobType/ServiceHead/ServiceType cascade + sync result) ----------------
    // IDs into BAPL DMS's own JobType/ServiceHead/ServiceType master tables (see BaplDmsService's
    // GetJobTypesAsync/GetServiceHeadsAsync/GetServiceTypesAsync) - captured so Create() can actually
    // write this job card into BAPL DMS's own JobCardHeader (BaplJobType above stays as a plain
    // display label for backward compatibility with job cards created before this cascade existed).
    public int? BaplJobTypeId { get; set; }
    /// <summary>BAPL DMS's JobSource.Id (Walk In/RSA/Mega Camp/...) - replaces the wizard's old
    /// hardcoded WalkIn/PickupAndDrop/Breakdown/Scheduled/Online "Source" dropdown, which was
    /// JobCardScanner's own invented list rather than anything BAPL DMS tracks. The plain
    /// <see cref="Source"/> enum above is still set too (auto-derived from this, not shown as its
    /// own picker any more - see JobCardWizardPage's mapBaplSourceToLocal) since it's used by
    /// existing dashboards/filters that expect one of JobCardSource's fixed values.</summary>
    public int? BaplJobSourceId { get; set; }
    [MaxLength(60)] public string? BaplJobSourceName { get; set; }
    public int? BaplServiceHeadId { get; set; }
    [MaxLength(120)] public string? BaplServiceHeadName { get; set; }
    public int? BaplServiceTypeId { get; set; }
    [MaxLength(120)] public string? BaplServiceTypeName { get; set; }
    /// <summary>BAPL DMS's LocationMaster.Loccode for the workshop this job card was serviced at
    /// (e.g. "CUS0435W1") - the actual value written to BAPL DMS's JobCardHeader.Serviceloc.
    /// BaplServiceLocation above stays as the plain display name shown before this dropdown existed.</summary>
    [MaxLength(20)] public string? BaplServiceLocationCode { get; set; }
    /// <summary>Set once this job card has been written into BAPL DMS's own database (see
    /// BaplDmsService.CreateJobCardAsync) - lets the Job Card Detail page link straight to the BAPL
    /// DMS record it created, the same way a BaplDms-sourced /jobcards row does.</summary>
    public int? BaplJobCardHeaderId { get; set; }
    /// <summary>BAPL DMS's own JobNo (e.g. 22) - what BAPL DMS's own Job Card List screen shows as
    /// "JobNo / JobDate", as opposed to BaplJobCardHeaderId (e.g. 70) which is only the internal
    /// JobCardHeader.Id primary key. Set alongside BaplJobCardHeaderId from the same
    /// BaplDmsCreateJobCardResult - kept separate because the Detail page shows this number to
    /// staff but still links using BaplJobCardHeaderId.</summary>
    public int? BaplJobNo { get; set; }
    /// <summary>"Synced" once BaplJobCardHeaderId is set, "Failed" if the write-back was attempted
    /// and threw (see BaplSyncError), or null if it was never attempted (dealer not yet linked to
    /// BAPL DMS, or the wizard's Job Type/Service Head/Service Type weren't filled in).</summary>
    [MaxLength(20)] public string? BaplSyncStatus { get; set; }
    [MaxLength(1000)] public string? BaplSyncError { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }

    public ICollection<JobCardComplaint> Complaints { get; set; } = new List<JobCardComplaint>();
    public ICollection<JobCardInspection> Inspections { get; set; } = new List<JobCardInspection>();
    public ICollection<JobCardPhoto> Photos { get; set; } = new List<JobCardPhoto>();
    public ICollection<JobCardStageHistory> StageHistory { get; set; } = new List<JobCardStageHistory>();
    public ICollection<JobCardWorklog> Worklogs { get; set; } = new List<JobCardWorklog>();
    public ICollection<QcChecklistItem> QcChecklistItems { get; set; } = new List<QcChecklistItem>();
    public ICollection<Estimate> Estimates { get; set; } = new List<Estimate>();
    public ICollection<JobCardPart> Parts { get; set; } = new List<JobCardPart>();
    /// <summary>"Part Suggestion" rows (see JobCardPartSuggestion) - suggested from BAPL DMS's own
    /// PartsInventory for this job card's Service Location, with a locally-tracked Paid/U-W status.
    /// Deliberately separate from Parts above (JobCardPart), which needs a real local PartMaster FK
    /// this BAPL-sourced ItemCode has no mapping to yet.</summary>
    public ICollection<JobCardPartSuggestion> PartSuggestions { get; set; } = new List<JobCardPartSuggestion>();
    /// <summary>"Labour Suggestion" rows (see JobCardLabourSuggestion) - suggested from BAPL DMS's
    /// own LabourMaster for this job card, same pattern as PartSuggestions above but for labour.</summary>
    public ICollection<JobCardLabourSuggestion> LabourSuggestions { get; set; } = new List<JobCardLabourSuggestion>();

    /// <summary>One-to-one: at most one Invoice per job card (see the unique index on
    /// Invoice.JobCardId in JobCardScannerDbContext). Lets GET /api/jobcards/{id} tell the "Generate
    /// Invoice" button on the detail page whether one already exists, instead of it always being
    /// shown and only finding out via a 409 from POST .../invoice after the fact.</summary>
    public Invoice? Invoice { get; set; }
}

/// <summary>Customer-reported complaint / concern captured during job card opening.</summary>
public class JobCardComplaint
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    [Required, MaxLength(500)] public string Description { get; set; } = default!;
    [MaxLength(80)] public string? Category { get; set; }
    public bool IsCustomerVoice { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A single component inspected during the vehicle health check.</summary>
public class JobCardInspection
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    [Required, MaxLength(120)] public string Component { get; set; } = default!;
    [Required, MaxLength(40)] public string Condition { get; set; } = default!; // Ok / NeedsAttention / Critical
    [MaxLength(500)] public string? Notes { get; set; }
    public Guid? TechnicianId { get; set; }
    public User? Technician { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>"PartSuggestion" added 2026-09-03 for the Part Suggestion grid's own Picture column
/// (JobCardPhoto.PartSuggestionId below) - distinct from the other five stages so these don't get
/// mixed into the general Photos card's own CheckIn/Inspection/Repair/Qc/Delivery history.</summary>
public enum PhotoStage { CheckIn, Inspection, Repair, Qc, Delivery, PartSuggestion }

public class JobCardPhoto
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    public PhotoStage Stage { get; set; }
    [Required, MaxLength(500)] public string Url { get; set; } = default!;
    [MaxLength(200)] public string? Caption { get; set; }
    /// <summary>GPS location the photo was captured at (browser Geolocation API, Job Card Detail
    /// page) - null for photos added the old way (a plain Url with no capture step, e.g. a future
    /// BAPL DMS sync) or when the device/browser denied location access.</summary>
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    /// <summary>Set when this photo/video was uploaded from the Part Suggestion grid's Picture
    /// column (2026-09-03 - "which partcode we added after added we upload photos and video"),
    /// linking it back to that specific JobCardPartSuggestion row instead of just the job card as a
    /// whole. Null for every other photo (the general Photos card never sets this). Deliberately
    /// NOT a DB-enforced foreign key (no ON DELETE rule wired up) - JobCardPartSuggestions rows are
    /// hard-deleted by DeletePartSuggestion with no cascade cleanup of their photos today, so a real
    /// FK constraint would make that delete throw; an orphaned PartSuggestionId here just stops
    /// matching anything client-side, which is harmless.</summary>
    public Guid? PartSuggestionId { get; set; }
    public Guid? UploadedById { get; set; }
    public User? UploadedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Audit trail of every stage transition a job card passed through.</summary>
public class JobCardStageHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    public Guid StageId { get; set; }
    public WorkflowStage? Stage { get; set; }
    public DateTime EnteredAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExitedAt { get; set; }
    public Guid? ChangedById { get; set; }
    public User? ChangedBy { get; set; }
    [MaxLength(500)] public string? Notes { get; set; }
}

/// <summary>Technician time-tracking entry against a job card (start/stop work timer).</summary>
public class JobCardWorklog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    public Guid TechnicianId { get; set; }
    public User? Technician { get; set; }
    [MaxLength(300)] public string? TaskDescription { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EndedAt { get; set; }
    public int? DurationMinutes { get; set; }
    [MaxLength(500)] public string? Notes { get; set; }
}

public class QcChecklistItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    [Required, MaxLength(150)] public string ItemName { get; set; } = default!;
    public bool? Passed { get; set; }
    [MaxLength(500)] public string? Notes { get; set; }
    public Guid? CheckedById { get; set; }
    public User? CheckedBy { get; set; }
    public DateTime? CheckedAt { get; set; }
}

/// <summary>A part suggested for this job card from BAPL DMS's own PartsInventory (see
/// BaplDmsService.GetPartsInventoryAsync), scoped to the job card's Service Location. Stored
/// locally purely for JobCardScanner's own history/reporting ("Paid" vs "U/W" - under warranty) -
/// this does NOT write anything back into BAPL DMS, and is deliberately separate from the existing
/// JobCardPart (which requires a real local PartMaster row this BAPL ItemCode has no mapping to).</summary>
public class JobCardPartSuggestion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    /// <summary>BAPL DMS's PartsInventory.ItemCode - not a local PartMaster.PartNumber.</summary>
    [Required, MaxLength(60)] public string ItemCode { get; set; } = default!;
    /// <summary>PartsInventory's available quantity at the time this was suggested (informational -
    /// not re-checked live once saved, since BAPL DMS's own stock moves independently of this).</summary>
    public int? AvailableQtyAtSuggestion { get; set; }
    /// <summary>"Paid" or "U/W" (under warranty) - the only two options on the dropdown.</summary>
    [Required, MaxLength(20)] public string Status { get; set; } = "Paid";
    /// <summary>How many units of this part are actually being used on this job card - distinct
    /// from AvailableQtyAtSuggestion above (that's BAPL DMS's stock level at suggestion time, not a
    /// quantity requested). Added for Items 16/18 (Part Suggestion grid's QTY column, and the
    /// Estimates Amount calculation's Part Details table - Amount = Mrp x Quantity). Defaults to 1,
    /// same convention as JobCardLabourSuggestion.Quantity. NEW column - see
    /// deploy/add-part-suggestion-columns.sql for the manual production migration this needs
    /// (Database.EnsureCreatedAsync() in Program.cs does nothing on a database that already
    /// exists).</summary>
    public int Quantity { get; set; } = 1;
    /// <summary>Snapshot of the item's description/MRP/HSN at suggestion time, from BAPL DMS's own
    /// best-effort ItemMaster enrichment (see BaplDmsPartStockRow's doc comment in
    /// BaplDmsService.cs - these may be null even for a real item if that table/columns turn out to
    /// be named differently). Snapshotted rather than live-linked, same reasoning as
    /// JobCardLabourSuggestion's LabourDescription/HsnCode - a later price change shouldn't
    /// retroactively alter what was already suggested. NEW columns - see
    /// deploy/add-part-suggestion-columns.sql.</summary>
    [MaxLength(400)] public string? Description { get; set; }
    [MaxLength(20)] public string? HsnCode { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal? Mrp { get; set; }
    public Guid? SuggestedById { get; set; }
    public User? SuggestedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A labour line suggested for this job card from BAPL DMS's own LabourMaster (see
/// BaplDmsService.GetLabourAsync), mirroring JobCardPartSuggestion's pattern but for labour instead
/// of parts. Snapshots LabourDescription/HsnCode/Sgst/Cgst/Igst/RateAtSuggestion from the matched
/// LabourMaster row AT THE TIME it was suggested (confirmed via a live `SELECT * FROM LabourMaster`
/// dump) - not live-linked, so a later change to LabourMaster's own rate/GST doesn't retroactively
/// change what was already suggested on this job card, and so this doesn't need a live join back
/// into BAPL DMS every time the job card is displayed. Quantity is staff-editable (defaults to 1);
/// RateAtSuggestion is NOT editable once suggested (locked from LabourMaster's own rate card,
/// matching how a labour rate card normally works). IssueType is a free-text field (not a Paid/U-W
/// dropdown like JobCardPartSuggestion.Status - this app doesn't have a fixed set of labour issue
/// reasons) capturing why this labour is being billed. This does NOT write anything back into
/// BAPL DMS - JobCardScanner-only history/reporting, same as JobCardPartSuggestion.</summary>
public class JobCardLabourSuggestion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    /// <summary>BAPL DMS's LabourMaster.LabourCode.</summary>
    [Required, MaxLength(60)] public string LabourCode { get; set; } = default!;
    /// <summary>Snapshot of LabourMaster.LabourDescription at suggestion time.</summary>
    [MaxLength(400)] public string? LabourDescription { get; set; }
    /// <summary>Snapshot of LabourMaster.HSNCode at suggestion time.</summary>
    [MaxLength(20)] public string? HsnCode { get; set; }
    [Column(TypeName = "decimal(5,2)")] public decimal? Sgst { get; set; }
    [Column(TypeName = "decimal(5,2)")] public decimal? Cgst { get; set; }
    [Column(TypeName = "decimal(5,2)")] public decimal? Igst { get; set; }
    /// <summary>Snapshot of LabourMaster.LabourRate at suggestion time - the per-unit rate this
    /// suggestion is locked to, regardless of any later change to LabourMaster's own rate.</summary>
    [Column(TypeName = "decimal(12,2)")] public decimal? RateAtSuggestion { get; set; }
    /// <summary>How many units of this labour code - staff-editable, defaults to 1.</summary>
    public int Quantity { get; set; } = 1;
    /// <summary>Free-text reason/issue type for this labour line (e.g. "Warranty", "Accident",
    /// "General Service") - not a fixed dropdown, since BAPL DMS doesn't define a closed set of
    /// these for LabourMaster.</summary>
    [MaxLength(120)] public string? IssueType { get; set; }
    public Guid? SuggestedById { get; set; }
    public User? SuggestedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
