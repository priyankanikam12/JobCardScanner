using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketLevelHistory
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string Level { get; set; } = null!;

    public Guid? OwnerId { get; set; }

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? ResponseDueAt { get; set; }

    public DateTimeOffset? DueAt { get; set; }

    public DateTimeOffset? FirstResponseAt { get; set; }

    public DateTimeOffset? EndedAt { get; set; }

    public string? EndReason { get; set; }

    public virtual User? Owner { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
