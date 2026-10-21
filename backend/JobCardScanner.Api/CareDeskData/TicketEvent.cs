using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketEvent
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string EventType { get; set; } = null!;

    public string? FromValue { get; set; }

    public string? ToValue { get; set; }

    public Guid? ActorId { get; set; }

    public string? Payload { get; set; }

    public DateTimeOffset At { get; set; }

    public virtual User? Actor { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
