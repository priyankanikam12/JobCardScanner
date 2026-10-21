using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketLink
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public Guid LinkedTicketId { get; set; }

    public string Reason { get; set; } = null!;

    public Guid CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual Ticket LinkedTicket { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
