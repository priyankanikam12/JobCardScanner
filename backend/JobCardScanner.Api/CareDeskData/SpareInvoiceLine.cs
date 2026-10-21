using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class SpareInvoiceLine
{
    public long InvoiceId { get; set; }

    public long LineId { get; set; }

    public int Qty { get; set; }

    public virtual SpareInvoice Invoice { get; set; } = null!;

    public virtual TicketSpareLine Line { get; set; } = null!;
}
