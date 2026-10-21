using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketPause
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string Reason { get; set; } = null!;

    public string RequestedItems { get; set; } = null!;

    public DateTimeOffset PausedAt { get; set; }

    public DateTimeOffset? ResumedAt { get; set; }

    public Guid RequestedBy { get; set; }

    public string? Answer { get; set; }

    public Guid? AnsweredBy { get; set; }

    public DateTimeOffset? AnsweredAt { get; set; }

    public DateTimeOffset? RemindedAt { get; set; }

    public virtual User? AnsweredByNavigation { get; set; }

    public virtual User RequestedByNavigation { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
