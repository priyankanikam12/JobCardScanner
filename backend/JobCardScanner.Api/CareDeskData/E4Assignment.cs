using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class E4Assignment
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public Guid AssignedBy { get; set; }

    public DateTimeOffset AssignedAt { get; set; }

    public Guid? FromOwnerId { get; set; }

    public Guid OwnerId { get; set; }

    public DateOnly DeadlineOn { get; set; }

    public DateTimeOffset DueAt { get; set; }

    public string Note { get; set; } = null!;

    public DateTimeOffset? SupersededAt { get; set; }

    public DateTimeOffset? CheckedAt { get; set; }

    public bool? Met { get; set; }

    public DateTimeOffset? MissedAlertedAt { get; set; }

    public virtual User AssignedByNavigation { get; set; } = null!;

    public virtual User? FromOwner { get; set; }

    public virtual User Owner { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
