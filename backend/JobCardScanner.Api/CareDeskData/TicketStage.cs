using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketStage
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string Flow { get; set; } = null!;

    public string Stage { get; set; } = null!;

    public string Actor { get; set; } = null!;

    public bool Transit { get; set; }

    public long? InvoiceId { get; set; }

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? DueAt { get; set; }

    public DateTimeOffset? DoneAt { get; set; }

    public Guid? DoneBy { get; set; }

    public string? Data { get; set; }

    public DateTimeOffset? LateAlertedAt { get; set; }

    public DateTimeOffset? BalanceRemindedAt { get; set; }

    public DateTimeOffset? BalanceAlertedAt { get; set; }

    public DateTimeOffset? UndoneAt { get; set; }

    public Guid? UndoneBy { get; set; }

    public string? UndoReason { get; set; }

    public virtual User? DoneByNavigation { get; set; }

    public virtual ICollection<SpareReceiptLine> SpareReceiptLines { get; set; } = new List<SpareReceiptLine>();

    public virtual Ticket Ticket { get; set; } = null!;

    public virtual User? UndoneByNavigation { get; set; }
}
