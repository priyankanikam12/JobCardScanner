using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class City
{
    public short Id { get; set; }

    public string Name { get; set; } = null!;

    public string State { get; set; } = null!;

    public string Country { get; set; } = null!;

    public bool IsActive { get; set; }

    public virtual ICollection<EscalationMatrix> EscalationMatrices { get; set; } = new List<EscalationMatrix>();

    public virtual ICollection<Holiday> Holidays { get; set; } = new List<Holiday>();

    public virtual ICollection<Hub> Hubs { get; set; } = new List<Hub>();

    public virtual ICollection<Ticket> Tickets { get; set; } = new List<Ticket>();

    public virtual ICollection<Vehicle> Vehicles { get; set; } = new List<Vehicle>();
}
