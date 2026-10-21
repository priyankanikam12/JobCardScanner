using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class SpareCredit
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public decimal AmountInr { get; set; }

    public string Reason { get; set; } = null!;

    public Guid GrantedBy { get; set; }

    public DateTimeOffset GrantedAt { get; set; }

    public virtual User GrantedByNavigation { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
