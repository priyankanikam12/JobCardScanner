using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class LevelReminder
{
    public Guid TicketId { get; set; }

    public string Level { get; set; } = null!;

    public DateTimeOffset WindowStart { get; set; }

    public short Pct { get; set; }

    public DateTimeOffset At { get; set; }

    public Guid? OwnerId { get; set; }

    public bool Sent { get; set; }

    public virtual User? Owner { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
