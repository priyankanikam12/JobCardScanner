using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketSpareLine
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public int? PartId { get; set; }

    public string PartCode { get; set; } = null!;

    public string? Description { get; set; }

    public int Qty { get; set; }

    public virtual Part? Part { get; set; }

    public virtual ICollection<SpareInvoiceLine> SpareInvoiceLines { get; set; } = new List<SpareInvoiceLine>();

    public virtual ICollection<SpareReceiptLine> SpareReceiptLines { get; set; } = new List<SpareReceiptLine>();

    public virtual ICollection<SpareShipmentLine> SpareShipmentLines { get; set; } = new List<SpareShipmentLine>();

    public virtual Ticket Ticket { get; set; } = null!;
}
