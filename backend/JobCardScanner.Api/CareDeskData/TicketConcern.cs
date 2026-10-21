using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketConcern
{
    public Guid TicketId { get; set; }

    public string Aggregate { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
