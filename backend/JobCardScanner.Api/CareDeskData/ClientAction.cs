using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class ClientAction
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid? TicketId { get; set; }

    public string Action { get; set; } = null!;

    public DateTimeOffset? CapturedAt { get; set; }

    public DateTimeOffset ReceivedAt { get; set; }

    public DateTimeOffset? DoneAt { get; set; }

    public short? Status { get; set; }

    public string? Response { get; set; }

    public virtual Ticket? Ticket { get; set; }

    public virtual User User { get; set; } = null!;
}
