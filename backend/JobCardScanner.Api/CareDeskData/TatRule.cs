using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TatRule
{
    public int Id { get; set; }

    public string Category { get; set; } = null!;

    public string? Aggregate { get; set; }

    public string Track { get; set; } = null!;

    public decimal ResponseHours { get; set; }

    public decimal E1Hours { get; set; }

    public decimal E2Hours { get; set; }

    public decimal E3Hours { get; set; }

    public bool IsActive { get; set; }

    public DateTimeOffset EffectiveFrom { get; set; }

    public virtual ICollection<Ticket> Tickets { get; set; } = new List<Ticket>();
}
