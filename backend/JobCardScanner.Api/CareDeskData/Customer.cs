using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class Customer
{
    public Guid Id { get; set; }

    public string CustomerCode { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string Type { get; set; } = null!;

    public string? Gstin { get; set; }

    public bool IsActive { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public virtual ICollection<EscalationMatrix> EscalationMatrices { get; set; } = new List<EscalationMatrix>();

    public virtual ICollection<Hub> Hubs { get; set; } = new List<Hub>();

    public virtual ICollection<Ticket> Tickets { get; set; } = new List<Ticket>();

    public virtual ICollection<User> Users { get; set; } = new List<User>();

    public virtual ICollection<VehicleAssignmentHistory> VehicleAssignmentHistoryFromCustomerNavigations { get; set; } = new List<VehicleAssignmentHistory>();

    public virtual ICollection<VehicleAssignmentHistory> VehicleAssignmentHistoryToCustomerNavigations { get; set; } = new List<VehicleAssignmentHistory>();

    public virtual ICollection<Vehicle> Vehicles { get; set; } = new List<Vehicle>();

    public virtual ICollection<WarrantyPolicy> WarrantyPolicies { get; set; } = new List<WarrantyPolicy>();
}
