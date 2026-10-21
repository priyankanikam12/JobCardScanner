using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketConfirmation
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string Outcome { get; set; } = null!;

    public string? Comment { get; set; }

    public Guid? ByUserId { get; set; }

    public DateTimeOffset At { get; set; }

    public virtual User? ByUser { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
