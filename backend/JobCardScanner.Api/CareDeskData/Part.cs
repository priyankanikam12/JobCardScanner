using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class Part
{
    public int Id { get; set; }

    public string? PartCode { get; set; }

    public string Name { get; set; } = null!;

    public string Aggregate { get; set; } = null!;

    public bool IsWarrantable { get; set; }

    public virtual ICollection<TicketSpareLine> TicketSpareLines { get; set; } = new List<TicketSpareLine>();

    public virtual ICollection<TicketWarranty> TicketWarranties { get; set; } = new List<TicketWarranty>();
}
