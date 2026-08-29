using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

public enum NotificationChannel { Sms, Email, WhatsApp, Push }
public enum NotificationStatus { Pending, Sent, Failed }

/// <summary>Reusable message template keyed by event (e.g. "JobCardOpened", "EstimateReady").</summary>
public class NotificationTemplate
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required, MaxLength(80)] public string Key { get; set; } = default!;
    public NotificationChannel Channel { get; set; }
    [MaxLength(200)] public string? Subject { get; set; }
    [Required, MaxLength(2000)] public string Body { get; set; } = default!;
    public bool Active { get; set; } = true;
}

/// <summary>Log of every outbound customer communication sent (or attempted) via IMockNotificationService.</summary>
public class NotificationRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    public Guid? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public NotificationChannel Channel { get; set; }
    [MaxLength(80)] public string? TemplateKey { get; set; }
    [Required, MaxLength(200)] public string RecipientAddress { get; set; } = default!;
    [Required, MaxLength(2000)] public string Content { get; set; } = default!;
    public NotificationStatus Status { get; set; } = NotificationStatus.Pending;
    public DateTime? SentAt { get; set; }
    [MaxLength(500)] public string? ErrorMessage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum OtpPurpose { CustomerPortalLogin, EstimateApproval, JobCardClosure }

/// <summary>
/// One-time-password challenge issued to a customer's mobile for the tracking-portal login,
/// additional-work (estimate) approval, or OTP-based job card closure flows.
/// </summary>
public class OtpRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public OtpPurpose Purpose { get; set; }
    [Required, MaxLength(30)] public string Mobile { get; set; } = default!;
    public Guid? JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    public Guid? EstimateId { get; set; }
    public Estimate? Estimate { get; set; }

    /// <summary>SHA-256 hash of the OTP - the plaintext code is never persisted.</summary>
    [Required, MaxLength(100)] public string OtpHash { get; set; } = default!;
    public DateTime ExpiresAt { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public int Attempts { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
