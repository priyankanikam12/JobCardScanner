using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketRating
{
    public Guid TicketId { get; set; }

    public short Stars { get; set; }

    public Guid ByUserId { get; set; }

    public DateTimeOffset RatedAt { get; set; }

    public virtual User ByUser { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
