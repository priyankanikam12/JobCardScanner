using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class MessageRead
{
    public long MessageId { get; set; }

    public Guid UserId { get; set; }

    public DateTimeOffset ReadAt { get; set; }

    public virtual TicketMessage Message { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
