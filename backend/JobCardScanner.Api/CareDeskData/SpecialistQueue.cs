using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class SpecialistQueue
{
    public string Code { get; set; } = null!;

    public string Name { get; set; } = null!;

    public Guid? OwnerUserId { get; set; }

    public decimal? ResponseHours { get; set; }

    public virtual User? OwnerUser { get; set; }

    public virtual ICollection<TicketRoute> TicketRoutes { get; set; } = new List<TicketRoute>();

    public virtual ICollection<Ticket> Tickets { get; set; } = new List<Ticket>();
}
