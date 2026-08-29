using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

public enum EstimateStatus { Draft, PendingCustomerApproval, Approved, Rejected, Expired }

/// <summary>
/// An estimate for additional work found during inspection/repair, requiring OTP-verified
/// customer approval before the workshop can proceed (per the additional-work approval flow).
/// </summary>
public class Estimate
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    [Required, MaxLength(40)] public string EstimateNumber { get; set; } = default!;
    public EstimateStatus Status { get; set; } = EstimateStatus.Draft;
    [Column(TypeName = "decimal(12,2)")] public decimal TotalAmount { get; set; }
    [MaxLength(1000)] public string? Reason { get; set; }
    [MaxLength(1000)] public string? CustomerResponseNotes { get; set; }

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentToCustomerAt { get; set; }
    public DateTime? RespondedAt { get; set; }

    /// <summary>True once the customer's approval/rejection OTP has been verified.</summary>
    public bool OtpVerified { get; set; }

    public ICollection<EstimateLine> Lines { get; set; } = new List<EstimateLine>();
}

public enum EstimateLineType { Labour, Part }

public class EstimateLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EstimateId { get; set; }
    public Estimate? Estimate { get; set; }
    public EstimateLineType Type { get; set; }
    [Required, MaxLength(200)] public string Description { get; set; } = default!;
    public Guid? PartId { get; set; }
    public PartMaster? Part { get; set; }
    public double Quantity { get; set; } = 1;
    [Column(TypeName = "decimal(12,2)")] public decimal UnitPrice { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal Amount { get; set; }
}
