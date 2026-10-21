using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class VehicleAssignmentHistory
{
    public long Id { get; set; }

    public Guid VehicleId { get; set; }

    public Guid? FromCustomer { get; set; }

    public Guid ToCustomer { get; set; }

    public Guid ChangedBy { get; set; }

    public DateTimeOffset ChangedAt { get; set; }

    public string? Reason { get; set; }

    public virtual User ChangedByNavigation { get; set; } = null!;

    public virtual Customer? FromCustomerNavigation { get; set; }

    public virtual Customer ToCustomerNavigation { get; set; } = null!;

    public virtual Vehicle Vehicle { get; set; } = null!;
}
