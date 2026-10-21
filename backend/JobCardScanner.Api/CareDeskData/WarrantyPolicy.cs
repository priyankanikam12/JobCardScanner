using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class WarrantyPolicy
{
    public int Id { get; set; }

    public string Aggregate { get; set; } = null!;

    public Guid? CustomerId { get; set; }

    public short? ModelId { get; set; }

    public bool IsCovered { get; set; }

    public short? Months { get; set; }

    public int? KmLimit { get; set; }

    public DateOnly EffectiveFrom { get; set; }

    public DateOnly? EffectiveTo { get; set; }

    public string SourceDoc { get; set; } = null!;

    public string? DocVersion { get; set; }

    public virtual Customer? Customer { get; set; }

    public virtual VehicleModel? Model { get; set; }

    public virtual ICollection<TicketWarranty> TicketWarranties { get; set; } = new List<TicketWarranty>();
}
