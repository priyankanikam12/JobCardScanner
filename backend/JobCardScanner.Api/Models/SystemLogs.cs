using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

/// <summary>Enterprise-security audit trail: who did what, to which entity, when, from where.</summary>
public class AuditLogEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public User? User { get; set; }
    [Required, MaxLength(80)] public string Action { get; set; } = default!;
    [Required, MaxLength(60)] public string EntityType { get; set; } = default!;
    [MaxLength(60)] public string? EntityId { get; set; }
    /// <summary>JSON-encoded snapshot of the change (before/after or request payload).</summary>
    public string? DetailsJson { get; set; }
    [MaxLength(60)] public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// Email appended at the end (not inserted alphabetically) - this enum is stored as its plain int
// ordinal (no HasConversion<string>() on it in JobCardScannerDbContext), so adding a new value
// anywhere but the end would silently relabel every IntegrationLogEntry row written for the
// existing values on an already-running database.
public enum IntegrationSystem { Erp, Dms, Notification, Otp, Email }
public enum IntegrationDirection { Outbound, Inbound }

/// <summary>Log of every call made through the swappable mock ERP/DMS/Notification/OTP clients.</summary>
public class IntegrationLogEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public IntegrationSystem System { get; set; }
    public IntegrationDirection Direction { get; set; }
    [Required, MaxLength(150)] public string Endpoint { get; set; } = default!;
    public string? RequestJson { get; set; }
    public string? ResponseJson { get; set; }
    public int? StatusCode { get; set; }
    public bool Success { get; set; }
    public int DurationMs { get; set; }
    public int RetryCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Per-dealer, per-sequence-type running counter used to mint human-readable numbers
/// (job card numbers, estimate numbers, invoice numbers) atomically.</summary>
public class Counter
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    [Required, MaxLength(40)] public string CounterType { get; set; } = default!;
    [MaxLength(20)] public string? Prefix { get; set; }
    public int CurrentValue { get; set; }
}