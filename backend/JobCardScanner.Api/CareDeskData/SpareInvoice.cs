using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class SpareInvoice
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string InvoiceNo { get; set; } = null!;

    public DateOnly InvoiceDate { get; set; }

    public string Kind { get; set; } = null!;

    public Guid BilledBy { get; set; }

    public DateTimeOffset BilledAt { get; set; }

    public DateOnly? DispatchDate { get; set; }

    public string? LrNo { get; set; }

    public string? Transporter { get; set; }

    public DateOnly? ExpectedDelivery { get; set; }

    public Guid? DispatchedBy { get; set; }

    public DateTimeOffset? DispatchedAt { get; set; }

    public string? Receipt { get; set; }

    public string? ReceiptComment { get; set; }

    public Guid? ReceiptBy { get; set; }

    public DateTimeOffset? ReceiptAt { get; set; }

    public bool AutoReceived { get; set; }

    public DateTimeOffset? CancelledAt { get; set; }

    public decimal? ValueInr { get; set; }

    public virtual User BilledByNavigation { get; set; } = null!;

    public virtual User? DispatchedByNavigation { get; set; }

    public virtual User? ReceiptByNavigation { get; set; }

    public virtual ICollection<SpareInvoiceLine> SpareInvoiceLines { get; set; } = new List<SpareInvoiceLine>();

    public virtual ICollection<SpareReceiptLine> SpareReceiptLines { get; set; } = new List<SpareReceiptLine>();

    public virtual ICollection<SpareShipment> SpareShipments { get; set; } = new List<SpareShipment>();

    public virtual Ticket Ticket { get; set; } = null!;
}
