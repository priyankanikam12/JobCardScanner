using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

/// <summary>Spare-part catalog entry, mirrored from ERP/DMS (see Services.IErpClient).</summary>
public class PartMaster
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required, MaxLength(60)] public string PartNumber { get; set; } = default!;
    [Required, MaxLength(200)] public string Name { get; set; } = default!;
    [MaxLength(80)] public string? Category { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal UnitPrice { get; set; }
    public int StockQty { get; set; }
    public int ReorderLevel { get; set; } = 5;
    /// <summary>Null = shared across all dealers; set = dealer-specific stock record.</summary>
    public Guid? DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    [MaxLength(60)] public string? ErpPartId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum JobCardPartStatus { Requested, Issued, Returned, Cancelled }

/// <summary>A part requested/issued against a specific job card by the parts counter.</summary>
public class JobCardPart
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    public Guid PartId { get; set; }
    public PartMaster? Part { get; set; }
    public double Quantity { get; set; } = 1;
    [Column(TypeName = "decimal(12,2)")] public decimal UnitPrice { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal Amount { get; set; }
    public JobCardPartStatus Status { get; set; } = JobCardPartStatus.Requested;

    public Guid? RequestedById { get; set; }
    public User? RequestedBy { get; set; }
    public Guid? IssuedById { get; set; }
    public User? IssuedBy { get; set; }
    public DateTime? IssuedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
