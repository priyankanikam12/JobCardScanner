using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

/// <summary>
/// 2026-09-19 "now i want Create Repair Bill and Material Transfer Bill" - JobCardScannerDb-native
/// Material Transfer document. See this class's earlier doc-comment rounds for the full history
/// (RackNo/Bin/SerialNo/Mrp/ValidDays/ItemReceived ported from the reference MaterialTransfer
/// table, PartUploads.BalQty decrement/restore on Create/Delete, etc.) - unchanged here.
///
/// 2026-09-21 CORRECTION: earlier rounds confirmed (against the reference app's own
/// material-transfer.ts/MaterialTransfer entity) that Material Transfer has NO discount concept at
/// all. Per explicit instruction this round, MaterialTransferDocItem now DOES carry a discount
/// (DiscountType/DiscountValue below) - this is a genuine, disclosed DEVIATION from that earlier
/// reference-matched design, not something the original reference supports. Modeled on the
/// confirmed DMS_BAPL_Api CounterBillRepo/CounterBillDetail shape instead (DiscType "%"/absolute +
/// Discount value, applied to the line's gross BEFORE any (still display-only, still unstored) tax
/// - same discount-then-tax order already implemented in gstCalc.ts/computeGstLine). Amount below
/// is now server-recomputed from Qty/Rate/DiscountType/DiscountValue on every Create (see
/// MaterialTransferDocsController.Create) rather than trusting whatever total the client sends -
/// same "server is the source of truth for money" convention RepairBillDocsController already
/// follows for its own line items.
/// </summary>
public enum MaterialTransferDocType { Issue, Return }
public enum MaterialTransferDocStatus { Draft, Confirmed, Cancelled }

public class MaterialTransferDoc
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required, MaxLength(40)] public string TransferNumber { get; set; } = default!;

    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }

    public Guid? JobCardId { get; set; }
    public JobCard? JobCard { get; set; }

    [MaxLength(150)] public string? Location { get; set; }
    public MaterialTransferDocType TransferType { get; set; } = MaterialTransferDocType.Issue;
    [MaxLength(60)] public string? IssueType { get; set; }
    [MaxLength(200)] public string? PartyName { get; set; }

    public Guid? TechnicianId { get; set; }
    public User? Technician { get; set; }

    public MaterialTransferDocStatus Status { get; set; } = MaterialTransferDocStatus.Draft;

    [Column(TypeName = "decimal(12,2)")] public decimal TotalAmount { get; set; }
    [MaxLength(1000)] public string? Remarks { get; set; }

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateOnly TransferDate { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow);

    public ICollection<MaterialTransferDocItem> Items { get; set; } = new List<MaterialTransferDocItem>();
}

public class MaterialTransferDocItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MaterialTransferDocId { get; set; }
    public MaterialTransferDoc? MaterialTransferDoc { get; set; }

    public Guid? PartId { get; set; }
    public PartMaster? Part { get; set; }

    [Required, MaxLength(60)] public string ItemCode { get; set; } = default!;
    [Required, MaxLength(300)] public string ItemDescription { get; set; } = default!;

    [MaxLength(20)] public string? HsnCode { get; set; }

    /// <summary>Reference: MaterialTransfer.IssueType, per line - "Paid" (taxed normally) or
    /// "U/W". Falls back to the document-level default when null.</summary>
    [MaxLength(30)] public string? IssueType { get; set; }

    public double Qty { get; set; } = 1;
    [Column(TypeName = "decimal(12,2)")] public decimal Rate { get; set; }

    /// <summary>2026-09-21 NEW - "Percentage" or "Amount" (null/"None" means no discount). Applied
    /// to the line's gross (Qty x Rate) before Amount is computed - see
    /// MaterialTransferDocsController.Create for the server-side arithmetic. NOT part of the
    /// original reference MaterialTransfer table (see this file's class doc comment).</summary>
    [MaxLength(20)] public string? DiscountType { get; set; }
    /// <summary>2026-09-21 NEW - the discount's raw value (a percentage 0-100 when DiscountType is
    /// "Percentage", or a flat rupee amount when "Amount"). 0 when DiscountType is null.</summary>
    [Column(TypeName = "decimal(12,2)")] public decimal DiscountValue { get; set; }

    /// <summary>Qty x Rate, minus the discount above - still the line's pre-tax total (Material
    /// Transfer stores no CGST/SGST/IGST columns at all, per this file's class doc comment; tax
    /// stays display-only, computed client-side from gstCalc.ts).</summary>
    [Column(TypeName = "decimal(12,2)")] public decimal Amount { get; set; }

    // ---- Kept on the model for backward compatibility with existing saved rows and the
    // combined-list detail popup, even though the create page's grid no longer collects them
    // (2026-09-21: "remove Rack No Bin Valid Days Received" from the UI) - these columns are
    // simply left null on every new row from here on rather than being dropped from the schema,
    // which would need a destructive migration for no real benefit. ----
    [MaxLength(30)] public string? RackNo { get; set; }
    [MaxLength(30)] public string? Bin { get; set; }
    [MaxLength(100)] public string? SerialNo { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal? Mrp { get; set; }
    public int? ValidDays { get; set; }
    [MaxLength(30)] public string? ItemReceived { get; set; }
}
