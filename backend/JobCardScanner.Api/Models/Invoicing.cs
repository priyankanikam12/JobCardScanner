using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

public enum InvoiceStatus { Draft, Generated, Paid, Cancelled }
public enum PaymentMode { Cash, Card, Upi, NetBanking, Wallet, Pending }

public class Invoice
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobCardId { get; set; }
    public JobCard? JobCard { get; set; }
    [Required, MaxLength(40)] public string InvoiceNumber { get; set; } = default!;
    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public Guid CustomerId { get; set; }
    public Customer? Customer { get; set; }

    [Column(TypeName = "decimal(12,2)")] public decimal LabourAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal PartsAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal DiscountAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal CgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal SgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal IgstAmount { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal TotalAmount { get; set; }

    public InvoiceStatus Status { get; set; } = InvoiceStatus.Draft;
    public PaymentMode PaymentMode { get; set; } = PaymentMode.Pending;
    [MaxLength(80)] public string? PaymentReference { get; set; }

    public Guid? GeneratedById { get; set; }
    public User? GeneratedBy { get; set; }
    public DateTime? GeneratedAt { get; set; }
    public DateTime? PaidAt { get; set; }

    /// <summary>Relative path/URL of the generated PDF (see Services.IInvoicePdfService).</summary>
    [MaxLength(500)] public string? PdfUrl { get; set; }
    [MaxLength(60)] public string? ErpInvoiceId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
