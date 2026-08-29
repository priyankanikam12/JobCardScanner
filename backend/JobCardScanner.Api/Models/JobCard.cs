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

public enum PhotoStage { CheckIn, Inspection, Repair, Qc, Delivery }

public class JobCardPhoto
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    public PhotoStage Stage { get; set; }
    [Required, MaxLength(500)] public string Url { get; set; } = default!;
    [MaxLength(200)] public string? Caption { get; set; }
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