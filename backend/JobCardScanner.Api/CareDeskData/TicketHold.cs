using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketHold
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string Reason { get; set; } = null!;

    public DateTimeOffset HeldAt { get; set; }

    public Guid? HeldBy { get; set; }

    public DateTimeOffset? ReleasedAt { get; set; }

    public Guid? ReleasedBy { get; set; }

    public decimal? WorkingHours { get; set; }

    public virtual User? HeldByNavigation { get; set; }

    public virtual User? ReleasedByNavigation { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
