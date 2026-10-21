using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class SpareShipment
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public long InvoiceId { get; set; }

    public DateOnly DispatchDate { get; set; }

    public string LrNo { get; set; } = null!;

    public string? Transporter { get; set; }

    public DateOnly ExpectedDelivery { get; set; }

    public Guid DispatchedBy { get; set; }

    public DateTimeOffset DispatchedAt { get; set; }

    public string? Receipt { get; set; }

    public Guid? ReceiptBy { get; set; }

    public DateTimeOffset? ReceiptAt { get; set; }

    public bool AutoReceived { get; set; }

    public DateTimeOffset? CancelledAt { get; set; }

    public virtual User DispatchedByNavigation { get; set; } = null!;

    public virtual SpareInvoice Invoice { get; set; } = null!;

    public virtual User? ReceiptByNavigation { get; set; }

    public virtual ICollection<SpareReceiptLine> SpareReceiptLines { get; set; } = new List<SpareReceiptLine>();

    public virtual ICollection<SpareShipmentLine> SpareShipmentLines { get; set; } = new List<SpareShipmentLine>();

    public virtual Ticket Ticket { get; set; } = null!;
}
