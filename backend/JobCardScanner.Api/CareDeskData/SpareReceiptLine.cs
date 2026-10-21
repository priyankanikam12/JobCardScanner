using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class SpareReceiptLine
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public long InvoiceId { get; set; }

    public long? ShipmentId { get; set; }

    public long StageId { get; set; }

    public long LineId { get; set; }

    public int QtySent { get; set; }

    public int QtyReceived { get; set; }

    public string? Issue { get; set; }

    public Guid? PhotoId { get; set; }

    public Guid ReportedBy { get; set; }

    public DateTimeOffset ReportedAt { get; set; }

    public DateTimeOffset? WithdrawnAt { get; set; }

    public virtual SpareInvoice Invoice { get; set; } = null!;

    public virtual TicketSpareLine Line { get; set; } = null!;

    public virtual Attachment? Photo { get; set; }

    public virtual User ReportedByNavigation { get; set; } = null!;

    public virtual SpareShipment? Shipment { get; set; }

    public virtual TicketStage Stage { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
