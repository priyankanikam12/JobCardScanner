using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketPayment
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string Purpose { get; set; } = null!;

    public string? Mode { get; set; }

    public string UtrNo { get; set; } = null!;

    public decimal AmountInr { get; set; }

    public DateOnly PaidOn { get; set; }

    public Guid? ProofId { get; set; }

    public Guid EnteredBy { get; set; }

    public DateTimeOffset EnteredAt { get; set; }

    public string Status { get; set; } = null!;

    public Guid? CheckedBy { get; set; }

    public DateTimeOffset? CheckedAt { get; set; }

    public string? CheckNote { get; set; }

    public virtual User? CheckedByNavigation { get; set; }

    public virtual User EnteredByNavigation { get; set; } = null!;

    public virtual Attachment? Proof { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
